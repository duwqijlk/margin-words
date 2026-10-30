/**
 * The page side of quotes: which sentence a tap is on, and a light green wash over a span of a
 * paragraph (the sentences picked in pick mode, a kept quote lighting up for a moment).
 *
 * The wash is drawn as boxes laid over the text, in page coordinates, never by wrapping the text in
 * new elements: the reader's paragraphs are word buttons and links built once per chapter, and
 * changing them would break the word taps, the paragraph marks and the saved places that count on
 * their exact shape.
 */
import { flowPoint, flowText } from "@/lib/flow-text";
import { findNoteSentence } from "@/lib/note-sentence";
import { numberedParagraph } from "@/lib/passage-pick";
import { flowOffsetAt, readerParagraphBlocks } from "@/lib/reader-anchor";
import { sentenceSpans } from "@/lib/quote-model";

export type QuoteSpan = { paragraph: number; start: number; end: number };

const BLOCK = "p, li, blockquote, h1, h2, h3, h4, div[data-para]";

/** The sentence under a tap on the page, in its numbered paragraph. Null off the text. */
export function sentenceAtPoint(root: HTMLElement, target: Element, x: number, y: number): QuoteSpan | null {
  const block = target.closest(BLOCK);
  if (!block || !root.contains(block)) return null;
  const numbered = numberedParagraph(root, block);
  if (!numbered) return null;
  const text = flowText(numbered.block);
  if (!text) return null;
  const at = flowOffsetAt(numbered.block, x, y);
  if (at === null) return null;
  const spans = sentenceSpans(text);
  const hit = spans.find((span) => at >= span.start && at < span.end) ?? spans.find((span) => span.start >= at) ?? spans[spans.length - 1];
  return hit ? { paragraph: numbered.index, start: hit.start, end: hit.end } : null;
}

/** A DOM range over [start, end) of `flowText(block)`. */
export function spanRange(block: Element, start: number, end: number): Range | null {
  const from = flowPoint(block, start);
  if (!from) return null;
  const range = block.ownerDocument.createRange();
  try {
    range.setStart(from.node as Node, from.offset);
    const to = flowPoint(block, end);
    if (to) range.setEnd(to.node as Node, to.offset);
    else range.setEnd(block, block.childNodes.length);
  } catch {
    return null;
  }
  return range;
}

type Box = { left: number; top: number; width: number; height: number };

/**
 * One box per line of a range, in page coordinates. A range gives a box for each text piece and each
 * word button it crosses; drawn as they come, the overlaps would be darker. Boxes on one line join.
 */
export function lineBoxes(range: Range): Box[] {
  const lines: Array<{ left: number; right: number; top: number; bottom: number }> = [];
  for (const rect of Array.from(range.getClientRects())) {
    if (rect.width < 1 || rect.height < 1) continue;
    const mid = rect.top + rect.height / 2;
    const line = lines.find((item) => mid > item.top && mid < item.bottom);
    if (line) {
      line.left = Math.min(line.left, rect.left);
      line.right = Math.max(line.right, rect.right);
      line.top = Math.min(line.top, rect.top);
      line.bottom = Math.max(line.bottom, rect.bottom);
    } else lines.push({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
  }
  const x = window.scrollX;
  const y = window.scrollY;
  return lines.map((line) => ({ left: line.left + x, top: line.top + y, width: line.right - line.left, height: line.bottom - line.top }));
}

/** Draw `spans` of the page's paragraphs into `layer` (emptied first), each line a box of `className`. */
export function drawSpans(layer: HTMLElement, root: HTMLElement, spans: readonly QuoteSpan[], className: string): void {
  layer.textContent = "";
  const blocks = readerParagraphBlocks(root);
  for (const span of spans) {
    const block = blocks[span.paragraph];
    const range = block ? spanRange(block, span.start, span.end) : null;
    if (!range) continue;
    for (const box of lineBoxes(range)) {
      const el = document.createElement("div");
      el.className = className;
      el.style.left = `${box.left}px`;
      el.style.top = `${box.top}px`;
      el.style.width = `${box.width}px`;
      el.style.height = `${box.height}px`;
      layer.appendChild(el);
    }
  }
}

/** A layer for boxes over the page text: it lets every tap through. */
export function markLayer(): HTMLElement {
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.setAttribute("data-quote-layer", "");
  layer.className = "quote-layer";
  document.body.appendChild(layer);
  return layer;
}

/** Light up a span for a moment: a kept quote, or the place a quote was opened at. */
export function flashSpan(root: HTMLElement, span: QuoteSpan, ms = 2400): void {
  const layer = markLayer();
  drawSpans(layer, root, [span], "quote-flash");
  window.setTimeout(() => layer.remove(), ms);
}

/**
 * Where a kept quote is in a paragraph of this copy of the book: the same words near where it was
 * kept, else the sentences that hold its words (curly quotes, dashes and spacing may differ).
 */
export function locateQuote(paragraph: string, quote: string, near: number): { start: number; end: number } | null {
  const text = quote.trim();
  if (!text) return null;
  let best = -1;
  for (let at = paragraph.indexOf(text); at >= 0; at = paragraph.indexOf(text, at + 1)) {
    if (best < 0 || Math.abs(at - near) < Math.abs(best - near)) best = at;
  }
  if (best >= 0) return { start: best, end: best + text.length };
  return findNoteSentence(paragraph, text) ?? findNoteSentence(paragraph, text.slice(0, 80));
}
