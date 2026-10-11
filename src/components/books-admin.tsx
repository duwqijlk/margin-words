import { useEffect, useState } from "react";
import { errorText, useT } from "@/lib/i18n";
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

const ERROR_KEYS: Record<string, string> = {
  "unknown-id": "admin.books.publicNew",
  "no-epub": "admin.books.noEpub",
  "no-glossary": "admin.lists.badGlossary",
  "too-large": "admin.lists.tooLarge",
  "no-books-bucket": "admin.error",
  "no-private-bucket": "admin.error",
  "no-catalog": "admin.error",
};

/** Card-sized JPEG, width at most 400px — mirrors scripts/resize-cover.py. */
async function coverBytesFromDataUrl(dataUrl: string): Promise<ArrayBuffer | null> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const width = Math.min(400, bitmap.width);
    const height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!jpeg) return null;
    return await jpeg.arrayBuffer();
  } catch {
    return null;
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Upload a whole book: the word list plus its EPUB, with the ISBN filled in automatically. */
export function BooksAdmin() {
  const { t } = useT();
  const [glossary, setGlossary] = useState<GlossaryInfo | null>(null);
  const [epubName, setEpubName] = useState("");
  const [epubFile, setEpubFile] = useState<File | null>(null);
  const [epubBusy, setEpubBusy] = useState(false);
  const [epubError, setEpubError] = useState("");
  const [parsedTitle, setParsedTitle] = useState("");
  const [parsedAuthor, setParsedAuthor] = useState("");
  const [coverDataUrl, setCoverDataUrl] = useState<string | null>(null);
  const [kind, setKind] = useState<"private" | "public">("private");
  const [isbn, setIsbn] = useState("");
  const [isbnTouched, setIsbnTouched] = useState(false);
  const [autoCover, setAutoCover] = useState(true);
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
    setCoverDataUrl(null);
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
      setCoverDataUrl(parsed.coverTagged ? parsed.cover : null);
      if (!isbnTouched && parsed.isbn) setIsbn(parsed.isbn);
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
      const isbnParam = isbn.trim() ? encodeURIComponent(isbn.trim()) : "";
      await accountPostRaw(`/api/admin/word-lists?id=${encodeURIComponent(glossary.id)}&isbn=${isbnParam}`, glossary.text);
      setStep(t("admin.books.wordsDone"));
      const form = new FormData();
      form.set("epub", epubFile, "book.epub");
      form.set("glossary", new File([glossary.text], "glossary.json", { type: "application/json" }), "glossary.json");
      if (autoCover && coverDataUrl) {
        const cover = await coverBytesFromDataUrl(coverDataUrl);
        if (cover) form.set("cover", new Blob([cover], { type: "image/jpeg" }), "cover.jpg");
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
      {coverDataUrl ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={autoCover} onChange={(event) => setAutoCover(event.target.checked)} />
          {t("admin.books.autoCover")}
        </label>
      ) : null}
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
