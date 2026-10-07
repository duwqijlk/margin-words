/**
 * Pair an EPUB the reader already has with a word list from this app.
 * The word list is checked against the book. A low match is reported; it does not block the save
 * until the reader confirms.
 */
import { loadCachedText, saveCachedText } from "@/lib/book-db";
import { fetchCoverData } from "@/lib/covers";
import { editionMatch, matchPercent, type EditionMatch } from "@/lib/edition-match";
import { applySpineMerge, importedCoverChoice, importSpineWarnings, parseEpub, type SpineNameWarning } from "@/lib/epub";
import { validateGlossary } from "@/lib/glossary-format";
import { errorText, tr } from "@/lib/i18n";
import { hashBytes } from "@/lib/pack-glossary";
import { installPack, resolveAgainst, type InstallResult } from "@/lib/packs";
import { savedListIsCurrent } from "@/lib/word-list-plan";
import type { WordListPack } from "@/lib/word-list-catalog";
import { WORD_LIST_CATALOG_URL } from "@/lib/word-list-catalog";

const cacheKey = (id: string) => `wordlist:${id}`;

export async function cachedWordList(id: string): Promise<string> {
  return loadCachedText(cacheKey(id));
}

/** Keep a newer copy of a word list (the automatic update), so the next pairing uses it. */
export async function storeWordListText(id: string, text: string): Promise<void> {
  await saveCachedText(cacheKey(id), text);
}

export async function fetchWordList(pack: WordListPack, catalogUrl = WORD_LIST_CATALOG_URL): Promise<string> {
  const want = pack.glossary.sha256;
  const saved = await cachedWordList(pack.id);
  // An older copy must not be paired just because it is still on the device.
  // The catalog revision would then say "current" while the stored list is the old one.
  if (saved) {
    const sha = want ? await hashBytes(new TextEncoder().encode(saved)) : "";
    if (savedListIsCurrent(sha, want)) return saved;
  }
  const response = await fetch(resolveAgainst(catalogUrl, pack.glossary.url), { cache: "no-cache" });
  if (!response.ok) throw new Error(tr("err.bookAddFailed"));
  const bytes = new Uint8Array(await response.arrayBuffer());
  const sha = await hashBytes(bytes);
  if (want && sha && sha !== want) throw new Error(tr("err.damaged"));
  const text = new TextDecoder().decode(bytes);
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
  /** spine.merge names that match nothing, or match a file that is not merged. The book can still be saved. */
  warnings: SpineNameWarning[];
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
    parsed = await parseEpub(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
      segmentation: check.file.segmentation,
    });
  } catch (reason) {
    throw new Error(errorText(reason, "err.openFailed"));
  }
  const warnings = importSpineWarnings(check.file.spine?.merge, parsed);
  parsed = applySpineMerge(parsed, check.file.spine?.merge);
  const paragraphs = parsed.chapters.flatMap((chapter) => chapter.paragraphs);
  const match = editionMatch(check.file, paragraphs);
  return { pack, bytes, parsed, glossaryText, match, percent: matchPercent(match), warnings };
}

/** The catalog's card cover, when this word list has one. Empty if it cannot be fetched. */
async function catalogCoverData(pack: WordListPack): Promise<string> {
  if (!pack.cover?.url) return "";
  return fetchCoverData(resolveAgainst(WORD_LIST_CATALOG_URL, pack.cover.url), pack.cover.sha256);
}

/** Store a preview the reader has already seen. */
export async function savePaired(preview: PairPreview): Promise<InstallResult> {
  const { pack, parsed } = preview;
  const tagged = parsed.coverTagged ? parsed.cover ?? "" : "";
  // A tagged OPF cover wins. Otherwise the word-list cover. The portrait image
  // at the start of the book is filled in later, and only when nothing is stored.
  const catalog = tagged ? "" : await catalogCoverData(pack);
  return installPack({
    packId: pack.id,
    rev: pack.glossary.sha256.slice(0, 12),
    title: pack.title || parsed.title,
    author: pack.author || parsed.author,
    epub: preview.bytes,
    epubSha256: "",
    glossaryText: preview.glossaryText,
    cover: importedCoverChoice(tagged, catalog, ""),
    ...(!tagged && catalog
      ? { coverInfo: { source: "catalog" as const, ref: pack.cover?.sha256 ?? "" } }
      : {}),
    also: { title: parsed.title, author: parsed.author },
    parsed,
    lexile: pack.lexile,
    isbn: pack.isbn,
    series: pack.series,
    seriesNumber: pack.seriesNumber,
  });
}
