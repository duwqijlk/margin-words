import { useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import { accountPostRaw } from "@/lib/sync-engine";
import { WORD_LIST_CATALOG_URL } from "@/lib/word-list-catalog";
import { btn, cn, field } from "@/components/ui";

type CatalogList = { id: string; title: string; author?: string; words?: number };

type Preview =
  | { ok: true; words: number; paragraphs: number; sentences: number; phrases: number; bytes: number; title?: string }
  | { ok: false; problem: string };

type PendingFile = {
  id: string;
  name: string;
  text: string;
  preview: Preview;
  result?: "ok" | "error";
  resultNote?: string;
};

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
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
    glossary: Record<string, unknown>;
    paragraphs?: unknown;
    sentences?: unknown;
    phrases?: unknown;
  };
  return {
    ok: true,
    title: typeof record.title === "string" ? record.title : undefined,
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

const ERROR_KEYS: Record<string, string> = {
  "unknown-id": "admin.lists.needsTitle",
  "duplicate-title": "admin.lists.duplicate",
  "bad-glossary": "admin.lists.badGlossary",
  "bad-json": "admin.lists.badGlossary",
  "too-large": "admin.lists.tooLarge",
  "no-books-bucket": "admin.error",
  "no-catalog": "admin.error",
};

/** The word-list tab: drop one or many glossary JSON files, publish them in one go. */
export function WordListAdmin() {
  const { t } = useT();
  const [known, setKnown] = useState<CatalogList[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState("");

  const loadCatalog = (onDone?: (rows: CatalogList[]) => void) => {
    void fetch(WORD_LIST_CATALOG_URL, { cache: "no-cache" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((catalog: { lists?: CatalogList[] }) => {
        setKnown(catalog.lists ?? []);
        onDone?.(catalog.lists ?? []);
      })
      .catch(() => setLoadError(true));
  };

  useEffect(() => {
    loadCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const knownById = useMemo(() => new Map((known ?? []).map((row) => [row.id, row])), [known]);
  const knownTitles = useMemo(
    () => new Map((known ?? []).map((row) => [normalizeTitle(row.title), row.id])),
    [known],
  );

  const publishable = files.filter((file) => file.preview.ok && !blockedIdOf(file));

  function kindOf(file: PendingFile): "update" | "new" {
    return knownById.has(file.id) ? "update" : "new";
  }

  /** A "new" id whose title already sits on the host under another id is a file-name mistake. */
  function blockedIdOf(file: PendingFile): string | undefined {
    if (file.preview.ok !== true || !file.preview.title || knownById.has(file.id)) return undefined;
    return knownTitles.get(normalizeTitle(file.preview.title));
  }

  async function readFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setSummary("");
    const incoming: PendingFile[] = [];
    for (const file of Array.from(list)) {
      const id = idFromName(file.name);
      const text = await file.text();
      incoming.push({ id, name: file.name, text, preview: previewOf(text) });
    }
    setFiles((current) => {
      const byId = new Map(current.map((file) => [file.id, file]));
      for (const file of incoming) byId.set(file.id, file);
      return [...byId.values()];
    });
  }

  async function publish() {
    if (busy || publishable.length === 0) return;
    setBusy(true);
    let ok = 0;
    let failed = 0;
    for (const file of publishable) {
      try {
        await accountPostRaw(`/api/admin/word-lists?id=${encodeURIComponent(file.id)}`, file.text);
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
    if (ok > 0) loadCatalog();
  }

  return (
    <div className="grid gap-4" data-admin-lists>
      <p className="text-sm text-muted">{t("admin.lists.hint")}</p>
      {loadError ? (
        <p role="alert">{t("admin.lists.error")}</p>
      ) : known === null ? (
        <p>{t("dashboard.loading")}</p>
      ) : (
        <>
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
                const kind = kindOf(file);
                const clashId = blockedIdOf(file);
                return (
                  <li key={file.id} className="grid gap-1 rounded-xl border border-line bg-card p-3" data-admin-list-item={file.id}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold">{file.id}</p>
                      <p className={cn("text-xs", kind === "new" ? "text-accent" : "text-muted")}>
                        {kind === "new" ? t("admin.lists.newBook") : t("admin.lists.update")}
                      </p>
                    </div>
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
                    {clashId ? (
                      <p className="text-sm text-warn" role="alert" data-admin-list-clash>
                        {t("admin.lists.duplicateTitle", { id: clashId })}
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
            disabled={busy || publishable.length === 0}
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
