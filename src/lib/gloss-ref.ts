/**
 * Turn a tap into a word-list pointer, and turn that pointer back into the list's own
 * snippet and meaning. The snippet is the anchor `context` written in the list. Nothing
 * here reads the reader's e-book.
 */
import { squash, SQUASH_MIN } from "./flow-text.ts";
import { countSurface, matchAnchor, normText, type GlossaryAnchor, type GlossarySense, type TapInfo } from "./glossary-format.ts";
import { bookGlossKey, catalogListId, glossCacheKey, type GlossPoint } from "./gloss-point.ts";

export { bookGlossKey };
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

function pointFromAnchor(list: string | undefined, lemma: string, anchor: GlossaryAnchor): GlossPoint {
  const point: GlossPoint = { list: catalogListId(list) };
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

/** The list place for this tap. Chapter numbers and the mark come from the anchor, not from the e-book. */
export function pointFromEntry(
  list: string | undefined,
  lemma: string,
  entry: { senses?: GlossarySense[] },
  tap: TapInfo,
): GlossPoint {
  const senses = entry.senses ?? [];
  const hit = matchAnchor(lemma, senses, tap);
  const anchor = hit ? anchorOnSense(lemma, senses[hit.at], tap, hit.via) : undefined;
  if (!anchor) return { list: catalogListId(list) };
  return pointFromAnchor(list, lemma, anchor);
}

function contextIn(sentence: string, context: string): boolean {
  const hay = normText(sentence);
  const needle = normText(context);
  if (!hay || !needle) return false;
  if (hay.includes(needle)) return true;
  const flatHay = squash(hay);
  const flat = squash(needle);
  return flat.length >= SQUASH_MIN && flatHay.includes(flat);
}

/**
 * The anchor whose own context sits inside the sentence this device already stored.
 * The longest context wins. Two different meanings of the same length are left unset,
 * so the card uses the entry meaning instead of guessing a sense.
 */
function bestStoredAnchor(
  entry: { senses?: GlossarySense[] },
  lemma: string,
  surface: string,
  sentence: string,
): GlossaryAnchor | undefined {
  const hits: Array<{ anchor: GlossaryAnchor; meaning: string }> = [];
  for (const sense of entry.senses ?? []) {
    for (const anchor of sense.anchors ?? []) {
      if (!anchor.context || !contextIn(sentence, anchor.context)) continue;
      hits.push({ anchor, meaning: sense.meaning });
    }
  }
  if (hits.length === 0) return undefined;
  const form = (surface || lemma).trim().toLowerCase();
  const formed = hits.filter((hit) => anchorForm(hit.anchor, lemma) === form);
  const pool = formed.length > 0 ? formed : hits;
  let bestLen = -1;
  let best: Array<{ anchor: GlossaryAnchor; meaning: string }> = [];
  for (const hit of pool) {
    const len = normText(hit.anchor.context ?? "").length;
    if (len > bestLen) {
      bestLen = len;
      best = [hit];
    } else if (len === bestLen) best.push(hit);
  }
  const meaning = best[0]?.meaning;
  if (!meaning || best.some((hit) => hit.meaning !== meaning)) return undefined;
  return best[0]?.anchor;
}

/**
 * A pointer for a word saved before pointers existed. The stored sentence is only a haystack:
 * an anchor is chosen when that anchor's own context is inside it. Otherwise the pointer names
 * the list, and the card shows the entry's current meaning. A word that is not in the list
 * returns null (an easy word keeps the sentence it already has).
 */
export function pointFromStored(
  list: string | undefined,
  lemma: string,
  surface: string,
  storedSentence: string | undefined,
  file: GlossFileView,
): GlossPoint | null {
  const entry = entryOf(file, lemma);
  const phrase = phraseOf(file, lemma);
  if (!entry) return phrase?.meaning?.trim() ? phrasePoint(list) : null;
  const anchor = bestStoredAnchor(entry, lemma, surface, storedSentence ?? "");
  if (!anchor) return { list: catalogListId(list) };
  return pointFromAnchor(list, lemma, anchor);
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

type ShownSource = { source: WordSource; fromList: boolean; whyHard: string };

function filledSource(source: WordSource, hit: GlossRead, chapter: number | undefined): WordSource {
  return {
    book: source.book,
    surface: source.surface,
    savedAt: source.savedAt,
    ...(source.ref ? { ref: source.ref } : {}),
    ...(hit.pos || source.pos ? { pos: hit.pos || source.pos } : {}),
    ...(chapter !== undefined ? { chapter } : {}),
    ...(hit.sentence ? { sentence: hit.sentence } : {}),
    ...(hit.meaning ? { meaning: hit.meaning } : {}),
    ...(hit.title ? { title: hit.title } : {}),
    ...(hit.author ? { author: hit.author } : {}),
  };
}

function displaySource(source: WordSource, lemma: string, files: ReadonlyMap<string, GlossFileView>): ShownSource {
  if (source.ref) {
    const bare: WordSource = {
      book: source.book,
      surface: source.surface,
      savedAt: source.savedAt,
      ref: source.ref,
      ...(source.pos ? { pos: source.pos } : {}),
      ...(source.chapter !== undefined ? { chapter: source.chapter } : {}),
    };
    const file = files.get(glossCacheKey(source.ref, source.book));
    if (!file) return { source: bare, fromList: true, whyHard: "" };
    const hit = readPoint(source.ref, lemma, file);
    if (!hit) return { source: bare, fromList: true, whyHard: "" };
    return { source: filledSource(source, hit, source.chapter ?? source.ref.chapter), fromList: true, whyHard: hit.whyHard };
  }
  const file = files.get(bookGlossKey(source.book));
  if (!file) return { source, fromList: false, whyHard: "" };
  const point = pointFromStored(undefined, lemma, source.surface, source.sentence, file);
  if (!point) return { source, fromList: false, whyHard: "" };
  const hit = readPoint(point, lemma, file);
  if (!hit?.meaning) return { source, fromList: false, whyHard: "" };
  return {
    source: filledSource(source, hit, point.chapter ?? source.chapter),
    fromList: true,
    whyHard: hit.whyHard,
  };
}

/**
 * A copy for the notebook and review. Snippet and meaning come from the word list
 * when this device has it, including for a word saved before pointers. Text stored
 * beside that list is left out of the copy. A word that is not in any loaded list
 * keeps the sentence it already has.
 */
export function presentWord(word: VocabEntry, files: ReadonlyMap<string, GlossFileView>): VocabEntry {
  const shown = word.sources.map((source) => displaySource(source, word.lemma, files));
  const sources = shown.map((item) => item.source);
  const lead = shown.find((item) => item.fromList && (item.source.sentence || item.source.meaning));
  if (lead) {
    return {
      ...word,
      sources,
      sentence: lead.source.sentence ?? "",
      meaning: lead.source.meaning ?? "",
      pos: lead.source.pos || word.pos,
      whyHard: lead.whyHard || (shown.every((item) => item.fromList) ? "" : word.whyHard),
    };
  }
  if (shown.length > 0 && shown.every((item) => item.fromList)) {
    return { ...word, sources, sentence: "", meaning: "", whyHard: "" };
  }
  return { ...word, sources };
}

function sourceAsPointer(source: WordSource, point: GlossPoint): WordSource {
  return {
    book: source.book,
    surface: source.surface,
    savedAt: source.savedAt,
    ref: point,
    ...(source.pos ? { pos: source.pos } : {}),
    ...(point.chapter !== undefined ? { chapter: point.chapter } : source.chapter !== undefined ? { chapter: source.chapter } : {}),
  };
}

/**
 * Rewrite sources that still store a sentence into word-list pointers, when this device
 * has that book's list and the list explains the word. The stored sentence is not kept.
 * Returns null when nothing changes. Easy words, and lists that are not loaded, stay as they are.
 */
export function adoptWord(
  word: VocabEntry,
  lists: ReadonlyMap<string, { list: string; file: GlossFileView }>,
): VocabEntry | null {
  let changed = false;
  const sources = word.sources.map((source) => {
    if (source.ref) return source;
    const info = lists.get(source.book);
    if (!info) return source;
    const point = pointFromStored(info.list, word.lemma, source.surface, source.sentence, info.file);
    if (!point) return source;
    const hit = readPoint(point, word.lemma, info.file);
    if (!hit?.meaning) return source;
    changed = true;
    return sourceAsPointer(source, point);
  });
  if (!changed) return null;
  const next: VocabEntry = { ...word, sources };
  if (sources.every((source) => source.ref)) {
    next.sentence = "";
    next.meaning = "";
    next.whyHard = "";
    delete next.uses;
  }
  return next;
}
