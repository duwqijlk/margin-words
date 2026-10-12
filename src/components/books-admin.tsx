import { useEffect, useState } from "react";
import JSZip from "jszip";
import { errorText, useT } from "@/lib/i18n";
import { preferredCoverPath } from "@/lib/cover-choice";
import { accountPostForm, accountPostRaw } from "@/lib/sync-engine";
import { parseEpub } from "@/lib/epub";
import { btn, cn, field } from "@/components/ui";

type GlossaryInfo = {
  id: string;
  name: string;
  text: string;
  words: number;
  isbn: string;
};

/** `jpeg` is the card file prepared while the thumbnail was drawn. */
type CoverCandidate = { path: string; thumb: string; jpeg: Uint8Array; bytes: number };

const ERROR_KEYS: Record<string, string> = {
  "unknown-id": "admin.books.publicNew",
  "no-epub": "admin.books.noEpub",
  "no-glossary": "admin.lists.badGlossary",
  "too-large": "admin.lists.tooLarge",
  "no-books-bucket": "admin.error",
  "no-private-bucket": "admin.error",
  "no-catalog": "admin.error",
  "cover-not-saved": "admin.books.coverFailed",
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
function canvasJpeg(bitmap: ImageBitmap, box: { height?: number; maxWidth?: number }, quality: number): string | null {
  const canvas = document.createElement("canvas");
  if (box.height) {
    canvas.height = box.height;
    canvas.width = Math.max(1, Math.round((bitmap.width * box.height) / Math.max(1, bitmap.height)));
  } else {
    canvas.width = Math.min(box.maxWidth ?? bitmap.width, bitmap.width);
    canvas.height = Math.max(1, Math.round((bitmap.height * canvas.width) / Math.max(1, bitmap.width)));
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
  const [epubName, setEpubName] = useState("");
  const [epubBusy, setEpubBusy] = useState(false);
  const [epubError, setEpubError] = useState("");
  const [parsedTitle, setParsedTitle] = useState("");
  const [parsedAuthor, setParsedAuthor] = useState("");
  const [covers, setCovers] = useState<CoverCandidate[]>([]);
  const [coverChoice, setCoverChoice] = useState<string | null>(null);
  const [kind, setKind] = useState<"private" | "public">("private");
  const [isbn, setIsbn] = useState("");
  const [isbnTouched, setIsbnTouched] = useState(false);
  const [step, setStep] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isbnTouched || !glossary?.isbn) return;
    if (!isbn) setIsbn(glossary.isbn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glossary?.isbn]);

  async function onGlossary(file: File | undefined) {
    if (!file) return;
    setNote("");
    setError("");
    const id = file.name.replace(/\.(glossary)?\.json$/i, "").trim().toLowerCase();
    const text = await file.text();
    let isbn = "";
    let words = 0;
    try {
      const data = JSON.parse(text) as { isbn?: unknown; count?: unknown; glossary?: Record<string, unknown> };
      isbn = typeof data.isbn === "string" ? data.isbn.trim() : "";
      words = Number(data.count) || Object.keys(data.glossary ?? {}).length;
    } catch {
      setError(t("admin.lists.badGlossary"));
      return;
    }
    setGlossary({ id, name: file.name, text, isbn, words });
  }

  async function onEpub(file: File | undefined) {
    setEpubError("");
    setParsedTitle("");
    setParsedAuthor("");
    setCovers([]);
    setCoverChoice(null);
    if (!file) {
      setEpubFile(null);
      setEpubName("");
      return;
    }
    setEpubFile(file);
    setEpubName(file.name);
    setEpubBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = await parseEpub(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        {},
      );
      setParsedTitle(parsed.title);
      setParsedAuthor(parsed.author);
      if (!isbnTouched && parsed.isbn) setIsbn(parsed.isbn);
      const candidates = await extractCoverCandidates(file);
      setCovers(candidates);
      setCoverChoice(preferredCoverPath(candidates));
    } catch (reason) {
      // The parse only fills in metadata; the file itself is still publishable.
      setEpubError(errorText(reason, "err.openFailed"));
    } finally {
      setEpubBusy(false);
    }
  }

  async function publish() {
    if (!glossary || !epubFile || busy) return;
    setBusy(true);
    setNote("");
    setError("");
    try {
      const chosen = coverChoice ? covers.find((item) => item.path === coverChoice) : undefined;
      if (coverChoice && (!chosen || chosen.jpeg.byteLength === 0)) {
        setError(t("admin.books.coverFailed"));
        return;
      }
      const isbnParam = isbn.trim() ? encodeURIComponent(isbn.trim()) : "";
      await accountPostRaw(`/api/admin/word-lists?id=${encodeURIComponent(glossary.id)}&isbn=${isbnParam}`, glossary.text);
      setStep(t("admin.books.wordsDone"));
      const form = new FormData();
      form.set("epub", epubFile, "book.epub");
      form.set("glossary", new File([glossary.text], "glossary.json", { type: "application/json" }), "glossary.json");
      if (chosen) {
        const copy = new ArrayBuffer(chosen.jpeg.byteLength);
        new Uint8Array(copy).set(chosen.jpeg);
        form.set("cover", new File([copy], "cover.jpg", { type: "image/jpeg" }));
      }
      await accountPostForm(`/api/admin/books?id=${encodeURIComponent(glossary.id)}&kind=${kind}`, form);
      setStep(t("admin.books.bookDone"));
      setNote(t("admin.lists.published"));
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      setError(t((ERROR_KEYS[code] ?? "admin.lists.error") as Parameters<typeof t>[0]));
    } finally {
      setBusy(false);
    }
  }

  const ready = Boolean(glossary && epubFile && !epubBusy);

  return (
    <div className="grid gap-4" data-admin-books>
      <p className="text-sm text-muted">{t("admin.books.hint")}</p>
      <fieldset className="grid gap-2" data-admin-books-kind>
        <legend className="text-sm font-medium">{t("admin.books.kind")}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="book-kind" checked={kind === "private"} onChange={() => setKind("private")} />
          {t("admin.books.private")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="book-kind" checked={kind === "public"} onChange={() => setKind("public")} />
          {t("admin.books.public")}
        </label>
      </fieldset>
      <label className="grid gap-1 text-sm font-medium" htmlFor="admin-books-glossary">
        {t("admin.lists.file")}
        <input
          id="admin-books-glossary"
          className={cn(field, "py-2")}
          type="file"
          accept=".json,application/json"
          data-admin-books-glossary
          disabled={busy}
          onChange={(event) => {
            void onGlossary(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </label>
      {glossary ? (
        <p className="text-sm" data-admin-books-glossary-info>
          {glossary.id} · {t("admin.books.words", { n: glossary.words })}
        </p>
      ) : null}
      <label className="grid gap-1 text-sm font-medium" htmlFor="admin-books-epub">
        {t("admin.books.epub")}
        <input
          id="admin-books-epub"
          className={cn(field, "py-2")}
          type="file"
          accept=".epub,application/epub+zip"
          data-admin-books-epub
          disabled={busy}
          onChange={(event) => {
            void onEpub(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </label>
      {epubBusy ? <p className="text-sm text-muted">{t("admin.books.parsing")}</p> : null}
      {epubError ? (
        <p className="text-sm text-warn" role="alert">
          {epubError}
        </p>
      ) : null}
      {parsedTitle ? (
        <p className="text-sm" data-admin-books-detected>
          {t("admin.books.detected", { title: parsedTitle, author: parsedAuthor || "—" })}
        </p>
      ) : null}
      {covers.length > 0 ? (
        <div className="grid gap-2" data-admin-books-covers>
          <p className="text-sm font-medium">{t("admin.books.coverPick")}</p>
          <div className="flex flex-wrap gap-2">
            {covers.map((candidate) => (
              <label
                key={candidate.path}
                title={candidate.path}
                className={cn(
                  "rounded-lg border p-1",
                  coverChoice === candidate.path ? "border-accent ring-1 ring-accent" : "border-line",
                )}
              >
                <input
                  type="radio"
                  name="admin-cover"
                  className="sr-only"
                  checked={coverChoice === candidate.path}
                  onChange={() => setCoverChoice(candidate.path)}
                />
                <img src={candidate.thumb} alt={candidate.path.split("/").pop() ?? candidate.path} className="h-28 w-auto" />
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="admin-cover"
              checked={coverChoice === null}
              onChange={() => setCoverChoice(null)}
            />
            {t("admin.books.noCover")}
          </label>
        </div>
      ) : null}
      <label className="grid gap-1 text-sm font-medium" htmlFor="admin-books-isbn">
        {t("admin.books.isbn")}
        <input
          id="admin-books-isbn"
          className={field}
          value={isbn}
          inputMode="numeric"
          autoComplete="off"
          data-admin-books-isbn
          onChange={(event) => {
            setIsbnTouched(true);
            setIsbn(event.target.value);
          }}
        />
      </label>
      {step ? <p className="text-sm text-muted">{step}</p> : null}
      {note ? <p className="text-sm text-accent">{note}</p> : null}
      {error ? (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className={cn(btn.primary, "justify-start")}
        disabled={!ready || busy}
        data-admin-books-publish
        onClick={() => void publish()}
      >
        {busy ? t("account.working") : t("admin.books.publish")}
      </button>
    </div>
  );
}
