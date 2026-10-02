/**
 * Word list ("glossary") format, versions 1 and 2.
 *
 * Almost no imports, so that the same file is used by the app, by the
 * unit tests and by the command-line tools in `scripts/` (validate-glossary.mjs,
 * extract-epub-text.mjs). The written spec is docs/GLOSSARY_FORMAT.md.
 * Runtime imports are ./lexile.ts and ./book-meta.ts. Type-only imports are erased.
 *
 * Version 1: { version: 1, glossary: { lemma: { pos, meaning, whyHard } } }
 * Version 2: the same, plus an optional `senses` array on each word. A sense is
 *            one meaning of the word, with `anchors` that say where in the book
 *            that meaning is used.
 */

import type { ParagraphHelp, SentenceHelp, PhraseEntry } from "@/lib/glossary-extras";
import { isbnDigits, readSeries, seriesNumber } from "@/lib/book-meta";
import { lexileMeasure } from "@/lib/lexile";
import { flowText, flowTextBefore, includesLoose, squash, SQUASH_MIN } from "@/lib/flow-text";

export type GlossaryAnchor = {
  /** 0-based index of the chapter, as the app splits the book (see docs). */
  chapter?: number;
  /** 1-based: the n-th time this word form appears in that chapter. */
  occurrence?: number;
  /** A short piece of the book's own text around the word. */
  context?: string;
  /** The exact word form for `occurrence` (default: the lemma itself). */
  form?: string;
};

export type GlossarySense = {
  pos?: string;
  meaning: string;
  whyHard?: string;
  /** Use this sense when no anchor matches. At most one per word. */
  default?: boolean;
  /** Word forms this sense is for, for example ["saw", "saws"]. */
  forms?: string[];
  anchors?: GlossaryAnchor[];
};

export type GlossaryEntry = {
  pos: string;
  meaning: string;
  whyHard: string;
  forms?: string[];
  senses?: GlossarySense[];
  /** `true`: the author of the book invented this word (for example "snozzcumber"). */
  coined?: boolean;
  /**
   * `true`: this entry exists only to hold position-based senses (anchors). The reader underlines and
   * opens the word ONLY at the places listed in its senses, not at every occurrence in the book.
   */
  senseOnly?: boolean;
};

export type GlossaryFile = {
  version: 1 | 2;
  title?: string;
  author?: string;
  sha256?: string;
  level?: string;
  /** Lexile measure for this edition, such as "880L". Omitted when the list has none. */
  lexile?: string;
  /** ISBN-13 of the edition this list was written for. Omitted when unknown. */
  isbn?: string;
  /** Series title. A name alone is enough. Omitted when the book is not in a series. */
  series?: string;
  /** 1-based place in the series. Omitted when the book has a name but no place. */
  seriesNumber?: number;
  language?: string;
  /** How many chapters the author saw. If the app finds another number, it ignores chapter/occurrence and uses context only. */
  chapters?: number;
  glossary: Record<string, GlossaryEntry>;
  /** Optional help for whole paragraphs (see docs/book-pack-spec.md). */
  paragraphs?: ParagraphHelp[];
  /** Optional help for single sentences. */
  sentences?: SentenceHelp[];
  /** Optional phrasal verbs and idioms, keyed by base form ("give up"). */
  phrases?: Record<string, PhraseEntry>;
};

export const DEFAULT_WHY_HARD = "This word is harder than everyday English.";

/* ------------------------------------------------------------------ tokenization */

/**
 * THE word rule. A "word" is a run of ASCII letters, optionally followed by ONE
 * straight apostrophe and more letters. A curly apostrophe or a hyphen ends a word.
 * The reader, the validator and the text tool all use exactly this rule, on each
 * text node of the chapter (words never run across a tag boundary).
 * Soft hyphens are removed first (see `stripWordBreaksIn`). When a soft hyphen, or an
 * in-word zero-width mark, sits between two inline tags, the letters on both sides are
 * moved into one text node before this rule runs. A line break that only sits between
 * those tags is not a space in the sentence, so the halves still join. A normal hyphen
 * is kept and still ends a word. A space in the text, or a block boundary, is never joined.
 */
export const WORD_PATTERN = "[A-Za-z]+(?:'[A-Za-z]+)?";

/**
 * Drop characters that split a word without being visible.
 * Soft hyphen (U+00AD) is removed everywhere. Zero-width space (U+200B) and word
 * joiner (U+2060) are removed only when they sit inside a word (between letters,
 * or around the one straight apostrophe a word may contain). A normal hyphen
 * (U+002D), en dash, or em dash is left as it is.
 */
export function stripWordBreaks(text: string): string {
  const shy = text.replace(/\u00AD/g, "");
  let out = shy;
  let prev = "";
  // Each pass removes at least one mark, so this cannot run forever.
  while (out !== prev) {
    prev = out;
    out = out
      .replace(/([A-Za-z])[\u200B\u2060]+(?=[A-Za-z'])/g, "$1")
      .replace(/'[\u200B\u2060]+(?=[A-Za-z])/g, "'");
  }
  return out;
}

const BREAK_CHARS = /[\u00AD\u200B\u2060]/;
/** Inlines that must not keep a word split after their only text was a soft hyphen. */
const BREAK_INLINES = new Set(["span", "em", "strong", "i", "b", "sup", "sub"]);
/** A join never crosses one of these. `div` is included: many EPUBs use it as a paragraph. */
const STOP_TAGS = new Set([
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "blockquote",
  "ul",
  "ol",
  "table",
  "tr",
  "td",
  "th",
  "figure",
  "figcaption",
  "pre",
  "section",
  "article",
  "br",
  "hr",
]);

function isBreakChar(ch: string): boolean {
  return ch === "\u00AD" || ch === "\u200B" || ch === "\u2060";
}

/** Space, tab, or line break between tags. Not a non-breaking space. */
function isFormattingWs(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

function isLetter(ch: string): boolean {
  return /[A-Za-z]/.test(ch);
}

/** What a text node in the gap between two halves is made of. Mixed space + mark is "other". */
function gapTextKind(data: string): "empty" | "ws" | "break" | "other" {
  let ws = false;
  let brk = false;
  for (const ch of data) {
    if (isBreakChar(ch)) brk = true;
    else if (isFormattingWs(ch)) ws = true;
    else return "other";
  }
  if (brk && ws) return "other";
  if (brk) return "break";
  if (ws) return "ws";
  return "empty";
}

function stopAncestor(node: Node): Element | null {
  let el = node.parentElement;
  while (el) {
    if (STOP_TAGS.has(el.localName)) return el;
    el = el.parentElement;
  }
  return null;
}

function hasStopElement(node: Node): boolean {
  if (node.nodeType === 1 && STOP_TAGS.has((node as Element).localName)) return true;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (hasStopElement(child)) return true;
  }
  return false;
}

/**
 * The nodes between two text halves. Clean when they are only a word-break mark,
 * inline wrappers that hold nothing but that mark, and whitespace that sits between
 * the tags (a line break in the file). A space inside a wrapper is not clean: it is
 * a space in the sentence.
 */
function gapShape(fragment: Node): { clean: boolean; sawBreak: boolean } {
  let sawBreak = false;
  const visitInside = (node: Node): boolean => {
    if (node.nodeType === 8) return true;
    if (node.nodeType === 3) {
      const kind = gapTextKind((node as Text).data);
      if (kind === "break") sawBreak = true;
      return kind === "break" || kind === "empty";
    }
    if (node.nodeType !== 1) return false;
    const el = node as Element;
    if (!BREAK_INLINES.has(el.localName)) return false;
    for (let child = el.firstChild; child; child = child.nextSibling) {
      if (!visitInside(child)) return false;
    }
    return true;
  };
  for (let child = fragment.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 8) continue;
    if (child.nodeType === 3) {
      const kind = gapTextKind((child as Text).data);
      if (kind === "other") return { clean: false, sawBreak: false };
      if (kind === "break") sawBreak = true;
      continue;
    }
    if (child.nodeType === 1) {
      if (visitInside(child)) continue;
      return { clean: false, sawBreak: false };
    }
    return { clean: false, sawBreak: false };
  }
  return { clean: true, sawBreak };
}

/**
 * True when `left` and `right` are the two sides of one word, and the only thing
 * between them is a soft hyphen or an in-word zero-width mark (plus inline wrappers).
 * Whitespace that only sits between those tags still joins. A space in the text,
 * a normal hyphen, or a block boundary keeps the halves apart.
 */
function joinAcrossBreak(left: Text, right: Text): boolean {
  if (stopAncestor(left) !== stopAncestor(right)) return false;
  const leftStr = left.data;
  let i = leftStr.length - 1;
  while (i >= 0 && isBreakChar(leftStr[i] ?? "")) i -= 1;
  if (i < 0) return false;
  const leftChar = leftStr[i] ?? "";
  const rightStr = right.data;
  let j = 0;
  while (j < rightStr.length && isBreakChar(rightStr[j] ?? "")) j += 1;
  if (j >= rightStr.length) return false;
  const rightChar = rightStr[j] ?? "";
  const doc = left.ownerDocument;
  if (!doc) return false;
  const range = doc.createRange();
  try {
    range.setStartAfter(left);
    range.setEndBefore(right);
  } catch {
    return false;
  }
  const fragment = range.cloneContents();
  if (hasStopElement(fragment)) return false;
  const shape = gapShape(fragment);
  if (!shape.clean) return false;
  const edge = leftStr.slice(i + 1) + rightStr.slice(0, j);
  if (!shape.sawBreak && ![...edge].some(isBreakChar)) return false;
  // The two sides are real text. A whitespace-only node is the gap, not a half.
  if (isFormattingWs(leftChar) || isFormattingWs(rightChar)) return false;
  const marks = [...(edge + (fragment.textContent ?? ""))].filter((ch) => !isFormattingWs(ch));
  // A soft hyphen is a break inside one run of text, even when a normal hyphen
  // sits on the edge (`well-` + mark + `known` stays `well-known`, not `well- known`).
  if (marks.some((ch) => ch === "\u00AD")) return true;
  if (isLetter(leftChar) && isLetter(rightChar)) return true;
  // A zero-width mark may also sit beside the one apostrophe inside a word (don't).
  // This branch is only reached when the gap has no soft hyphen.
  if (marks.length === 0 || marks.some((ch) => ch !== "\u200B" && ch !== "\u2060")) return false;
  if (isLetter(leftChar) && rightChar === "'") {
    return /^[A-Za-z]/.test(rightStr.slice(j + 1).replace(/^[\u200B\u2060]+/, ""));
  }
  if (leftChar === "'" && isLetter(rightChar)) return isLetter(leftStr[i - 1] ?? "");
  return false;
}

function markAncestors(node: Node, touched: Set<Element>) {
  let el = node.parentElement;
  while (el) {
    touched.add(el);
    el = el.parentElement;
  }
}

/**
 * Remove soft hyphens and in-word zero-width marks, then put the letters on both
 * sides of each removed mark into one text node. Inline wrappers (span, em, …)
 * that held only the mark are dropped. Other empty elements are left alone, and
 * words that are really separate stay separate.
 */
export function stripWordBreaksIn(root: ParentNode) {
  const doc = root.ownerDocument;
  if (!doc) return;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const texts: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    texts.push(current as Text);
    current = walker.nextNode();
  }
  const touched = new Set<Element>();
  let left: Text | null = null;
  // Break-only nodes sitting after `left`, cleared only if a later node actually joins.
  let gaps: Text[] = [];
  const clear = (node: Text) => {
    if (!node.data) return;
    node.data = "";
    markAncestors(node, touched);
  };
  for (const node of texts) {
    if (left && stopAncestor(left) !== stopAncestor(node)) {
      left = null;
      gaps = [];
    }
    if (left && joinAcrossBreak(left, node)) {
      const merged =
        left.data.replace(/[\u00AD\u200B\u2060]+$/, "") + node.data.replace(/^[\u00AD\u200B\u2060]+/, "");
      if (merged !== left.data) {
        left.data = merged;
        markAncestors(left, touched);
      }
      clear(node);
      for (const gap of gaps) clear(gap);
      gaps = [];
      continue;
    }
    // A mark-only node, or whitespace that only sits between tags, stays with `left`
    // until a later node joins. It is cleared only when that join happens.
    const kind = gapTextKind(node.data);
    if (kind === "empty" || kind === "ws" || kind === "break") {
      if (left && node.data) gaps.push(node);
      continue;
    }
    gaps = [];
    left = /[A-Za-z]/.test(node.data) ? node : null;
  }
  for (const node of texts) {
    if (!BREAK_CHARS.test(node.data)) continue;
    const next = stripWordBreaks(node.data);
    if (next === node.data) continue;
    node.data = next;
    markAncestors(node, touched);
  }
  // Only wrappers we emptied by removing a break. An empty span that was already
  // empty is left in place, so a book with no soft hyphens keeps its text nodes.
  const doomed = [...touched].filter((el) => {
    if (!BREAK_INLINES.has(el.localName)) return false;
    if (!el.parentNode) return false;
    if (el.querySelector("img, br")) return false;
    return (el.textContent ?? "").trim() === "";
  });
  doomed.sort((a, b) => (a.contains(b) ? 1 : b.contains(a) ? -1 : 0));
  for (const el of doomed) el.remove();
}

/** Split text into alternating non-word / word parts; the odd indexes are words. */
export function splitWords(text: string): string[] {
  return text.split(new RegExp(`(${WORD_PATTERN})`));
}

export function wordsIn(text: string): string[] {
  return text.match(new RegExp(WORD_PATTERN, "g")) ?? [];
}

/** Make two pieces of book text comparable: quotes, dashes, spaces and case are ignored. */
export function normText(text: string): string {
  return stripWordBreaks(text)
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00AD\u200B\u2060\u200C\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\u3040-\u30ff\uac00-\ud7af]/u;
const BLOCK_SELECTOR = "p, li, blockquote, h1, h2, h3, h4";
const SKIPPED_PARENTS = new Set([
  "script",
  "style",
  "iframe",
  "base",
  "meta",
  "link",
  "object",
  "embed",
]);

/** Remove what the reader never shows: scripts and the like are dropped, links and forms are unwrapped. */
export function cleanReadingRoot(root: Element) {
  for (const el of [
    ...root.querySelectorAll("script, style, iframe, base, meta, link, object, embed"),
  ])
    el.remove();
  for (const el of [...root.querySelectorAll("a, form")]) {
    const parent = el.parentNode;
    if (!parent) continue;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    el.remove();
  }
}

/**
 * The text pieces of a chapter that hold words, in reading order. The reader
 * wraps the words of exactly these pieces in tap buttons.
 */
export function wordTextNodes(doc: Document, root: Element): Text[] {
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const out: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    const parent = (current as Text).parentElement;
    const skipped = parent ? SKIPPED_PARENTS.has(parent.localName) : false;
    if (!skipped && /[A-Za-z]/.test((current as Text).data)) out.push(current as Text);
    current = walker.nextNode();
  }
  return out;
}

/** The paragraph-like block that holds a node, the same one the word card uses as its context. */
export function blockOf(node: Node): Element | null {
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  return el ? el.closest(BLOCK_SELECTOR) : null;
}

/**
 * Index the words of one chapter exactly as the reader numbers them.
 * `html` is the chapter html the app stores; `parse` turns html text into a Document
 * (the browser's DOMParser, or jsdom in the command-line tools).
 */
export function indexChapterHtml(html: string, parse: (html: string) => Document): ChapterIndex {
  const doc = parse(`<div>${html}</div>`);
  const root = doc.body.firstElementChild;
  const tokens: { w: string; b: number }[] = [];
  const blocks: string[] = [];
  if (!root) return { tokens, blocks };
  cleanReadingRoot(root);
  stripWordBreaksIn(root);
  const blockIds = new Map<Element, number>();
  for (const node of wordTextNodes(doc, root)) {
    const block = blockOf(node);
    let at = -1;
    if (block) {
      const known = blockIds.get(block);
      if (known !== undefined) at = known;
      else {
        at = blocks.length;
        blockIds.set(block, at);
        blocks.push(stripWordBreaks(flowText(block)));
      }
    }
    const parts = splitWords(node.data);
    for (let i = 1; i < parts.length; i += 2)
      tokens.push({ w: (parts[i] as string).toLowerCase(), b: at });
  }
  return { tokens, blocks };
}

export const hasChinese = (text: string) => CJK_RE.test(text);

/* ------------------------------------------------------------------ validation */

export type GlossaryCheck = {
  ok: boolean;
  /** Problems that stop the import. Each one is a full plain-English sentence. */
  errors: string[];
  /** Things worth knowing; the import can go on. */
  warnings: string[];
  file: GlossaryFile | null;
  stats: {
    words: number;
    senses: number;
    anchors: number;
    /** words, paragraph/sentence/phrase items that contain non-English letters */
    chineseWords: string[];
    paragraphs?: number;
    sentences?: number;
    phrases?: number;
    coined?: number;
  };
};

export const LIMITS = {
  bytes: 8 * 1024 * 1024,
  words: 30000,
  sensesPerWord: 12,
  anchorsPerSense: 60,
  meaning: 600,
  whyHard: 400,
  context: 300,
  lemma: 48,
  paragraphs: 20000,
  sentences: 20000,
  phrases: 5000,
  mainIdea: 400,
  paragraphSimple: 3000,
  sentenceSimple: 800,
  grammar: 400,
  hardWords: 20,
  phraseKey: 60,
  example: 400,
} as const;

const MAX_ISSUES = 40;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const q = (value: string) => `"${value.length > 40 ? `${value.slice(0, 40)}...` : value}"`;

class Issues {
  errors: string[] = [];
  warnings: string[] = [];
  more = 0;
  error(message: string) {
    if (this.errors.length < MAX_ISSUES) this.errors.push(message);
    else this.more += 1;
  }
  warn(message: string) {
    if (this.warnings.length < MAX_ISSUES) this.warnings.push(message);
  }
}

function jsonProblem(text: string, error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  const at = raw.match(/position (\d+)/);
  let where = "";
  if (at) {
    const index = Number(at[1]);
    const line = text.slice(0, index).split("\n").length;
    where = ` Look near line ${line}.`;
  }
  return `This file is not valid JSON, so it cannot be read.${where} Common causes: a missing comma, a missing quote mark, or a comma after the last item.`;
}

function textField(
  issues: Issues,
  where: string,
  value: unknown,
  name: string,
  max: number,
  required: boolean,
): string | undefined {
  if (value === undefined || value === null) {
    if (required) issues.error(`${where} has no "${name}".`);
    return undefined;
  }
  if (typeof value !== "string") {
    issues.error(`${where}: "${name}" must be text (in quote marks).`);
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) issues.error(`${where}: "${name}" is empty.`);
    return undefined;
  }
  if (trimmed.length > max) {
    issues.error(
      `${where}: "${name}" is too long (${trimmed.length} letters; the limit is ${max}).`,
    );
    return undefined;
  }
  return trimmed;
}

function formsField(issues: Issues, where: string, value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    issues.error(`${where}: "forms" must be a list of words, like ["saw", "saws"].`);
    return undefined;
  }
  const out = value.map((item) => (item as string).trim().toLowerCase()).filter(Boolean);
  for (const form of out) {
    if (wordsIn(form).join("") !== form)
      issues.warn(
        `${where}: the form ${q(form)} is not one plain word. It will not match the book.`,
      );
  }
  return out;
}

function checkAnchor(
  issues: Issues,
  where: string,
  lemma: string,
  known: Set<string>,
  raw: unknown,
): GlossaryAnchor | null {
  if (!isObject(raw)) {
    issues.error(
      `${where}: each anchor must be an object like { "chapter": 0, "occurrence": 1, "context": "..." }.`,
    );
    return null;
  }
  const out: GlossaryAnchor = {};
  let bad = false;
  if (raw.chapter !== undefined) {
    if (!Number.isInteger(raw.chapter) || (raw.chapter as number) < 0) {
      issues.error(
        `${where}: "chapter" must be a whole number from 0 up (the first chapter is 0).`,
      );
      bad = true;
    } else out.chapter = raw.chapter as number;
  }
  if (raw.occurrence !== undefined) {
    if (!Number.isInteger(raw.occurrence) || (raw.occurrence as number) < 1) {
      issues.error(
        `${where}: "occurrence" must be a whole number from 1 up (the first time is 1).`,
      );
      bad = true;
    } else out.occurrence = raw.occurrence as number;
  }
  if (raw.form !== undefined) {
    const form = textField(issues, where, raw.form, "form", LIMITS.lemma, false);
    if (form) out.form = form.toLowerCase();
    else bad = true;
  }
  if (raw.context !== undefined) {
    const context = textField(issues, where, raw.context, "context", LIMITS.context, false);
    if (context) out.context = context;
    else bad = true;
  }
  if (bad) return null;
  if (out.occurrence !== undefined && out.chapter === undefined) {
    issues.error(`${where}: "occurrence" needs a "chapter" too.`);
    return null;
  }
  const hasPlace = out.chapter !== undefined && out.occurrence !== undefined;
  if (!hasPlace && !out.context) {
    issues.error(`${where}: an anchor needs "context", or both "chapter" and "occurrence".`);
    return null;
  }
  if (out.context) {
    const count = wordsIn(out.context).length;
    if (count < 4)
      issues.warn(
        `${where}: the context is very short (${count} words). It may match in the wrong place. Use 6 to 12 words.`,
      );
    else if (count > 30)
      issues.warn(`${where}: the context is long (${count} words). Use 6 to 12 words.`);
    const target = out.form ? new Set([out.form]) : known;
    const found = wordsIn(out.context).some((w) => target.has(w.toLowerCase()));
    if (!found)
      issues.warn(
        `${where}: the context does not seem to contain the word ${q(out.form ?? lemma)}. The snippet must include the word itself.`,
      );
  }
  return out;
}

function checkSense(
  issues: Issues,
  lemma: string,
  index: number,
  known: Set<string>,
  raw: unknown,
): GlossarySense | null {
  const where = `The word ${q(lemma)}, meaning ${index + 1}`;
  if (!isObject(raw)) {
    issues.error(`${where}: each item in "senses" must be an object with a "meaning".`);
    return null;
  }
  const meaning = textField(issues, where, raw.meaning, "meaning", LIMITS.meaning, true);
  const sense: GlossarySense = { meaning: meaning ?? "" };
  const pos = textField(issues, where, raw.pos, "pos", 48, false);
  if (pos) sense.pos = pos;
  const why = textField(issues, where, raw.whyHard, "whyHard", LIMITS.whyHard, false);
  if (why) sense.whyHard = why;
  if (raw.default !== undefined) {
    if (typeof raw.default !== "boolean")
      issues.error(`${where}: "default" must be true or false.`);
    else if (raw.default) sense.default = true;
  }
  const forms = formsField(issues, where, raw.forms);
  if (forms && forms.length) sense.forms = forms;
  if (raw.anchors !== undefined) {
    if (!Array.isArray(raw.anchors)) {
      issues.error(`${where}: "anchors" must be a list.`);
    } else if (raw.anchors.length > LIMITS.anchorsPerSense) {
      issues.error(
        `${where}: too many anchors (${raw.anchors.length}; the limit is ${LIMITS.anchorsPerSense}).`,
      );
    } else {
      const names = new Set([...known, ...(sense.forms ?? [])]);
      const list: GlossaryAnchor[] = [];
      raw.anchors.forEach((item, at) => {
        const anchor = checkAnchor(issues, `${where}, anchor ${at + 1}`, lemma, names, item);
        if (anchor) list.push(anchor);
      });
      if (list.length) sense.anchors = list;
    }
  }
  return meaning ? sense : null;
}

/* ------------------------------------------------------------------ extras (paragraphs, sentences, phrases) */

const PHRASE_POS = new Set(["phrasal verb", "idiom", "phrase"]);

function checkExtras(
  issues: Issues,
  data: Record<string, unknown>,
  out: GlossaryFile,
  stats: GlossaryCheck["stats"],
) {
  const cjk: string[] = stats.chineseWords;
  const mark = (label: string, ...texts: Array<string | undefined>) => {
    if (texts.some((t) => t && hasChinese(t))) cjk.push(label);
  };
  const place = (value: unknown, where: string, name: string, min: number): number | null => {
    if (!Number.isInteger(value) || (value as number) < min) {
      issues.error(
        `${where}: "${name}" must be a whole number from ${min} up${min === 0 ? " (the first one is 0)" : ""}.`,
      );
      return null;
    }
    return value as number;
  };
  const context = (where: string, raw: unknown): string | null => {
    const text = textField(issues, where, raw, "context", LIMITS.context, true);
    if (!text) return null;
    const n = wordsIn(text).length;
    if (n < 4)
      issues.warn(
        `${where}: the context is very short (${n} words). It may match the wrong place. Use 6 to 14 words.`,
      );
    else if (n > 30) issues.warn(`${where}: the context is long (${n} words). Use 6 to 14 words.`);
    return text;
  };

  if (data.paragraphs !== undefined) {
    if (!Array.isArray(data.paragraphs))
      issues.error('"paragraphs" must be a list of paragraph notes.');
    else if (data.paragraphs.length > LIMITS.paragraphs)
      issues.error(`There are too many paragraph notes (the limit is ${LIMITS.paragraphs}).`);
    else {
      const list: ParagraphHelp[] = [];
      const seen = new Set<string>();
      data.paragraphs.forEach((raw, at) => {
        const where = `Paragraph note ${at + 1}`;
        if (!isObject(raw)) {
          issues.error(
            `${where} must be an object with "chapter", "paragraph", "context", "mainIdea" and "simple".`,
          );
          return;
        }
        const chapter = place(raw.chapter, where, "chapter", 0);
        const paragraph = place(raw.paragraph, where, "paragraph", 0);
        const ctx = context(where, raw.context);
        const mainIdea = textField(issues, where, raw.mainIdea, "mainIdea", LIMITS.mainIdea, true);
        const simple = textField(issues, where, raw.simple, "simple", LIMITS.paragraphSimple, true);
        let hardWords: string[] | undefined;
        if (raw.hardWords !== undefined) {
          if (
            !Array.isArray(raw.hardWords) ||
            raw.hardWords.some((w) => typeof w !== "string" || !w.trim())
          ) {
            issues.error(
              `${where}: "hardWords" must be a list of words or short phrases from the paragraph.`,
            );
          } else if (raw.hardWords.length > LIMITS.hardWords) {
            issues.error(`${where}: too many "hardWords" (the limit is ${LIMITS.hardWords}).`);
          } else hardWords = (raw.hardWords as string[]).map((w) => w.trim());
        }
        if (chapter === null || paragraph === null || !ctx || !mainIdea || !simple) return;
        const id = `${chapter}/${paragraph}`;
        if (seen.has(id)) {
          issues.warn(
            `${where}: chapter ${chapter}, paragraph ${paragraph} already has a note. The first one is used.`,
          );
          return;
        }
        seen.add(id);
        mark(`paragraph ${chapter}/${paragraph}`, ctx, mainIdea, simple, ...(hardWords ?? []));
        list.push({
          chapter,
          paragraph,
          context: ctx,
          mainIdea,
          simple,
          ...(hardWords?.length ? { hardWords } : {}),
        });
      });
      if (list.length) out.paragraphs = list;
    }
  }

  if (data.sentences !== undefined) {
    if (!Array.isArray(data.sentences))
      issues.error('"sentences" must be a list of sentence notes.');
    else if (data.sentences.length > LIMITS.sentences)
      issues.error(`There are too many sentence notes (the limit is ${LIMITS.sentences}).`);
    else {
      const list: SentenceHelp[] = [];
      data.sentences.forEach((raw, at) => {
        const where = `Sentence note ${at + 1}`;
        if (!isObject(raw)) {
          issues.error(
            `${where} must be an object with "chapter", "context", "simple" and "grammar".`,
          );
          return;
        }
        const chapter = place(raw.chapter, where, "chapter", 0);
        const ctx = context(where, raw.context);
        const simple = textField(issues, where, raw.simple, "simple", LIMITS.sentenceSimple, true);
        const grammar = textField(issues, where, raw.grammar, "grammar", LIMITS.grammar, true);
        if (chapter === null || !ctx || !simple || !grammar) return;
        mark(`sentence ${chapter}/${at + 1}`, ctx, simple, grammar);
        list.push({ chapter, context: ctx, simple, grammar });
      });
      if (list.length) out.sentences = list;
    }
  }

  if (data.phrases !== undefined) {
    if (!isObject(data.phrases))
      issues.error('"phrases" must be an object, like { "give up": { "meaning": "..." } }.');
    else {
      const rows = Object.entries(data.phrases);
      if (rows.length > LIMITS.phrases)
        issues.error(`There are too many phrases (the limit is ${LIMITS.phrases}).`);
      else {
        const map: Record<string, PhraseEntry> = {};
        for (const [rawKey, raw] of rows) {
          const key = rawKey
            .trim()
            .toLowerCase()
            .replace(/[\u2018\u2019\u02bc]/g, "'")
            .replace(/\s+/g, " ");
          const where = `The phrase ${q(rawKey)}`;
          if (
            !key ||
            key.length > LIMITS.phraseKey ||
            !/^[a-z]+(?:['-]?[a-z]+)*(?: [a-z]+(?:['-]?[a-z]+)*)+$/.test(key)
          ) {
            issues.error(
              `${where} must be two or more plain English words in lower case, like "give up" or "break the ice".`,
            );
            continue;
          }
          if (map[key]) {
            issues.error(`${where} appears twice. Keep one.`);
            continue;
          }
          if (!isObject(raw)) {
            issues.error(`${where} must be an object with at least a "meaning".`);
            continue;
          }
          const meaning = textField(issues, where, raw.meaning, "meaning", LIMITS.meaning, true);
          const entry: PhraseEntry = { meaning: meaning ?? "" };
          if (raw.pos !== undefined) {
            if (typeof raw.pos === "string" && PHRASE_POS.has(raw.pos))
              entry.pos = raw.pos as PhraseEntry["pos"];
            else issues.error(`${where}: "pos" must be "phrasal verb", "idiom" or "phrase".`);
          }
          const forms = formsFieldPhrase(issues, where, raw.forms);
          if (forms?.length) entry.forms = forms;
          const example = textField(issues, where, raw.example, "example", LIMITS.example, false);
          if (example) entry.example = example;
          if (!meaning) continue;
          mark(`phrase ${key}`, meaning, example, ...(forms ?? []));
          map[key] = entry;
        }
        if (Object.keys(map).length) out.phrases = map;
      }
    }
  }
}

function formsFieldPhrase(issues: Issues, where: string, value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    issues.error(`${where}: "forms" must be a list of phrases, like ["gave up", "giving up"].`);
    return undefined;
  }
  return value
    .map((item) => (item as string).trim().toLowerCase().replace(/\s+/g, " "))
    .filter(Boolean);
}

/**
 * Check a word list (JSON text, or an already parsed value). Never throws.
 * `file` is the cleaned-up list when there are no errors.
 */
export function validateGlossary(input: unknown): GlossaryCheck {
  const issues = new Issues();
  const stats: GlossaryCheck["stats"] = { words: 0, senses: 0, anchors: 0, chineseWords: [] };
  const fail = (): GlossaryCheck => ({
    ok: false,
    errors: issues.more
      ? [...issues.errors, `...and ${issues.more} more problems.`]
      : issues.errors,
    warnings: issues.warnings,
    file: null,
    stats,
  });

  let data: unknown = input;
  if (typeof input === "string") {
    if (input.length > LIMITS.bytes) {
      issues.error("This file is too big (more than 8 MB). Please use a smaller word list.");
      return fail();
    }
    try {
      data = JSON.parse(input.replace(/^\uFEFF/, ""));
    } catch (error) {
      issues.error(jsonProblem(input, error));
      return fail();
    }
  }
  if (!isObject(data)) {
    issues.error(
      'The file must be one JSON object that starts with { and has "version" and "glossary".',
    );
    return fail();
  }
  const version = data.version;
  if (version === undefined) {
    issues.error(
      'The file has no "version". Add "version": 2 at the top (or 1 for the old format).',
    );
  } else if (version !== 1 && version !== 2) {
    issues.error(
      `This reader knows "version" 1 and 2, but the file says ${JSON.stringify(version)}.`,
    );
  }
  if (!isObject(data.glossary)) {
    issues.error(
      data.glossary === undefined
        ? 'The file has no "glossary" part. It should be an object with one entry for each word.'
        : 'The "glossary" part must be an object with one entry for each word, not a list.',
    );
  }
  if (issues.errors.length) return fail();

  const v = version as 1 | 2;
  const out: GlossaryFile = { version: v, glossary: {} };
  if (data.chapters !== undefined) {
    if (Number.isInteger(data.chapters) && (data.chapters as number) > 0)
      out.chapters = data.chapters as number;
    else issues.warn('"chapters" should be a whole number. It was ignored.');
  }
  for (const name of ["title", "author", "sha256", "level", "language"] as const) {
    const value = data[name];
    if (typeof value === "string" && value.trim()) out[name] = value.trim().slice(0, 200);
    else if (value !== undefined && typeof value !== "string")
      issues.warn(`"${name}" should be text. It was ignored.`);
  }
  if (data.lexile !== undefined) {
    const measure = lexileMeasure(data.lexile);
    if (measure) out.lexile = measure;
    else issues.warn('"lexile" should look like 880L. It was ignored.');
  }
  if (data.isbn !== undefined) {
    const isbn = isbnDigits(data.isbn);
    if (isbn) out.isbn = isbn;
    else issues.warn('"isbn" should be an ISBN-13 or ISBN-10. It was ignored.');
  }
  if (data.series !== undefined || data.seriesNumber !== undefined) {
    const series = readSeries(data.series, data.seriesNumber);
    if (series.series) {
      out.series = series.series;
      if (series.seriesNumber) out.seriesNumber = series.seriesNumber;
    } else if (seriesNumber(data.seriesNumber))
      issues.warn('"seriesNumber" needs a series name, such as "Narnia". It was ignored.');
    else if (data.series !== undefined)
      issues.warn('"series" should be a short name. It was ignored.');
  }

  const rows = Object.entries(data.glossary as Record<string, unknown>);
  if (rows.length === 0) issues.error("The word list is empty. Add at least one word.");
  if (rows.length > LIMITS.words)
    issues.error(`There are too many words (${rows.length}; the limit is ${LIMITS.words}).`);
  if (issues.errors.length) return fail();

  const seen = new Set<string>();
  for (const [rawLemma, raw] of rows) {
    const lemma = rawLemma
      .trim()
      .toLowerCase()
      .replace(/[\u2018\u2019\u02bc]/g, "'");
    if (!lemma || lemma.length > LIMITS.lemma || !/^[a-z]+(?:['-][a-z]+)*$/.test(lemma)) {
      issues.error(
        `The word ${q(rawLemma)} is not a plain English word. Use letters only (an apostrophe or hyphen in the middle is allowed).`,
      );
      continue;
    }
    if (lemma.includes("-"))
      issues.warn(
        `The word ${q(lemma)} has a hyphen. The reader splits words at hyphens, so this entry may never match. Add the parts as separate words.`,
      );
    if (seen.has(lemma)) {
      issues.error(
        `The word ${q(lemma)} appears twice (capital letters do not make it different). Keep one.`,
      );
      continue;
    }
    seen.add(lemma);
    const where = `The word ${q(lemma)}`;
    if (!isObject(raw)) {
      issues.error(`${where} must be an object with at least a "meaning".`);
      continue;
    }
    const hasSenses = raw.senses !== undefined;
    if (hasSenses && v === 1) {
      issues.error(
        `${where} has "senses", but this list says "version": 1. Change "version" to 2.`,
      );
      continue;
    }
    let senses: GlossarySense[] | undefined;
    const forms = formsField(issues, where, raw.forms);
    const known = new Set([lemma, ...(forms ?? [])]);
    if (hasSenses) {
      if (!Array.isArray(raw.senses) || raw.senses.length === 0) {
        issues.error(`${where}: "senses" must be a list with at least one meaning.`);
        continue;
      }
      if (raw.senses.length > LIMITS.sensesPerWord) {
        issues.error(
          `${where} has too many meanings (${raw.senses.length}; the limit is ${LIMITS.sensesPerWord}).`,
        );
        continue;
      }
      senses = [];
      raw.senses.forEach((item, index) => {
        const sense = checkSense(issues, lemma, index, known, item);
        if (sense) senses?.push(sense);
      });
      if (senses.filter((s) => s.default).length > 1)
        issues.error(`${where} has more than one meaning with "default": true. Keep only one.`);
      // The same place may not point to two different meanings.
      const places = new Map<string, number>();
      senses.forEach((sense, at) => {
        for (const anchor of sense.anchors ?? []) {
          if (anchor.chapter === undefined || anchor.occurrence === undefined) continue;
          const key = `${anchor.chapter}/${(anchor.form ?? lemma).toLowerCase()}/${anchor.occurrence}`;
          const other = places.get(key);
          if (other !== undefined && other !== at)
            issues.error(
              `${where} has two different meanings for chapter ${anchor.chapter}, occurrence ${anchor.occurrence}. A place can have only one meaning.`,
            );
          places.set(key, at);
        }
      });
    }
    const meaning = textField(issues, where, raw.meaning, "meaning", LIMITS.meaning, !hasSenses);
    const pos = textField(issues, where, raw.pos, "pos", 48, false);
    const whyHard = textField(issues, where, raw.whyHard, "whyHard", LIMITS.whyHard, false);
    if (v === 1 && !pos)
      issues.warn(`${where} has no "pos" (part of speech). It will show without one.`);
    const entry: GlossaryEntry = {
      pos: pos ?? senses?.[0]?.pos ?? "",
      meaning: meaning ?? "",
      whyHard: whyHard ?? DEFAULT_WHY_HARD,
    };
    if (forms && forms.length) entry.forms = forms;
    if (raw.coined !== undefined) {
      if (typeof raw.coined !== "boolean")
        issues.error(`${where}: "coined" must be true or false.`);
      else if (raw.coined) {
        entry.coined = true;
        stats.coined = (stats.coined ?? 0) + 1;
      }
    }
    if (raw.senseOnly !== undefined) {
      if (typeof raw.senseOnly !== "boolean")
        issues.error(`${where}: "senseOnly" must be true or false.`);
      else if (raw.senseOnly) {
        entry.senseOnly = true;
        if (!senses?.some((sense) => sense.anchors?.length))
          issues.warn(
            `${where} says "senseOnly": true but none of its meanings has "anchors". It will never be underlined.`,
          );
      }
    }
    if (senses && senses.length) {
      if (!entry.meaning) {
        // No own meaning: the first meaning doubles as the word's default.
        entry.meaning = (senses[0] as GlossarySense).meaning;
        if (!entry.pos) entry.pos = (senses[0] as GlossarySense).pos ?? "";
      }
      entry.senses = senses;
      stats.senses += senses.length;
      stats.anchors += senses.reduce((n, s) => n + (s.anchors?.length ?? 0), 0);
    }
    const all = [
      entry.meaning,
      entry.pos,
      entry.whyHard,
      ...(senses ?? []).flatMap((s) => [s.meaning, s.pos ?? "", s.whyHard ?? ""]),
    ];
    if (all.some(hasChinese)) stats.chineseWords.push(lemma);
    out.glossary[lemma] = entry;
    stats.words += 1;
  }
  checkExtras(issues, data, out, stats);
  if (issues.errors.length) return fail();
  stats.paragraphs = out.paragraphs?.length ?? 0;
  stats.sentences = out.sentences?.length ?? 0;
  stats.phrases = Object.keys(out.phrases ?? {}).length;
  return { ok: true, errors: [], warnings: issues.warnings, file: out, stats };
}

/* ------------------------------------------------------------------ book check */

/** One chapter as seen by the reader: its words in order, and the paragraphs. */
export type ChapterIndex = {
  /** every word in reading order; `b` is the index of its paragraph in `blocks` (-1: none) */
  tokens: { w: string; b: number }[];
  blocks: string[];
};

/**
 * Check anchors against the real text of a book. `strict` is for the command-line
 * validator (a snippet that is not in the book is an error); the app uses warnings.
 */
export function checkAgainstBook(
  file: GlossaryFile,
  chapters: ChapterIndex[],
  strict: boolean,
): { errors: string[]; warnings: string[]; checked: number; missing: number } {
  const errors: string[] = [];
  const warnings: string[] = [];
  let checked = 0;
  let missing = 0;
  const normBlocks = chapters.map((c) => c.blocks.map(normText));
  const report = (message: string) => {
    missing += 1;
    if (strict) {
      if (errors.length < MAX_ISSUES) errors.push(message);
    } else if (warnings.length < MAX_ISSUES) warnings.push(message);
  };
  for (const [lemma, entry] of Object.entries(file.glossary)) {
    (entry.senses ?? []).forEach((sense, senseAt) => {
      (sense.anchors ?? []).forEach((anchor, anchorAt) => {
        checked += 1;
        const where = `The word ${q(lemma)}, meaning ${senseAt + 1}, anchor ${anchorAt + 1}`;
        const form = (anchor.form ?? lemma).toLowerCase();
        const context = anchor.context ? normText(anchor.context) : "";
        let blockAt = -1;
        if (anchor.chapter !== undefined) {
          const chapter = chapters[anchor.chapter];
          if (!chapter) {
            report(
              `${where}: the book has only ${chapters.length} chapters, so chapter ${anchor.chapter} does not exist (the first chapter is 0).`,
            );
            return;
          }
          if (anchor.occurrence !== undefined) {
            let seen = 0;
            let hit: { w: string; b: number } | undefined;
            for (const token of chapter.tokens) {
              if (token.w !== form) continue;
              seen += 1;
              if (seen === anchor.occurrence) {
                hit = token;
                break;
              }
            }
            if (!hit) {
              report(
                `${where}: chapter ${anchor.chapter} has the word ${q(form)} only ${seen} time(s), so occurrence ${anchor.occurrence} does not exist.`,
              );
              return;
            }
            blockAt = hit.b;
            if (
              context &&
              blockAt >= 0 &&
              !includesText(normBlocks[anchor.chapter]?.[blockAt] ?? "", context)
            ) {
              report(
                `${where}: occurrence ${anchor.occurrence} of ${q(form)} in chapter ${anchor.chapter} is not inside the text ${q(anchor.context ?? "")}. The chapter or occurrence number is probably wrong.`,
              );
              return;
            }
          }
        }
        if (context && blockAt < 0) {
          const scope = anchor.chapter !== undefined ? [anchor.chapter] : chapters.map((_, i) => i);
          const count = scope.reduce(
            (n, i) => n + (normBlocks[i] ?? []).filter((b) => includesText(b, context)).length,
            0,
          );
          if (count === 0) {
            report(
              `${where}: the text ${q(anchor.context ?? "")} was not found in ${anchor.chapter !== undefined ? `chapter ${anchor.chapter}` : "the book"}. Copy the words exactly from one paragraph of the book.`,
            );
          } else if (count > 1 && anchor.chapter === undefined) {
            if (warnings.length < MAX_ISSUES)
              warnings.push(
                `${where}: the text ${q(anchor.context ?? "")} appears ${count} times in the book. Add "chapter" and "occurrence" to be exact.`,
              );
          }
        }
      });
    });
  }
  return { errors, warnings, checked, missing };
}

/**
 * Check paragraph and sentence notes against the real paragraphs of a book (the same
 * `chapter.paragraphs` the reader numbers, starting at 0). `strict` is for the command-line
 * validator (a snippet that is not in the book is an error); the app uses warnings.
 */
export function checkExtrasAgainstBook(
  file: GlossaryFile,
  chapters: Array<{ paragraphs: string[] }>,
  strict: boolean,
): { errors: string[]; warnings: string[]; checked: number; missing: number; moved: number } {
  const errors: string[] = [];
  const warnings: string[] = [];
  let checked = 0;
  let missing = 0;
  let moved = 0;
  // same rule as looseText() in help-match.ts: quotes and punctuation do not count, apostrophes inside words do
  const loose = (t: string) =>
    normText(t)
      .replace(/(\w)'(?=\w)/g, "$1\ue000")
      .replace(/[^a-z0-9\ue000]+/g, " ")
      .replace(/\ue000/g, "'")
      .trim();
  const looseChapters = chapters.map((c) => c.paragraphs.map(loose));
  const report = (message: string) => {
    missing += 1;
    if (strict) {
      if (errors.length < MAX_ISSUES) errors.push(message);
    } else if (warnings.length < MAX_ISSUES) warnings.push(message);
  };
  const has = (text: string, context: string) => includesLoose(text, loose(context));
  (file.paragraphs ?? []).forEach((note, at) => {
    checked += 1;
    const where = `Paragraph note ${at + 1} (chapter ${note.chapter}, paragraph ${note.paragraph})`;
    const chapter = looseChapters[note.chapter];
    if (!chapter) {
      report(
        `${where}: the book has only ${chapters.length} chapters, so chapter ${note.chapter} does not exist (the first chapter is 0).`,
      );
      return;
    }
    const text = chapter[note.paragraph];
    if (text === undefined) {
      report(
        `${where}: chapter ${note.chapter} has only ${chapter.length} paragraphs, so paragraph ${note.paragraph} does not exist (the first paragraph is 0).`,
      );
      return;
    }
    if (!has(text, note.context)) {
      const elsewhere = chapter.findIndex((t) => has(t, note.context));
      if (elsewhere >= 0) {
        moved += 1;
        report(
          `${where}: the context ${q(note.context)} is in paragraph ${elsewhere} of that chapter, not in paragraph ${note.paragraph}. Fix the paragraph number.`,
        );
      } else
        report(
          `${where}: the context ${q(note.context)} is not in that paragraph. Copy 6 to 14 words exactly from it.`,
        );
    }
  });
  (file.sentences ?? []).forEach((note, at) => {
    checked += 1;
    const where = `Sentence note ${at + 1} (chapter ${note.chapter})`;
    const chapter = looseChapters[note.chapter];
    if (!chapter) {
      report(
        `${where}: the book has only ${chapters.length} chapters, so chapter ${note.chapter} does not exist (the first chapter is 0).`,
      );
      return;
    }
    if (!chapter.some((t) => has(t, note.context))) {
      const other = looseChapters.findIndex((c) => c.some((t) => has(t, note.context)));
      report(
        other >= 0
          ? `${where}: the context ${q(note.context)} is in chapter ${other}, not in chapter ${note.chapter}. Fix the chapter number.`
          : `${where}: the context ${q(note.context)} was not found in the book. Copy 6 to 14 words exactly from one sentence.`,
      );
      return;
    }
    // The snippet must sit inside ONE sentence-sized piece: it may not cross a paragraph break (checked above) .
  });
  return { errors, warnings, checked, missing, moved };
}

/**
 * If the list says how many chapters the author saw and this copy of the book has a
 * different number, chapter/occurrence numbers cannot be trusted. Drop them and keep
 * the context text, which still works.
 */
export function forBook(file: GlossaryFile, chapterCount: number): GlossaryFile {
  if (!file.chapters || file.chapters === chapterCount) return file;
  const glossary: Record<string, GlossaryEntry> = {};
  for (const [lemma, entry] of Object.entries(file.glossary)) {
    if (!entry.senses) {
      glossary[lemma] = entry;
      continue;
    }
    glossary[lemma] = {
      ...entry,
      senses: entry.senses.map((sense) => ({
        ...sense,
        anchors: (sense.anchors ?? [])
          .filter((anchor) => anchor.context)
          .map(({ context, form }) => ({ context, ...(form ? { form } : {}) })),
      })),
    };
  }
  return { ...file, glossary };
}

/* ------------------------------------------------------------------ choosing a meaning */

export type SenseView = { pos: string; meaning: string; whyHard: string };

export type OtherMeaning = SenseView & { chapters: number[] };

export type Picked = SenseView & {
  /** how the meaning was chosen */
  via: "anchor" | "context" | "default" | "entry" | "first";
  /** index in entry.senses, or -1 for the entry's own meaning */
  at: number;
  others: OtherMeaning[];
};

export type TapInfo = {
  /** 0-based chapter index being read */
  chapter: number;
  /** the tapped word exactly as in the book */
  surface: string;
  /** which time this word form appears in the chapter (1-based) */
  occurrence: number;
  /** text of the paragraph that holds the word */
  paragraph: string;
  /** the paragraph text before the tapped word (tells which use of the word was tapped) */
  before?: string;
};

type GlossLike = {
  pos: string;
  meaning: string;
  whyHard: string;
  forms?: string[];
  senses?: GlossarySense[];
};

/**
 * Steps 1 and 2 of `pickSense`: the sense whose anchor names this place in the book.
 * `null` when no anchor matches. A `senseOnly` entry is only underlined and opened where this finds a sense.
 */
export function matchAnchor(
  lemma: string,
  senses: GlossarySense[],
  tap: TapInfo,
): { at: number; via: "anchor" | "context" } | null {
  const surface = tap.surface.toLowerCase();
  const paragraph = normText(tap.paragraph);
  const holdsWord = (text: string) => wordsIn(text).some((w) => w.toLowerCase() === surface);
  // Where the tapped word starts inside the normalised paragraph (-1: unknown).
  const at = tap.before === undefined ? -1 : normText(`${tap.before}\u0001`).length - 1;
  // The same two numbers with all white space ignored, for a stored snippet whose words were glued at a line break.
  const flatParagraph = squash(paragraph);
  const flatAt = tap.before === undefined ? -1 : squash(normText(`${tap.before}\u0001`)).length - 1;
  // Does the snippet sit around the tapped word (not around another use in the same paragraph)?
  const covers = (context: string): boolean => {
    let from = paragraph.indexOf(context);
    if (from < 0) return false;
    if (at < 0) return true;
    while (from >= 0) {
      if (at >= from && at + surface.length <= from + context.length) return true;
      from = paragraph.indexOf(context, from + 1);
    }
    return false;
  };
  const coversFlat = (context: string): boolean => {
    const flat = squash(context);
    if (flat.length < SQUASH_MIN || !flat.includes(surface)) return false;
    let from = flatParagraph.indexOf(flat);
    if (from < 0) return false;
    if (flatAt < 0) return true;
    while (from >= 0) {
      if (flatAt >= from && flatAt + surface.length <= from + flat.length) return true;
      from = flatParagraph.indexOf(flat, from + 1);
    }
    return false;
  };
  // 1. chapter + occurrence
  for (let i = 0; i < senses.length; i += 1) {
    const sense = senses[i] as GlossarySense;
    for (const anchor of sense.anchors ?? []) {
      if (anchor.chapter !== tap.chapter || anchor.occurrence !== tap.occurrence) continue;
      if ((anchor.form ?? lemma).toLowerCase() !== surface) continue;
      if (anchor.context && !includesText(paragraph, normText(anchor.context))) continue; // stale anchor
      return { at: i, via: "anchor" };
    }
  }
  // 2. context snippet
  for (let i = 0; i < senses.length; i += 1) {
    const sense = senses[i] as GlossarySense;
    for (const anchor of sense.anchors ?? []) {
      if (!anchor.context) continue;
      if (anchor.chapter !== undefined && anchor.chapter !== tap.chapter) continue;
      const context = normText(anchor.context);
      if ((holdsWord(context) && covers(context)) || coversFlat(context))
        return { at: i, via: "context" };
    }
  }
  return null;
}

/** Is `snippet` inside `text` (both from `normText`)? A line break may have glued two words of the snippet. */
function includesText(text: string, snippet: string): boolean {
  return text.includes(snippet) || squash(snippet).length >= SQUASH_MIN && squash(text).includes(squash(snippet));
}

/** Can this place in the book open the entry? Always, unless the entry is `senseOnly` and no anchor names the place. */
export function entryAppliesAt(
  lemma: string,
  gloss: { senseOnly?: boolean; senses?: GlossarySense[] },
  tap: TapInfo,
): boolean {
  if (gloss.senseOnly !== true) return true;
  return matchAnchor(lemma, gloss.senses ?? [], tap) !== null;
}

/**
 * A `senseOnly` entry is underlined only where one of its senses names the place. This builds the
 * same tap info `pickButton` builds from the live page: the paragraph text, and the text before the word.
 */
export function senseOnlyHit(
  doc: Document,
  node: Text,
  start: number,
  key: string,
  gloss: { senseOnly?: boolean; senses?: GlossarySense[] },
  surface: string,
  occurrence: number,
  chapter: number,
): boolean {
  const block = blockOf(node);
  const paragraph = block ? stripWordBreaks(flowText(block)) : surface;
  const before = block ? flowTextBefore(block, node, start) : "";
  return entryAppliesAt(key, gloss, { chapter, surface, occurrence, paragraph, before });
}

/**
 * The chapter html as the reader shows it: every word is a tap button. A word that has an entry in the word
 * list is underlined (`book-hard`), except where the entry is `senseOnly`: that one is underlined only at the
 * places its senses name. `chapter` is the 0-based chapter index; `sparse` holds the senseOnly entries by key.
 */
export function readingHtml(
  html: string,
  ready: Set<string>,
  resolve: (surface: string) => string,
  chapter: number,
  sparse: Map<string, { senseOnly?: boolean; senses?: GlossarySense[] }>,
): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return "";
  cleanReadingRoot(root);
  stripWordBreaksIn(root);
  for (const el of [...root.querySelectorAll("*")]) {
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith("on") || attr.name === "href" || attr.name === "action")
        el.removeAttribute(attr.name);
      // The book's own inline styles would fight the reader's typography settings.
      if (attr.name === "style" || attr.name === "class") el.removeAttribute(attr.name);
    }
  }
  // Word rule and counting: src/lib/glossary-format.ts (shared with the command-line tools).
  const nodes = wordTextNodes(doc, root);
  let order = 0;
  const seenForms = new Map<string, number>();
  for (const node of nodes) {
    const fragment = doc.createDocumentFragment();
    const parts = splitWords(node.data);
    let offset = 0;
    parts.forEach((part, at) => {
      const start = offset;
      offset += part.length;
      if (at % 2 === 1) {
        const button = doc.createElement("button");
        button.type = "button";
        button.dataset.word = part;
        button.dataset.i = String(order);
        order += 1;
        const form = part.toLowerCase();
        const nth = (seenForms.get(form) ?? 0) + 1;
        seenForms.set(form, nth);
        button.dataset.n = String(nth);
        button.textContent = part;
        const key = resolve(part);
        if (ready.has(key)) {
          const only = sparse.get(key);
          if (!only || senseOnlyHit(doc, node, start, key, only, part, nth, chapter))
            button.className = "book-hard";
        }
        fragment.append(button);
      } else if (part) {
        fragment.append(doc.createTextNode(part));
      }
    });
    node.parentNode?.replaceChild(fragment, node);
  }
  return root.innerHTML;
}

/**
 * Which meaning to show when a word is tapped. Order:
 *  1. anchor with chapter + occurrence (the anchor's own context, if any, must also be in the paragraph)
 *  2. anchor whose context text is inside the tapped paragraph (and holds the tapped word)
 *  3. the sense marked "default": true, else the only sense that lists the tapped form in "forms"
 *  4. the word's own pos / meaning / whyHard
 *  5. (the caller) no entry at all: the reader shows a friendly "no meaning yet" line
 * A word with senses but without its own meaning uses its first sense at step 4.
 */
export function pickSense(lemma: string, gloss: GlossLike, tap: TapInfo): Picked {
  const senses = gloss.senses ?? [];
  const entry: SenseView = { pos: gloss.pos, meaning: gloss.meaning, whyHard: gloss.whyHard };
  const view = (sense: GlossarySense): SenseView => ({
    pos: sense.pos ?? gloss.pos,
    meaning: sense.meaning,
    whyHard: sense.whyHard ?? gloss.whyHard,
  });
  const finish = (via: Picked["via"], at: number, shown: SenseView): Picked => {
    const others: OtherMeaning[] = [];
    const taken = new Set<string>([normText(shown.meaning)]);
    const add = (candidate: SenseView, chapters: number[]) => {
      const key = normText(candidate.meaning);
      if (!candidate.meaning || taken.has(key)) return;
      taken.add(key);
      others.push({ ...candidate, chapters });
    };
    if (at >= 0 && entry.meaning) add(entry, []);
    senses.forEach((sense, i) => {
      if (i === at) return;
      const chapters = [
        ...new Set(
          (sense.anchors ?? []).map((a) => a.chapter).filter((c): c is number => c !== undefined),
        ),
      ].sort((a, b) => a - b);
      add(view(sense), chapters);
    });
    return { ...shown, via, at, others };
  };
  if (senses.length === 0) return finish("entry", -1, entry);

  const surface = tap.surface.toLowerCase();
  const anchored = matchAnchor(lemma, senses, tap);
  if (anchored) return finish(anchored.via, anchored.at, view(senses[anchored.at] as GlossarySense));
  // 3. default sense
  let flagged = senses.findIndex((s) => s.default);
  if (flagged < 0) {
    const byForm = senses
      .map((s, i) => (s.forms?.includes(surface) ? i : -1))
      .filter((i) => i >= 0);
    if (byForm.length === 1) flagged = byForm[0] as number;
  }
  if (flagged >= 0) return finish("default", flagged, view(senses[flagged] as GlossarySense));
  // 4. the entry's own meaning
  if (gloss.meaning) return finish("entry", -1, entry);
  return finish("first", 0, view(senses[0] as GlossarySense));
}
