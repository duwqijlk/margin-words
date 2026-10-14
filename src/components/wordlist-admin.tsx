import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { normalizeGlossaryWork, workKey, type GlossaryWorkItem } from "@/lib/glossary-work";
import { compareListStamps, listUpdatedStamp, readUpdated } from "@/lib/list-updated";
import { accountPostRaw } from "@/lib/sync-engine";
import { BUNDLED_CATALOG_URL } from "@/lib/packs";
import { WORD_LIST_CATALOG_URL } from "@/lib/word-list-catalog";
import { bookKey, matchGlossaryBook, type BookKind, type KnownBook } from "@/lib/glossary-target";
import { btn, cn, field, selectCls } from "@/components/ui";

type Preview =
  | { ok: true; words: number; paragraphs: number; sentences: number; phrases: number; bytes: number; title: string; author: string; isbn: string }
  | { ok: false; problem: string };

type PendingFile = {
  /** Id taken from the file name. Used only when this file is published as a new word list. */
  id: string;
  name: string;
  text: string;
  preview: Preview;
  /** "" until a book is chosen. "new" publishes a new word list. Otherwise "lists:id" or "public:id". */
  target: string;
  result?: "ok" | "error";
  resultNote?: string;
};

const NEW_TARGET = "new";
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
type RowNote = { tone: "ok" | "warn"; text: string };
type SortKey = "now" | "prev";

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function previewOf(text: string): Preview {
  if (!text.trim()) return { ok: false, problem: "admin.lists.badGlossary" };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, problem: "admin.lists.badGlossary" };
  }
  const glossary = (data as { glossary?: unknown })?.glossary;
  if (!glossary || typeof glossary !== "object" || Array.isArray(glossary) || Object.keys(glossary).length === 0) {
    return { ok: false, problem: "admin.lists.badGlossary" };
  }
  const record = data as {
    count?: unknown;
    title?: unknown;
    author?: unknown;
    isbn?: unknown;
    glossary: Record<string, unknown>;
    paragraphs?: unknown;
    sentences?: unknown;
    phrases?: unknown;
  };
  return {
    ok: true,
    title: textOf(record.title),
    author: textOf(record.author),
    isbn: textOf(record.isbn),
    words: Number(record.count) || Object.keys(record.glossary).length,
    paragraphs: Array.isArray(record.paragraphs) ? record.paragraphs.length : 0,
    sentences: Array.isArray(record.sentences) ? record.sentences.length : 0,
    phrases: record.phrases && typeof record.phrases === "object" ? Object.keys(record.phrases).length : 0,
    bytes: new TextEncoder().encode(text).length,
  };
}

/** a-book.glossary.json or a-book.json names the book id. */
function idFromName(name: string): string {
  const base = name.replace(/\.(glossary)?\.json$/i, "");
  return base.trim().toLowerCase();
}

function booksOf(kind: BookKind, rows: unknown): KnownBook[] {
  if (!Array.isArray(rows)) return [];
  const out: KnownBook[] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      id?: unknown;
      title?: unknown;
      author?: unknown;
      isbn?: unknown;
      updated?: unknown;
      previousUpdated?: unknown;
    };
    const id = textOf(row.id);
    if (!ID_PATTERN.test(id)) continue;
    out.push({
      id,
      title: textOf(row.title) || id,
      author: textOf(row.author),
      isbn: textOf(row.isbn),
      kind,
      updated: readUpdated(row.updated),
      previousUpdated: readUpdated(row.previousUpdated),
    });
  }
  return out;
}

/** Newest first unless the header asks for the other direction. A missing time stays at the bottom. */
function orderedUpdates(books: KnownBook[], needle: string, sortKey: SortKey, sortDir: "asc" | "desc"): KnownBook[] {
  const field = sortKey === "now" ? "updated" : "previousUpdated";
  return books
    .filter((book) => {
      if (!needle) return true;
      return book.title.toLowerCase().includes(needle) || book.id.toLowerCase().includes(needle);
    })
    .sort((a, b) => {
      const cmp = compareListStamps(listUpdatedStamp(a[field] ?? ""), listUpdatedStamp(b[field] ?? ""), sortDir);
      return cmp || a.title.localeCompare(b.title);
    });
}

async function loadWorkFile(): Promise<{ items: GlossaryWorkItem[]; failed: boolean }> {
  try {
    const response = await fetch("/api/admin/glossary-work", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return { items: [], failed: true };
    const parsed = normalizeGlossaryWork(await response.json());
    return parsed.ok ? { items: parsed.items, failed: false } : { items: [], failed: true };
  } catch {
    return { items: [], failed: true };
  }
}

function parseTarget(value: string): { kind: BookKind; id: string } | "new" | "" {
  if (!value) return "";
  if (value === NEW_TARGET) return "new";
  const split = value.indexOf(":");
  if (split < 1) return "";
  const kind = value.slice(0, split);
  const id = value.slice(split + 1);
  if ((kind !== "lists" && kind !== "public") || !ID_PATTERN.test(id)) return "";
  return { kind, id };
}

const ERROR_KEYS: Record<string, string> = {
  "unknown-id": "admin.lists.needsTitle",
  "duplicate-title": "admin.lists.duplicate",
  "different-book": "admin.lists.differentBook",
  "bad-glossary": "admin.lists.badGlossary",
  "bad-json": "admin.lists.badGlossary",
  "bad-id": "admin.lists.error",
  "too-large": "admin.lists.tooLarge",
  "no-books-bucket": "admin.error",
  "no-catalog": "admin.error",
};

/** The word-list tab: choose a glossary file, match it to a book, then publish. */
export function WordListAdmin() {
  const { t } = useT();
  const [books, setBooks] = useState<KnownBook[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("now");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [work, setWork] = useState<GlossaryWorkItem[]>([]);
  const [workError, setWorkError] = useState(false);
  const [workBusy, setWorkBusy] = useState(false);
  const [notes, setNotes] = useState<Record<string, RowNote>>({});
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState("");
  const uploadTarget = useRef<KnownBook | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const locked = busy || workBusy;

  const loadCatalogs = () => {
    setLoadError(false);
    void Promise.all([
      fetch(WORD_LIST_CATALOG_URL, { cache: "no-cache" }).then((response) =>
        response.ok ? response.json() : Promise.reject(new Error(String(response.status))),
      ),
      fetch(BUNDLED_CATALOG_URL, { cache: "no-cache" }).then((response) =>
        response.ok ? response.json() : Promise.reject(new Error(String(response.status))),
      ),
      loadWorkFile(),
    ])
      .then(([lists, packs, marks]) => {
        const listRows = booksOf("lists", (lists as { lists?: unknown }).lists);
        const publicRows = booksOf("public", (packs as { packs?: unknown }).packs);
        setBooks([...listRows, ...publicRows]);
        setWorkError(marks.failed);
        if (!marks.failed) setWork(marks.items);
      })
      .catch(() => setLoadError(true));
  };

  useEffect(() => {
    loadCatalogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byKey = useMemo(() => new Map((books ?? []).map((book) => [bookKey(book), book])), [books]);
  const lists = useMemo(
    () => (books ?? []).filter((book) => book.kind === "lists").sort((a, b) => a.title.localeCompare(b.title)),
    [books],
  );
  const publics = useMemo(
    () => (books ?? []).filter((book) => book.kind === "public").sort((a, b) => a.title.localeCompare(b.title)),
    [books],
  );
  const updates = useMemo(
    () => orderedUpdates(books ?? [], query.trim().toLowerCase(), sortKey, sortDir),
    [books, query, sortDir, sortKey],
  );
  const makingSince = useMemo(() => {
    const marks = new Map<string, string>();
    for (const item of work) marks.set(workKey(item), item.since);
    return marks;
  }, [work]);

  function onSort(next: SortKey) {
    if (sortKey === next) setSortDir((dir) => (dir === "desc" ? "asc" : "desc"));
    else {
      setSortKey(next);
      setSortDir("desc");
    }
  }

  function noteOf(key: string, note: RowNote) {
    setNotes((current) => ({ ...current, [key]: note }));
  }

  function pickUpload(book: KnownBook) {
    if (locked) return;
    uploadTarget.current = book;
    uploadInput.current?.click();
  }

  async function uploadChosen(list: FileList | null) {
    const book = uploadTarget.current;
    uploadTarget.current = null;
    const file = list?.item(0);
    if (!book || !file || locked) return;
    const key = bookKey(book);
    const text = await file.text();
    const preview = previewOf(text);
    if (!preview.ok) {
      noteOf(key, { tone: "warn", text: t(preview.problem as Parameters<typeof t>[0]) });
      return;
    }
    setBusy(true);
    noteOf(key, { tone: "ok", text: t("admin.lists.uploading") });
    const catalog = book.kind === "public" ? "&catalog=public" : "";
    try {
      await accountPostRaw(`/api/admin/word-lists?id=${encodeURIComponent(book.id)}${catalog}`, text);
      noteOf(key, { tone: "ok", text: t("admin.lists.published") });
      setWork((current) => current.filter((item) => workKey(item) !== key));
      loadCatalogs();
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      noteOf(key, { tone: "warn", text: t((ERROR_KEYS[code] ?? "admin.lists.error") as Parameters<typeof t>[0]) });
    } finally {
      setBusy(false);
    }
  }

  async function toggleMaking(book: KnownBook) {
    if (locked) return;
    const key = bookKey(book);
    const making = !makingSince.has(key);
    setWorkBusy(true);
    try {
      const response = await fetch("/api/admin/glossary-work", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: book.kind, id: book.id, making }),
      });
      if (!response.ok) throw new Error("work");
      const parsed = normalizeGlossaryWork(await response.json());
      if (!parsed.ok) throw new Error("work");
      setWork(parsed.items);
      setWorkError(false);
      setNotes((current) => {
        if (!current[key]) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    } catch {
      noteOf(key, { tone: "warn", text: t("admin.lists.workFailed") });
    } finally {
      setWorkBusy(false);
    }
  }

  function titleClash(file: PendingFile): KnownBook | undefined {
    if (file.preview.ok !== true || !file.preview.title) return undefined;
    const key = normalizeTitle(file.preview.title);
    return (books ?? []).find((book) => normalizeTitle(book.title) === key);
  }

  function chosen(file: PendingFile): KnownBook | "new" | "" {
    const parsed = parseTarget(file.target);
    if (parsed === "" || parsed === "new") return parsed;
    return byKey.get(file.target) ?? "";
  }

  /** A new word list whose title is already on the host is a file aimed at the wrong book. */
  function blocked(file: PendingFile): KnownBook | undefined {
    if (chosen(file) !== "new") return undefined;
    return titleClash(file);
  }

  const publishable = files.filter((file) => {
    if (file.preview.ok !== true || blocked(file)) return false;
    const pick = chosen(file);
    if (pick === "") return false;
    if (pick === "new") return ID_PATTERN.test(file.id);
    return true;
  });

  async function readFiles(list: FileList | null) {
    if (!list || list.length === 0 || !books) return;
    setSummary("");
    const incoming: PendingFile[] = [];
    for (const file of Array.from(list)) {
      const id = idFromName(file.name);
      const text = await file.text();
      const preview = previewOf(text);
      const match =
        preview.ok === true
          ? matchGlossaryBook(books, { fileId: id, title: preview.title, author: preview.author, isbn: preview.isbn })
          : null;
      incoming.push({ id, name: file.name, text, preview, target: match ? bookKey(match) : "" });
    }
    setFiles((current) => {
      const byId = new Map(current.map((file) => [file.id, file]));
      for (const file of incoming) byId.set(file.id, file);
      return [...byId.values()];
    });
  }

  function setTarget(fileId: string, target: string) {
    setFiles((current) =>
      current.map((item) => (item.id === fileId ? { ...item, target, result: undefined, resultNote: undefined } : item)),
    );
  }

  async function publish() {
    if (busy || publishable.length === 0) return;
    setBusy(true);
    let ok = 0;
    let failed = 0;
    for (const file of publishable) {
      const pick = chosen(file);
      const id = pick === "new" ? file.id : pick === "" ? "" : pick.id;
      const catalog = pick !== "new" && pick !== "" && pick.kind === "public" ? "&catalog=public" : "";
      try {
        await accountPostRaw(`/api/admin/word-lists?id=${encodeURIComponent(id)}${catalog}`, file.text);
        ok += 1;
        setFiles((current) =>
          current.map((item) => (item.id === file.id ? { ...item, result: "ok", resultNote: undefined } : item)),
        );
      } catch (caught) {
        failed += 1;
        const code = caught instanceof Error ? caught.message : "";
        setFiles((current) =>
          current.map((item) =>
            item.id === file.id
              ? { ...item, result: "error", resultNote: t((ERROR_KEYS[code] ?? "admin.lists.error") as Parameters<typeof t>[0]) }
              : item,
          ),
        );
      }
    }
    setBusy(false);
    setSummary(t("admin.lists.batchDone", { ok, failed }));
    if (ok > 0) loadCatalogs();
  }

  return (
    <div className="grid gap-4" data-admin-lists>
      <p className="text-sm text-muted">{t("admin.lists.hint")}</p>
      {loadError ? (
        <p role="alert">{t("admin.lists.error")}</p>
      ) : books === null ? (
        <p>{t("dashboard.loading")}</p>
      ) : (
        <>
          <div className="grid gap-2" data-admin-list-updates>
            <p className="text-sm font-medium">{t("admin.lists.updates")}</p>
            <input
              className={field}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("admin.lists.filter")}
              aria-label={t("admin.lists.filter")}
              data-admin-list-filter
            />
            {workError ? (
              <p className="text-sm text-warn" role="alert" data-admin-list-work-error>
                {t("admin.lists.workError")}
              </p>
            ) : null}
            <input
              ref={uploadInput}
              className="hidden"
              type="file"
              accept=".json,application/json"
              data-admin-list-row-file
              onChange={(event) => {
                const list = event.target.files;
                event.target.value = "";
                void uploadChosen(list);
              }}
            />
            {updates.length === 0 ? (
              <p className="text-sm text-muted">{t("admin.lists.noMatch")}</p>
            ) : (
              <div className="max-h-[32rem] overflow-auto rounded-xl border border-line">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="sticky top-0 bg-card px-3 py-2 font-medium" scope="col">
                        {t("admin.lists.colBook")}
                      </th>
                      <th className="sticky top-0 bg-card px-3 py-2 whitespace-nowrap" scope="col" aria-sort={sortKey === "now" ? (sortDir === "desc" ? "descending" : "ascending") : "none"}>
                        <button type="button" className="font-medium" data-admin-list-sort="now" onClick={() => onSort("now")}>
                          {t("admin.lists.colNow")}
                          {sortKey === "now" ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                        </button>
                      </th>
                      <th className="sticky top-0 bg-card px-3 py-2 whitespace-nowrap" scope="col" aria-sort={sortKey === "prev" ? (sortDir === "desc" ? "descending" : "ascending") : "none"}>
                        <button type="button" className="font-medium" data-admin-list-sort="prev" onClick={() => onSort("prev")}>
                          {t("admin.lists.colPrev")}
                          {sortKey === "prev" ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                        </button>
                      </th>
                      <th className="sticky top-0 bg-card px-3 py-2 font-medium whitespace-nowrap" scope="col">
                        {t("admin.lists.colActions")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {updates.map((book) => {
                      const key = bookKey(book);
                      const since = makingSince.get(key);
                      const note = notes[key];
                      const stamp = since ? listUpdatedStamp(since) : "";
                      return (
                        <tr key={key} className="border-t border-line" data-admin-list-row={key}>
                          <td className="px-3 py-2">
                            <span className="font-medium">{book.title}</span>
                            <span className="mt-0.5 block text-xs text-muted">
                              {book.id} · {book.kind === "lists" ? t("admin.lists.wordLists") : t("admin.lists.publicBooks")}
                            </span>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap tabular-nums" data-admin-list-now>
                            {listUpdatedStamp(book.updated ?? "") || "—"}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap tabular-nums" data-admin-list-prev>
                            {listUpdatedStamp(book.previousUpdated ?? "") || "—"}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="inline-flex min-h-9 items-center rounded-lg border border-line bg-card px-2.5 text-xs font-semibold hover:bg-accent-soft disabled:opacity-45"
                                data-admin-list-upload={key}
                                disabled={locked}
                                onClick={() => pickUpload(book)}
                              >
                                {t("admin.lists.uploadOne")}
                              </button>
                              <button
                                type="button"
                                className={cn(
                                  "inline-flex min-h-9 items-center rounded-lg border border-line px-2.5 text-xs font-semibold hover:bg-accent-soft disabled:opacity-45",
                                  since ? "bg-accent-soft" : "bg-card",
                                )}
                                data-admin-list-making={key}
                                aria-pressed={!!since}
                                disabled={locked}
                                onClick={() => void toggleMaking(book)}
                              >
                                {t("admin.lists.making")}
                              </button>
                            </div>
                            {stamp ? (
                              <p className="mt-1 text-xs text-muted tabular-nums" data-admin-list-since={key}>
                                {t("admin.lists.makingSince", { when: stamp })}
                              </p>
                            ) : null}
                            {note ? (
                              <p className={cn("mt-1 text-xs", note.tone === "warn" ? "text-warn" : "text-accent")} data-admin-list-note={key}>
                                {note.text}
                              </p>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <label className="grid gap-1 text-sm font-medium" htmlFor="admin-list-file">
            {t("admin.lists.file")}
            <input
              id="admin-list-file"
              className={cn(field, "py-2")}
              type="file"
              accept=".json,application/json"
              multiple
              data-admin-list-file
              disabled={busy}
              onChange={(event) => {
                const list = event.target.files;
                void readFiles(list);
                event.target.value = "";
              }}
            />
          </label>
          {files.length > 0 ? (
            <ul className="grid gap-2">
              {files.map((file) => {
                const pick = chosen(file);
                const clash = blocked(file);
                const canBeNew = file.preview.ok === true && file.preview.title && ID_PATTERN.test(file.id);
                return (
                  <li key={file.id} className="grid gap-2 rounded-xl border border-line bg-card p-3" data-admin-list-item={file.id}>
                    <p className="text-sm font-semibold">{file.name}</p>
                    {file.preview.ok ? (
                      <p className="text-sm">
                        {t("admin.lists.preview", {
                          words: file.preview.words,
                          paragraphs: file.preview.paragraphs,
                          sentences: file.preview.sentences,
                          phrases: file.preview.phrases,
                        })}{" "}
                        · {(file.preview.bytes / 1024).toFixed(0)} KB
                      </p>
                    ) : (
                      <p className="text-sm text-warn" role="alert">
                        {t(file.preview.problem as Parameters<typeof t>[0])}
                      </p>
                    )}
                    {file.preview.ok ? (
                      <label className="grid gap-1 text-sm font-medium" htmlFor={`admin-list-book-${file.id}`}>
                        {t("admin.lists.book")}
                        <select
                          id={`admin-list-book-${file.id}`}
                          className={cn(selectCls, "w-full")}
                          data-admin-list-book={file.id}
                          value={file.target}
                          disabled={busy}
                          onChange={(event) => setTarget(file.id, event.target.value)}
                        >
                          <option value="">{t("admin.lists.chooseBook")}</option>
                          {canBeNew ? <option value={NEW_TARGET}>{t("admin.lists.newWordList", { id: file.id })}</option> : null}
                          {lists.length > 0 ? (
                            <optgroup label={t("admin.lists.wordLists")}>
                              {lists.map((book) => (
                                <option key={bookKey(book)} value={bookKey(book)}>
                                  {book.title} ({book.id})
                                </option>
                              ))}
                            </optgroup>
                          ) : null}
                          {publics.length > 0 ? (
                            <optgroup label={t("admin.lists.publicBooks")}>
                              {publics.map((book) => (
                                <option key={bookKey(book)} value={bookKey(book)}>
                                  {book.title} ({book.id})
                                </option>
                              ))}
                            </optgroup>
                          ) : null}
                        </select>
                      </label>
                    ) : null}
                    {pick && pick !== "new" ? (
                      <div className="grid gap-1" data-admin-list-matched={file.id}>
                        <p className="text-xs text-muted">{t("admin.lists.matched", { title: pick.title, id: pick.id })}</p>
                        {pick.updated ? (
                          <p className="text-xs text-muted" data-admin-list-updated={file.id}>
                            {t("admin.lists.versionNow", { when: listUpdatedStamp(pick.updated) })}
                          </p>
                        ) : null}
                        {pick.previousUpdated ? (
                          <p className="text-xs text-muted" data-admin-list-previous={file.id}>
                            {t("admin.lists.versionPrev", { when: listUpdatedStamp(pick.previousUpdated) })}
                          </p>
                        ) : (
                          <p className="text-xs text-muted" data-admin-list-previous={file.id}>
                            {t("admin.lists.versionFirst")}
                          </p>
                        )}
                      </div>
                    ) : null}
                    {pick === "new" && !clash ? <p className="text-xs text-accent">{t("admin.lists.newBook")}</p> : null}
                    {file.preview.ok && pick === "" ? <p className="text-sm text-warn">{t("admin.lists.needBook")}</p> : null}
                    {clash ? (
                      <p className="text-sm text-warn" role="alert" data-admin-list-clash>
                        {t("admin.lists.duplicateTitle", { id: clash.id })}
                      </p>
                    ) : null}
                    {file.result === "ok" ? <p className="text-sm text-accent">{t("admin.lists.published")}</p> : null}
                    {file.result === "error" && file.resultNote ? (
                      <p className="text-sm text-warn" role="alert">
                        {file.resultNote}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {summary ? <p className="text-sm text-accent" data-admin-list-summary>{summary}</p> : null}
          <button
            type="button"
            className={cn(btn.primary, "justify-start")}
            disabled={locked || publishable.length === 0}
            data-admin-list-publish
            onClick={() => void publish()}
          >
            {busy ? t("account.working") : t("admin.lists.batch", { n: publishable.length })}
          </button>
        </>
      )}
    </div>
  );
}
