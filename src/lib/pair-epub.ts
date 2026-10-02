/**
 * Pair an EPUB the reader already has with a word list from this app.
 * The word list is checked against the book. A low match is reported; it does not block the save
 * until the reader confirms.
 */
import { loadCachedText, saveCachedText } from "@/lib/book-db";
import { editionMatch, matchPercent, type EditionMatch } from "@/lib/edition-match";
import { parseEpub } from "@/lib/epub";
import { validateGlossary } from "@/lib/glossary-format";
import { errorText, tr } from "@/lib/i18n";
import { installPack, resolveAgainst, type InstallResult } from "@/lib/packs";
import type { WordListPack } from "@/lib/word-list-catalog";
import { WORD_LIST_CATALOG_URL } from "@/lib/word-list-catalog";

const cacheKey = (id: string) => `wordlist:${id}`;

export async function cachedWordList(id: string): Promise<string> {
  return loadCachedText(cacheKey(id));
}

export async function fetchWordList(pack: WordListPack, catalogUrl = WORD_LIST_CATALOG_URL): Promise<string> {
  const saved = await cachedWordList(pack.id);
  if (saved) return saved;
  const response = await fetch(resolveAgainst(catalogUrl, pack.glossary.url));
  if (!response.ok) throw new Error(tr("err.bookAddFailed"));
  const text = await response.text();
  await saveCachedText(cacheKey(pack.id), text);
  return text;
}

export type PairPreview = {
  pack: WordListPack;
  bytes: Uint8Array;
  parsed: Awaited<ReturnType<typeof parseEpub>>;
  glossaryText: string;
  match: EditionMatch;
  percent: number;
};

/** Open the reader's EPUB and measure the word list. Nothing is stored yet. */
export async function previewOwnEpub(file: File, pack: WordListPack, glossaryText: string): Promise<PairPreview> {
  const check = validateGlossary(glossaryText);
  if (!check.ok || !check.file) {
    const shown = check.errors.slice(0, 3).join(" ");
    throw new Error(tr("err.pack.listBad", { problems: shown || tr("err.packListUnreadable") }));
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let parsed;
  try {
    parsed = await parseEpub(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  } catch (reason) {
    throw new Error(errorText(reason, "err.openFailed"));
  }
  const paragraphs = parsed.chapters.flatMap((chapter) => chapter.paragraphs);
  const match = editionMatch(check.file, paragraphs);
  return { pack, bytes, parsed, glossaryText, match, percent: matchPercent(match) };
}

/** Store a preview the reader has already seen. */
export async function savePaired(preview: PairPreview): Promise<InstallResult> {
  const { pack, parsed } = preview;
  return installPack({
    packId: pack.id,
    rev: pack.glossary.sha256.slice(0, 12),
    title: pack.title || parsed.title,
    author: pack.author || parsed.author,
    epub: preview.bytes,
    epubSha256: "",
    glossaryText: preview.glossaryText,
    cover: parsed.cover ?? "",
    parsed,
    lexile: pack.lexile,
    isbn: pack.isbn,
    series: pack.series,
    seriesNumber: pack.seriesNumber,
  });
}
