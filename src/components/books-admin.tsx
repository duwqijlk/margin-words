import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import { errorText, useT } from "@/lib/i18n";
import { preferredCoverPath } from "@/lib/cover-choice";
import { accountPostForm, accountPostRaw } from "@/lib/sync-engine";
import { parseEpub } from "@/lib/epub";
import { btn, cn, field } from "@/components/ui";
import { BUNDLED_CATALOG_URL } from "@/lib/packs";
import { WORD_LIST_CATALOG_URL } from "@/lib/word-list-catalog";
import { normalizeTitle, replacesSameBook } from "@/lib/book-title";
import { idFromTitle, isNewIdShape } from "@/lib/book-id";
import type { ContentCategory } from "@/lib/content-category";
import { publishAdminBook, type AdminBookKind } from "@/lib/admin-book-upload";

type GlossaryInfo = {
  /** Id hint from the file name. It finds an existing book; a new book's id comes from the title. */
  id: string;
  title: string;
  name: string;
  text: string;
  file: File;
  words: number;
  isbn: string;
  category: ContentCategory | null;
  series: string;
  seriesNumber: number;
};

type LiveRow = { category: ContentCategory; series: string; seriesNumber: number };

/**
 * The catalog row this glossary updates, found by the file-name id and then by title, or a new id
 * made from the title (docs/BOOK_UPLOAD.md). An existing id is used as it is, however it is spelled.
 */
type Target = { id: string; isNew: boolean; live: LiveRow | null };

async function catalogTarget(glossary: GlossaryInfo, kind: AdminBookKind): Promise<Target> {
  const [url, key] =
    kind === "public" ? [BUNDLED_CATALOG_URL, "packs"] : [WORD_LIST_CATALOG_URL, "lists"];
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error("catalog-unavailable");
  const rows = ((await response.json()) as Record<string, unknown>)[key];
  if (!Array.isArray(rows)) throw new Error("catalog-unavailable");
  type Row = { id?: unknown; title?: unknown; category?: unknown; series?: unknown; seriesNumber?: unknown };
  const list = rows.filter((item): item is Row => Boolean(item) && typeof item === "object");
  const titleKey = glossary.title ? normalizeTitle(glossary.title) : "";
  const row =
    // A file name that points at another book is ignored; the title decides.
    list.find((item) => item.id === glossary.id && replacesSameBook(item.title, glossary.title)) ??
    (titleKey ? list.find((item) => typeof item.title === "string" && normalizeTitle(item.title) === titleKey) : undefined);
  if (row && typeof row.id === "string") {
    return {
      id: row.id,
      isNew: false,
      live: {
        category: row.category === "speech" ? "speech" : "novel",
        series: typeof row.series === "string" ? row.series : "",
        seriesNumber: typeof row.seriesNumber === "number" ? row.seriesNumber : 0,
      },
    };
  }
  // Public books are only updated here; the server answers unknown-id for a new one.
  if (kind === "public") return { id: glossary.id, isNew: true, live: null };
  return { id: idFromTitle(glossary.title, glossary.series, glossary.seriesNumber), isNew: true, live: null };
}

/** `jpeg` is the card file prepared while the thumbnail was drawn. */
type CoverCandidate = { path: string; thumb: string; jpeg: Uint8Array; bytes: number };

const ERROR_KEYS: Record<string, string> = {
  "unknown-id": "admin.books.publicNew",
  "no-epub": "admin.books.noEpub",
  "no-glossary": "admin.lists.badGlossary",
  "bad-json": "admin.lists.badGlossary",
  "bad-glossary": "admin.lists.badGlossary",
  "publish-budget-unconfirmed": "admin.books.budgetUnconfirmed",
  "catalog-busy": "admin.books.catalogBusy",
  "too-large": "admin.lists.tooLarge",
  "no-books-bucket": "admin.error",
  "no-private-bucket": "admin.error",
  "no-catalog": "admin.error",
  "cover-not-saved": "admin.books.coverFailed",
  "different-book": "admin.lists.differentBook",
  "bad-new-id": "admin.lists.badNewId",
};

function dataUrlBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  try {
    const binary = atob(dataUrl.slice(comma + 1));
    const out = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
    return out.byteLength > 0 ? out : null;
  } catch {
    return null;
  }
}

/** JPEG data URL. Card width is at most 400px, the same limit as scripts/resize-cover.py. */
function canvasJpeg(
  bitmap: ImageBitmap,
  box: { height?: number; maxWidth?: number },
  quality: number,
): string | null {
  const canvas = document.createElement("canvas");
  if (box.height) {
    canvas.height = box.height;
    canvas.width = Math.max(
      1,
      Math.round((bitmap.width * box.height) / Math.max(1, bitmap.height)),
    );
  } else {
    canvas.width = Math.min(box.maxWidth ?? bitmap.width, bitmap.width);
    canvas.height = Math.max(
      1,
      Math.round((bitmap.height * canvas.width) / Math.max(1, bitmap.width)),
    );
  }
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  try {
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return null;
  }
}

/** Every real image inside the EPUB. The upload file is encoded here, with the thumbnail. */
async function extractCoverCandidates(file: File): Promise<CoverCandidate[]> {
  const zip = await JSZip.loadAsync(file);
  const paths: string[] = [];
  zip.forEach((path, entry) => {
    if (!entry.dir && /\.(jpe?g|png)$/i.test(path)) paths.push(path);
  });
  paths.sort();
  const picked: CoverCandidate[] = [];
  for (const path of paths.slice(0, 24)) {
    const entry = zip.file(path);
    if (!entry) continue;
    const buffer = await entry.async("arraybuffer");
    if (buffer.byteLength < 3000) continue;
    try {
      const bitmap = await createImageBitmap(new Blob([buffer]));
      try {
        const thumb = canvasJpeg(bitmap, { height: 110 }, 0.8);
        const card = canvasJpeg(bitmap, { maxWidth: 400 }, 0.82);
        const jpeg = card ? dataUrlBytes(card) : null;
        if (!thumb || !jpeg) continue;
        picked.push({ path, thumb, jpeg, bytes: buffer.byteLength });
      } finally {
        bitmap.close();
      }
    } catch {
      // not a displayable image; skip
    }
  }
  return picked;
}

/** Upload a whole book: the word list plus its EPUB, with the ISBN filled in automatically. */
export function BooksAdmin() {
  const { t } = useT();
  const [glossary, setGlossary] = useState<GlossaryInfo | null>(null);
  const [epubFile, setEpubFile] = useState<File | null>(null);
  const [epubBusy, setEpubBusy] = useState(false);
  const [epubError, setEpubError] = useState("");
  const [parsedTitle, setParsedTitle] = useState("");
  const [parsedAuthor, setParsedAuthor] = useState("");
  const [covers, setCovers] = useState<CoverCandidate[]>([]);
  const [coverChoice, setCoverChoice] = useState<string | null>(null);
  const [kind, setKind] = useState<AdminBookKind>("private");
  const [category, setCategory] = useState<ContentCategory>("novel");
  /** Where the preselected category came from, shown under the choice. */
  const [categoryFrom, setCategoryFrom] = useState<"file" | "catalog" | "">("");
  /** Series row on Discover. Works for speeches too (for example "TED"). Empty: no series. */
  const [series, setSeries] = useState("");
  const [seriesNumber, setSeriesNumber] = useState("");
  const [isbn, setIsbn] = useState("");
  const [isbnTouched, setIsbnTouched] = useState(false);
  const [step, setStep] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const publishLock = useRef(false);
  const glossaryRead = useRef(0);
  const epubRead = useRef(0);
  const [metadataAttempt, setMetadataAttempt] = useState(0);
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [metadataError, setMetadataError] = useState(false);
  const [metadataFor, setMetadataFor] = useState<{
    glossary: GlossaryInfo;
    kind: AdminBookKind;
    /** The id this upload writes: the existing row's, or the new title slug. */
    id: string;
    isNew: boolean;
  } | null>(null);

  useEffect(() => {
    if (!glossary) return;
    let alive = true;
    setMetadataBusy(true);
    setMetadataError(false);
    void catalogTarget(glossary, kind)
      .then((target) => {
        if (!alive) return;
        const live = target.live;
        setCategory(live?.category ?? glossary.category ?? "novel");
        setCategoryFrom(live ? "catalog" : glossary.category ? "file" : "");
        const name = live ? live.series : glossary.series;
        const number = live ? live.seriesNumber : glossary.seriesNumber;
        setSeries(name);
        setSeriesNumber(name && number > 0 ? String(number) : "");
        setMetadataFor({ glossary, kind, id: target.id, isNew: target.isNew });
      })
      .catch(() => {
        if (alive) setMetadataError(true);
      })
      .finally(() => {
        if (alive) setMetadataBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [glossary, kind, metadataAttempt]);

  useEffect(() => {
    if (isbnTouched || !glossary?.isbn) return;
    if (!isbn) setIsbn(glossary.isbn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glossary?.isbn]);

  async function onGlossary(file: File | undefined) {
    if (!file) return;
    setNote("");
    setError("");
    const read = ++glossaryRead.current;
    setGlossary(null);
    setStep("");
    const id = file.name
      .replace(/\.(glossary)?\.json$/i, "")
      .trim()
      .toLowerCase();
    let text: string;
    try {
      text = await file.text();
    } catch {
      if (read === glossaryRead.current) setError(t("admin.lists.badGlossary"));
      return;
    }
    if (read !== glossaryRead.current) return;
    let isbn = "";
    let title = "";
    let words = 0;
    let fileCategory: ContentCategory | null = null;
    let fileSeries = "";
    let fileNumber = 0;
    try {
      const data = JSON.parse(text) as {
        isbn?: unknown;
        title?: unknown;
        count?: unknown;
        glossary?: Record<string, unknown>;
        category?: unknown;
        series?: unknown;
        seriesNumber?: unknown;
      };
      isbn = typeof data.isbn === "string" ? data.isbn.trim() : "";
      title = typeof data.title === "string" ? data.title.trim() : "";
      words = Object.keys(data.glossary ?? {}).length;
      if (data.category === "speech" || data.category === "novel") fileCategory = data.category;
      if (typeof data.series === "string") fileSeries = data.series.trim();
      if (typeof data.seriesNumber === "number" && data.seriesNumber > 0)
        fileNumber = data.seriesNumber;
    } catch {
      setError(t("admin.lists.badGlossary"));
      return;
    }
    setGlossary({
      id,
      title,
      name: file.name,
      text,
      file,
      isbn,
      words,
      category: fileCategory,
      series: fileSeries,
      seriesNumber: fileNumber,
    });
  }

  async function onEpub(file: File | undefined) {
    const read = ++epubRead.current;
    setEpubError("");
    setParsedTitle("");
    setParsedAuthor("");
    setCovers([]);
    setCoverChoice(null);
    if (!file) {
      setEpubFile(null);
      setEpubBusy(false);
      return;
    }
    setEpubFile(file);
    setEpubBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = await parseEpub(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        {},
      );
      if (read !== epubRead.current) return;
      setParsedTitle(parsed.title);
      setParsedAuthor(parsed.author);
      if (!isbnTouched && parsed.isbn) setIsbn(parsed.isbn);
      const candidates = await extractCoverCandidates(file);
      if (read !== epubRead.current) return;
      setCovers(candidates);
      setCoverChoice(preferredCoverPath(candidates));
    } catch (reason) {
      // The parse only fills in metadata; the file itself is still publishable.
      if (read === epubRead.current) setEpubError(errorText(reason, "err.openFailed"));
    } finally {
      if (read === epubRead.current) setEpubBusy(false);
    }
  }

  const current = metadataFor && metadataFor.glossary === glossary && metadataFor.kind === kind ? metadataFor : null;
  /** A new private book needs a title to name it; its title slug is always a valid new id. */
  const targetProblem =
    current?.isNew && kind === "private" && !isNewIdShape(current.id) ? "admin.lists.needsTitle" : "";

  async function publish() {
    if (
      !glossary ||
      !epubFile ||
      publishLock.current ||
      metadataBusy ||
      metadataError ||
      epubBusy ||
      metadataFor?.glossary !== glossary ||
      metadataFor?.kind !== kind ||
      targetProblem
    )
      return;
    publishLock.current = true;
    let wordsPublished = false;
    setBusy(true);
    setStep("");
    setNote("");
    setError("");
    try {
      const chosen = coverChoice ? covers.find((item) => item.path === coverChoice) : undefined;
      if (coverChoice && (!chosen || chosen.jpeg.byteLength === 0)) {
        setError(t("admin.books.coverFailed"));
        return;
      }
      const form = new FormData();
      form.set("epub", epubFile, "book.epub");
      form.set("glossary", glossary.file, "glossary.json");
      if (chosen) {
        const copy = new ArrayBuffer(chosen.jpeg.byteLength);
        new Uint8Array(copy).set(chosen.jpeg);
        form.set("cover", new File([copy], "cover.jpg", { type: "image/jpeg" }));
      }
      await publishAdminBook(
        {
          id: metadataFor.id,
          kind,
          category,
          isbn,
          series,
          seriesNumber,
          glossaryText: glossary.text,
          form,
        },
        {
          raw: accountPostRaw,
          form: accountPostForm,
          wordsSaved: () => {
            wordsPublished = true;
            setStep(t("admin.books.wordsDone"));
          },
        },
      );
      setStep(t("admin.books.bookDone"));
      setNote(t("admin.lists.published"));
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      const message = t((ERROR_KEYS[code] ?? "admin.lists.error") as Parameters<typeof t>[0]);
      setError(wordsPublished ? `${t("admin.books.partial")} ${message}` : message);
    } finally {
      publishLock.current = false;
      setBusy(false);
    }
  }

  const ready = Boolean(
    !targetProblem &&
    glossary &&
    epubFile &&
    !epubBusy &&
    !metadataBusy &&
    !metadataError &&
    metadataFor?.glossary === glossary &&
    metadataFor?.kind === kind,
  );

  return (
    <div className="grid gap-6" data-admin-books>
      <div className="rounded-2xl border border-line/80 bg-card p-5 shadow-2xs sm:p-6">
        <p className="text-sm text-muted">{t("admin.books.hint")}</p>

        <div className="mt-4 border-t border-line/50 pt-4" data-admin-books-kind>
          <span className="block text-xs font-bold uppercase tracking-wider text-muted">
            {t("admin.books.kind")}
          </span>
          <div className="mt-2 flex flex-wrap gap-2.5">
            <label
              className={cn(
                "inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all",
                kind === "private"
                  ? "border-accent bg-accent-soft text-accent shadow-2xs"
                  : "border-line/80 bg-paper/50 text-muted hover:border-line hover:bg-card",
              )}
            >
              <input
                type="radio"
                name="book-kind"
                disabled={busy}
                className="size-3.5 accent-accent"
                checked={kind === "private"}
                onChange={() => {
                  setKind("private");
                }}
              />
              {t("admin.books.private")}
            </label>
            <label
              className={cn(
                "inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all",
                kind === "public"
                  ? "border-accent bg-accent-soft text-accent shadow-2xs"
                  : "border-line/80 bg-paper/50 text-muted hover:border-line hover:bg-card",
              )}
            >
              <input
                type="radio"
                name="book-kind"
                disabled={busy}
                className="size-3.5 accent-accent"
                checked={kind === "public"}
                onChange={() => {
                  setKind("public");
                }}
              />
              {t("admin.books.public")}
            </label>
          </div>
        </div>

        <div className="mt-4 border-t border-line/50 pt-4" data-admin-books-category>
          <span className="block text-xs font-bold uppercase tracking-wider text-muted">
            {t("admin.books.category")}
          </span>
          <div className="mt-2 flex flex-wrap gap-2.5">
            {(["novel", "speech"] as const).map((value) => (
              <label
                key={value}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all",
                  category === value
                    ? "border-accent bg-accent-soft text-accent shadow-2xs"
                    : "border-line/80 bg-paper/50 text-muted hover:border-line hover:bg-card",
                )}
              >
                <input
                  type="radio"
                  name="book-category"
                  disabled={busy || metadataBusy}
                  className="size-3.5 accent-accent"
                  checked={category === value}
                  onChange={() => setCategory(value)}
                  data-admin-books-category-option={value}
                />
                {t(value === "speech" ? "discover.cat.speech" : "discover.cat.novel")}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            {categoryFrom === "catalog"
              ? t("admin.books.categoryLive")
              : categoryFrom === "file"
                ? t("admin.books.categoryFile")
                : t("admin.books.categoryHint")}
          </p>
        </div>
      </div>

      <div className="grid gap-5 rounded-2xl border border-line/80 bg-card p-5 shadow-2xs sm:p-6">
        <div className="grid gap-2">
          <label
            className="text-xs font-bold uppercase tracking-wider text-muted"
            htmlFor="admin-books-glossary"
          >
            {t("admin.lists.file")}
          </label>
          <input
            id="admin-books-glossary"
            className={cn(field, "py-2 text-xs")}
            type="file"
            accept=".json,application/json"
            data-admin-books-glossary
            disabled={busy}
            onChange={(event) => {
              void onGlossary(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          {glossary ? (
            <div
              className="mt-1 flex items-center gap-2 rounded-xl border border-accent/20 bg-accent-soft/60 px-3 py-2 text-xs font-semibold text-accent"
              data-admin-books-glossary-info
            >
              <span data-admin-books-id>{current?.id || glossary.id}</span>
              {current?.isNew && kind === "private" && !targetProblem ? (
                <>
                  <span className="text-muted/60">·</span>
                  <span data-admin-books-new-id>{t("admin.books.newFromTitle")}</span>
                </>
              ) : null}
              <span className="text-muted/60">·</span>
              <span>{t("admin.books.words", { n: glossary.words })}</span>
              <span className="text-muted/60">·</span>
              <span data-admin-books-category-chip={category}>
                {t(category === "speech" ? "discover.cat.speech" : "discover.cat.novel")}
              </span>
            </div>
          ) : null}
          {targetProblem ? (
            <p className="mt-1 text-xs text-warn" role="alert" data-admin-books-id-problem>
              {t(targetProblem)}
            </p>
          ) : null}
        </div>

        <div className="grid gap-2 border-t border-line/50 pt-4">
          <label
            className="text-xs font-bold uppercase tracking-wider text-muted"
            htmlFor="admin-books-epub"
          >
            {t("admin.books.epub")}
          </label>
          <input
            id="admin-books-epub"
            className={cn(field, "py-2 text-xs")}
            type="file"
            accept=".epub,application/epub+zip"
            data-admin-books-epub
            disabled={busy}
            onChange={(event) => {
              void onEpub(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          {epubBusy ? <p className="text-xs text-muted">{t("admin.books.parsing")}</p> : null}
          {epubError ? (
            <p
              className="rounded-xl border border-warn/30 bg-warn-soft/40 p-3 text-xs text-warn"
              role="alert"
            >
              {epubError}
            </p>
          ) : null}
          {parsedTitle ? (
            <div
              className="mt-1 rounded-xl border border-line/80 bg-paper/60 p-3 text-xs"
              data-admin-books-detected
            >
              {t("admin.books.detected", { title: parsedTitle, author: parsedAuthor || "—" })}
            </div>
          ) : null}
        </div>

        {covers.length > 0 ? (
          <div className="grid gap-3 border-t border-line/50 pt-4" data-admin-books-covers>
            <span className="text-xs font-bold uppercase tracking-wider text-muted">
              {t("admin.books.coverPick")}
            </span>
            <div className="flex flex-wrap gap-2.5">
              {covers.map((candidate) => {
                const isSelected = coverChoice === candidate.path;
                return (
                  <label
                    key={candidate.path}
                    title={candidate.path}
                    className={cn(
                      "group relative cursor-pointer overflow-hidden rounded-xl border p-1 transition-all",
                      isSelected
                        ? "border-accent ring-2 ring-accent shadow-sm"
                        : "border-line/80 hover:border-line hover:shadow-2xs",
                    )}
                  >
                    <input
                      type="radio"
                      name="admin-cover"
                      disabled={busy}
                      className="sr-only"
                      checked={isSelected}
                      onChange={() => setCoverChoice(candidate.path)}
                    />
                    <img
                      src={candidate.thumb}
                      alt={candidate.path.split("/").pop() ?? candidate.path}
                      className="h-28 w-auto rounded-lg object-cover"
                    />
                    {isSelected ? (
                      <span className="absolute top-2 right-2 rounded-full bg-accent p-0.5 text-accent-ink shadow-xs">
                        <svg
                          className="size-3"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={3}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-muted">
              <input
                type="radio"
                name="admin-cover"
                className="size-3.5 accent-accent"
                checked={coverChoice === null}
                onChange={() => setCoverChoice(null)}
              />
              {t("admin.books.noCover")}
            </label>
          </div>
        ) : null}

        <div className="grid gap-2 border-t border-line/50 pt-4" data-admin-books-series>
          <label
            className="text-xs font-bold uppercase tracking-wider text-muted"
            htmlFor="admin-books-series"
          >
            {t("admin.books.series")}
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="admin-books-series"
              className={cn(field, "max-w-xs text-xs font-semibold")}
              value={series}
              maxLength={80}
              autoComplete="off"
              placeholder={category === "speech" ? "TED" : "Magic Tree House"}
              lang="en"
              disabled={busy || metadataBusy}
              data-admin-books-series-name
              onChange={(event) => setSeries(event.target.value)}
            />
            <input
              className={cn(field, "w-24 text-xs font-semibold")}
              value={seriesNumber}
              inputMode="numeric"
              autoComplete="off"
              aria-label={t("admin.books.seriesNumber")}
              placeholder={t("admin.books.seriesNumber")}
              disabled={busy || metadataBusy || !series.trim()}
              data-admin-books-series-number
              onChange={(event) =>
                setSeriesNumber(event.target.value.replace(/[^0-9]/g, "").slice(0, 4))
              }
            />
          </div>
          <p className="text-xs text-muted">{t("admin.books.seriesHint")}</p>
        </div>

        <div className="grid gap-2 border-t border-line/50 pt-4">
          <label
            className="text-xs font-bold uppercase tracking-wider text-muted"
            htmlFor="admin-books-isbn"
          >
            {t("admin.books.isbn")}
          </label>
          <input
            id="admin-books-isbn"
            className={cn(field, "max-w-xs text-xs font-semibold")}
            value={isbn}
            inputMode="numeric"
            autoComplete="off"
            disabled={busy}
            data-admin-books-isbn
            onChange={(event) => {
              setIsbnTouched(true);
              setIsbn(event.target.value);
            }}
          />
        </div>

        {metadataBusy ? <p className="text-xs text-muted">{t("account.working")}</p> : null}
        {metadataError ? (
          <div className="grid gap-2" role="alert">
            <p className="text-xs text-warn">{t("admin.books.catalogFailed")}</p>
            <button
              type="button"
              className={cn(btn.primary, "justify-self-start")}
              onClick={() => {
                setMetadataBusy(true);
                setMetadataAttempt((value) => value + 1);
              }}
            >
              {t("dashboard.retry")}
            </button>
          </div>
        ) : null}
        {step ? <p className="text-xs text-muted">{step}</p> : null}
        {note ? <p className="text-xs font-semibold text-accent">{note}</p> : null}
        {error ? (
          <p
            className="rounded-xl border border-warn/30 bg-warn-soft/40 p-3 text-xs text-warn"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <div className="border-t border-line/50 pt-4">
          <button
            type="button"
            className={cn(btn.primary, "px-5 text-xs font-semibold")}
            disabled={!ready || busy}
            data-admin-books-publish
            onClick={() => void publish()}
          >
            {busy ? t("account.working") : t("admin.books.publish")}
          </button>
        </div>
      </div>
    </div>
  );
}
