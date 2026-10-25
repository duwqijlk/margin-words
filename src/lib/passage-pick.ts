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

/** True when `text` is at least one whole sentence: it ends a sentence and has a verb-sized length. */
export function holdsSentence(selected: string, whole: string, start: number): boolean {
  const words = selected.trim().split(/\s+/).length;
  if (words < 5) return false;
  const startsSentence = start === 0 || /[.!?]["'”’)]?\s*$/.test(whole.slice(0, start));
  const endsSentence = /[.!?]["'”’)]?$/.test(selected.trim());
  return (startsSentence && endsSentence) || /[.!?]["'”’)]?\s+\S/.test(selected);
}

/**
 * Read the current page selection. Null when nothing useful is selected. `{ crossed: true }` when
 * it runs over more than one paragraph or is longer than PASSAGE_MAX: the button then says so.
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
  const startBlock = blockOf(range.startContainer, root);
  const endBlock = blockOf(range.endContainer, root);
  if (!startBlock || startBlock !== endBlock || [...raw].length > PASSAGE_MAX) return { crossed: true, x, y };
  const paragraph = readerParagraphBlocks(root).indexOf(startBlock);
  const whole = bookText(flowText(startBlock));
  const head = bookText(flowTextBefore(startBlock, range.startContainer, range.startOffset));
  const found = locateIn(whole, raw, head.trimStart().length);
  const start = found >= 0 ? found : Math.min(head.trimStart().length, whole.length);
  const end = Math.min(whole.length, start + raw.length);
  return {
    selected: raw,
    before: someWords(whole.slice(0, start), 60, true),
    after: someWords(whole.slice(end), 60, false),
    paragraph: Math.max(0, paragraph),
    start,
    end,
    span: holdsSentence(raw, whole, start) ? "sentence" : "words",
    x,
    y,
  };
}
