/**
 * The reader's current text selection, as a passage to ask about: the words, the paragraph it is
 * in, and a few words on each side so the place can be found again in the word list.
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
  /** Where to put the button: just under the end of the selection, in page coordinates. */
  x: number;
  y: number;
};

const BLOCK = "p, li, blockquote, h1, h2, h3, h4, div[data-para]";

/**
 * Text as the book has it: the soft hyphens the reader adds for line breaks are dropped, and
 * spaces folded, so the words match the word list and the book file.
 */
function bookText(text: string): string {
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
  const start = blockOf(range.startContainer, root);
  const end = blockOf(range.endContainer, root);
  if (!start || start !== end || [...raw].length > PASSAGE_MAX) return { crossed: true, x, y };
  const paragraph = readerParagraphBlocks(root).indexOf(start);
  const whole = bookText(flowText(start));
  const head = bookText(flowTextBefore(start, range.startContainer, range.startOffset));
  const at = whole.indexOf(raw, Math.max(0, head.trimStart().length - 2));
  const before = someWords(at >= 0 ? whole.slice(0, at) : head, 60, true);
  const after = someWords(at >= 0 ? whole.slice(at + raw.length) : "", 60, false);
  return { selected: raw, before, after, paragraph: Math.max(0, paragraph), x, y };
}
