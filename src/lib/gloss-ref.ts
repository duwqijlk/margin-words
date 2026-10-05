/**
 * Turn a tap into a word-list pointer, and turn that pointer back into the list's own
 * snippet and meaning. The snippet is the anchor `context` written in the list. Nothing
 * here reads the reader's e-book.
 */
import { squash, SQUASH_MIN } from "./flow-text.ts";
import { countSurface, matchAnchor, normText, type GlossaryAnchor, type GlossarySense, type TapInfo } from "./glossary-format.ts";
import { catalogListId, glossCacheKey, type GlossPoint } from "./gloss-point.ts";
import type { VocabEntry, WordSource } from "./vocab-model.ts";

export type GlossFileView = {
  title?: string;
  author?: string;
  glossary: Record<
    string,
    {
      pos?: string;
      meaning?: string;
      whyHard?: string;
      senses?: GlossarySense[];
    }
  >;
  phrases?: Record<string, { meaning?: string; pos?: string }>;
};

export type GlossRead = {
  sentence: string;
  meaning: string;
  pos: string;
  whyHard: string;
  title: string;
  author: string;
};

/** 8 hex digits from the list's own context, so two copies of the same snippet share a mark. */
export function contextMark(context: string): string {
  const text = normText(context);
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash, 33) + text.charCodeAt(i);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function phrasePoint(list: string | undefined): GlossPoint {
  return { list: catalogListId(list), phrase: true };
}

function formEqualsLemma(form: string, lemma: string): boolean {
  return form.trim().toLowerCase() === lemma.trim().toLowerCase();
}

function anchorOnSense(
  lemma: string,
  sense: GlossarySense | undefined,
  tap: TapInfo,
  via: "anchor" | "context",
): GlossaryAnchor | undefined {
  const anchors = sense?.anchors ?? [];
  const surface = countSurface(tap.surface);
  if (via === "anchor") {
    return anchors.find(
      (anchor) =>
        anchor.chapter === tap.chapter &&
        anchor.occurrence === tap.occurrence &&
        (anchor.form ?? lemma).toLowerCase() === surface,
    );
  }
  const paragraph = normText(tap.paragraph);
  const flatParagraph = squash(paragraph);
  return anchors.find((anchor) => {
    if (!anchor.context) return false;
    if (anchor.chapter !== undefined && anchor.chapter !== tap.chapter) return false;
    const context = normText(anchor.context);
    if (paragraph.includes(context)) return true;
    const flat = squash(context);
    return flat.length >= SQUASH_MIN && flatParagraph.includes(flat);
  });
}

/** The list place for this tap. Chapter numbers and the mark come from the anchor, not from the e-book. */
export function pointFromEntry(
  list: string | undefined,
  lemma: string,
  entry: { senses?: GlossarySense[] },
  tap: TapInfo,
): GlossPoint {
  const point: GlossPoint = { list: catalogListId(list) };
  const senses = entry.senses ?? [];
  const hit = matchAnchor(lemma, senses, tap);
  if (!hit) return point;
  const anchor = anchorOnSense(lemma, senses[hit.at], tap, hit.via);
  if (!anchor) return point;
  if (typeof anchor.chapter === "number" && Number.isFinite(anchor.chapter)) {
    point.chapter = Math.min(100_000, Math.max(0, Math.floor(anchor.chapter)));
  }
  if (typeof anchor.occurrence === "number" && Number.isFinite(anchor.occurrence) && anchor.occurrence >= 1) {
    point.occurrence = Math.min(1_000_000, Math.floor(anchor.occurrence));
  }
  const form = (anchor.form ?? "").trim();
  if (form && !formEqualsLemma(form, lemma)) point.form = form.slice(0, 48);
  const context = (anchor.context ?? "").trim();
  if (context) point.mark = contextMark(context);
  return point;
}

function entryOf(file: GlossFileView, lemma: string) {
  const glossary = file.glossary ?? {};
  const direct = glossary[lemma] ?? glossary[lemma.toLowerCase()];
  if (direct) return direct;
  const want = lemma.trim().toLowerCase();
  for (const [key, entry] of Object.entries(glossary)) {
    if (key.toLowerCase() === want) return entry;
  }
  return undefined;
}

function phraseOf(file: GlossFileView, lemma: string) {
  const phrases = file.phrases ?? {};
  const direct = phrases[lemma] ?? phrases[lemma.toLowerCase()];
  if (direct) return direct;
  const want = lemma.trim().toLowerCase();
  for (const [key, entry] of Object.entries(phrases)) {
    if (key.toLowerCase() === want) return entry;
  }
  return undefined;
}

function wantedForm(point: GlossPoint, lemma: string): string {
  return (point.form ?? lemma).trim().toLowerCase();
}

function anchorForm(anchor: GlossaryAnchor, lemma: string): string {
  return (anchor.form ?? lemma).trim().toLowerCase();
}

function readFields(
  file: GlossFileView,
  entry: { pos?: string; meaning?: string; whyHard?: string },
  sense: GlossarySense | undefined,
  anchor: GlossaryAnchor | undefined,
): GlossRead {
  return {
    sentence: (anchor?.context ?? "").replace(/\s+/g, " ").trim(),
    meaning: (sense?.meaning || entry.meaning || "").replace(/\s+/g, " ").trim(),
    pos: (sense?.pos || entry.pos || "").replace(/\s+/g, " ").trim(),
    whyHard: (sense?.whyHard || entry.whyHard || "").replace(/\s+/g, " ").trim(),
    title: (file.title ?? "").replace(/\s+/g, " ").trim(),
    author: (file.author ?? "").replace(/\s+/g, " ").trim(),
  };
}

/**
 * The snippet and meaning for one pointer. Chapter + occurrence + form win, then the
 * context mark, then the entry's own meaning with an empty snippet. A missing entry
 * returns null. The caller's sentence is never read.
 */
export function readPoint(point: GlossPoint, lemma: string, file: GlossFileView): GlossRead | null {
  if (point.phrase) {
    const phrase = phraseOf(file, lemma);
    if (!phrase?.meaning?.trim()) return null;
    return {
      sentence: "",
      meaning: phrase.meaning.replace(/\s+/g, " ").trim(),
      pos: (phrase.pos ?? "phrase").replace(/\s+/g, " ").trim(),
      whyHard: "",
      title: (file.title ?? "").replace(/\s+/g, " ").trim(),
      author: (file.author ?? "").replace(/\s+/g, " ").trim(),
    };
  }
  const entry = entryOf(file, lemma);
  if (!entry) return null;
  const form = wantedForm(point, lemma);
  let sense: GlossarySense | undefined;
  let anchor: GlossaryAnchor | undefined;
  if (point.chapter !== undefined && point.occurrence !== undefined) {
    for (const candidate of entry.senses ?? []) {
      const found = (candidate.anchors ?? []).find(
        (item) =>
          item.chapter === point.chapter &&
          item.occurrence === point.occurrence &&
          anchorForm(item, lemma) === form,
      );
      if (found) {
        sense = candidate;
        anchor = found;
        break;
      }
    }
  }
  if (!anchor && point.mark) {
    for (const candidate of entry.senses ?? []) {
      const found = (candidate.anchors ?? []).find((item) => item.context && contextMark(item.context) === point.mark);
      if (found) {
        sense = candidate;
        anchor = found;
        break;
      }
    }
  }
  return readFields(file, entry, sense, anchor);
}

function displaySource(source: WordSource, lemma: string, files: ReadonlyMap<string, GlossFileView>): WordSource {
  if (!source.ref) return source;
  const shown: WordSource = {
    book: source.book,
    surface: source.surface,
    savedAt: source.savedAt,
    ref: source.ref,
    ...(source.pos ? { pos: source.pos } : {}),
    ...(source.chapter !== undefined ? { chapter: source.chapter } : {}),
  };
  const file = files.get(glossCacheKey(source.ref, source.book));
  if (!file) return shown;
  const hit = readPoint(source.ref, lemma, file);
  if (!hit) return shown;
  return {
    ...shown,
    ...(hit.sentence ? { sentence: hit.sentence } : {}),
    ...(hit.meaning ? { meaning: hit.meaning } : {}),
    ...(hit.pos ? { pos: hit.pos } : {}),
    ...(hit.title ? { title: hit.title } : {}),
    ...(hit.author ? { author: hit.author } : {}),
  };
}

/**
 * A copy for the notebook and review. A pointer's snippet and meaning come from the
 * word list. Text stored beside the pointer is left out of the copy.
 */
export function presentWord(word: VocabEntry, files: ReadonlyMap<string, GlossFileView>): VocabEntry {
  const sources = word.sources.map((source) => displaySource(source, word.lemma, files));
  const lead = sources.find((source) => source.ref && (source.sentence || source.meaning));
  if (lead?.ref) {
    const file = files.get(glossCacheKey(lead.ref, lead.book));
    const hit = file ? readPoint(lead.ref, word.lemma, file) : null;
    return {
      ...word,
      sources,
      sentence: lead.sentence ?? "",
      meaning: lead.meaning ?? "",
      pos: lead.pos || word.pos,
      whyHard: hit?.whyHard || (word.sources.every((source) => source.ref) ? "" : word.whyHard),
    };
  }
  if (word.sources.length > 0 && word.sources.every((source) => source.ref)) {
    return { ...word, sources, sentence: "", meaning: "", whyHard: "" };
  }
  return { ...word, sources };
}
