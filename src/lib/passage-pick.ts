/**
 * The reader's current text selection, as a passage to ask about: the words, the paragraph it is
 * in, where in that paragraph they are, and a few words on each side so the place can be found
 * again in the word list.
 */
import { PASSAGE_MAX } from "@/lib/limits";
import { flowText, flowTextBefore } from "@/lib/flow-text";
import { readerParagraphBlocks } from "@/lib/reader-anchor";

/** A selection inside one paragraph of the page, with what is needed to find it again. */
export type PassagePick = {
  selected: string;
  before: string;
  after: string;
  paragraph: number;
  /**
   * Where the selection is inside the paragraph text (book text: soft hyphens dropped, spaces
   * folded), as [start, end) character offsets. Two reports on one paragraph overlap when these do.
   */
  start: number;
  end: number;
  /** "sentence" when the selection holds a whole sentence or more, else "words". */
  span: "words" | "sentence";
  /** Where to put the button: just under the end of the selection, in page coordinates. */
  x: number;
  y: number;
  /** The top of the selection, in page coordinates (the bar sits above it on a wide screen). */
  top: number;
  /** The numbered paragraph and its whole text (`start` and `end` are offsets into it). */
  block: Element;
  text: string;
  /** Longer than PASSAGE_MAX: it can be kept as a quote, but not sent as a question. */
  long: boolean;
};

const BLOCK = "p, li, blockquote, h1, h2, h3, h4, div[data-para]";

/**
 * Text as the book has it: the soft hyphens the reader adds for line breaks are dropped, and
 * spaces folded, so the words match the word list and the book file.
 */
export function bookText(text: string): string {
  return text.replace(/­/g, "").replace(/\s+/g, " ");
}

function blockOf(node: Node | null, root: HTMLElement): Element | null {
  const el = node instanceof Element ? node : node?.parentElement ?? null;
  const block = el?.closest(BLOCK) ?? null;
  return block && root.contains(block) ? block : null;
}

/** A few whole words of `text`, from the end (`fromEnd`) or the start, at most about `max` letters. */
function someWords(text: string, max: number, fromEnd: boolean): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let length = 0;
  for (const word of fromEnd ? [...words].reverse() : words) {
    if (length + word.length + 1 > max) break;
    out.push(word);
    length += word.length + 1;
  }
  return (fromEnd ? out.reverse() : out).join(" ");
}

/**
 * Where `selected` sits in `whole`: the match nearest to `near` (the length of the text before the
 * selection), since a short selection ("the") can appear many times in one paragraph.
 */
export function locateIn(whole: string, selected: string, near: number): number {
  let best = -1;
  for (let at = whole.indexOf(selected); at >= 0; at = whole.indexOf(selected, at + 1)) {
    if (best < 0 || Math.abs(at - near) < Math.abs(best - near)) best = at;
  }
  return best;
}

/**
 * True when `text` is at least one whole sentence. Either it runs across a sentence end, or it
 * starts where a sentence starts and reaches that sentence's end. Its final full stop does not have
 * to be selected: on a phone the handle often stops just before it, and "The old habits were what
 * mattered" without the "." is still the whole sentence. Fewer than five words stays a word group.
 */
export function holdsSentence(selected: string, whole: string, start: number): boolean {
  const text = selected.trim();
  const words = text.split(/\s+/).length;
  if (words < 5) return false;
  if (/[.!?]["'”’)]?\s+\S/.test(text)) return true;
  const startsSentence = start === 0 || /[.!?]["'”’)]?\s*$/.test(whole.slice(0, start));
  if (!startsSentence) return false;
  if (/[.!?]["'”’)]?$/.test(text)) return true;
  // What follows the selection in the paragraph: only the sentence's own end mark (and a closing
  // quote) before the next sentence or the end of the paragraph means the sentence is complete.
  const at = whole.startsWith(text, start) ? start : whole.indexOf(text);
  if (at < 0) return false;
  return /^\s*[.!?]+["'”’)]*(\s|$)/.test(whole.slice(at + text.length));
}

/**
 * The numbered paragraph (readerParagraphBlocks) that holds `block`, and its index, or null.
 * A <p> inside a <blockquote> is not numbered: the blockquote is the paragraph, so walk up to it.
 * A heading, a merge title or a one-letter block is not numbered at all: null.
 */
export function numberedParagraph(root: HTMLElement, block: Element): { block: Element; index: number } | null {
  const numbered = readerParagraphBlocks(root);
  for (let el: Element | null = block; el && el !== root; el = el.parentElement) {
    const index = numbered.indexOf(el);
    if (index >= 0) return { block: el, index };
  }
  return null;
}

/**
 * Read the current page selection. Null when nothing useful is selected. `{ crossed: true }` when
 * it runs over more than one paragraph or sits in a block the reader does not number (a title): the
 * button then says so instead of filing it under a wrong paragraph. A selection longer than
 * PASSAGE_MAX is marked `long` (a quote may be a whole paragraph; a question may not).
 */
export function readPassage(root: HTMLElement): PassagePick | { crossed: true; x: number; y: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const raw = bookText(selection.toString()).trim();
  // One letter, or nothing that reads as a word, is a stray drag.
  if (raw.length < 2 || !/[a-z]/i.test(raw)) return null;
  const rect = range.getBoundingClientRect();
  const x = rect.left + rect.width / 2 + window.scrollX;
  const y = rect.bottom + window.scrollY;
  const top = rect.top + window.scrollY;
  const startBlock = blockOf(range.startContainer, root);
  let endBlock = blockOf(range.endContainer, root);
  if (!startBlock || !endBlock) return { crossed: true, x, y };
  // A triple click selects a paragraph up to the very start of the next one: nothing of that one
  // is selected, so it is still one paragraph.
  if (endBlock !== startBlock && !flowTextBefore(endBlock, range.endContainer, range.endOffset).trim()) endBlock = startBlock;
  const first = numberedParagraph(root, startBlock);
  const last = numberedParagraph(root, endBlock);
  // Both ends in one numbered paragraph (two <p> of one quotation count as one paragraph).
  if (!first || !last || first.block !== last.block) return { crossed: true, x, y };
  const paragraph = first.index;
  const whole = bookText(flowText(first.block));
  const head = bookText(flowTextBefore(first.block, range.startContainer, range.startOffset));
  const found = locateIn(whole, raw, head.trimStart().length);
  const start = found >= 0 ? found : Math.min(head.trimStart().length, whole.length);
  const end = Math.min(whole.length, start + raw.length);
  return {
    selected: raw,
    before: someWords(whole.slice(0, start), 60, true),
    after: someWords(whole.slice(end), 60, false),
    paragraph,
    start,
    end,
    span: holdsSentence(raw, whole, start) ? "sentence" : "words",
    x,
    y,
    top,
    block: first.block,
    text: whole,
    long: [...raw].length > PASSAGE_MAX,
  };
}
