/**
 * Where a sentence note sits in the paragraph on screen, as character offsets of the paragraph's
 * visible text. Pure: the reader turns the offsets into a DOM range and draws a highlight under the
 * sentence (help-panels.tsx), so a reader can see which sentence a note explains.
 *
 * Matching is loose in the same way as help-match.ts: case, quotes, dashes and punctuation do not
 * count, soft hyphens are already gone from `text`. The note's `context` is a snippet inside one
 * sentence; the span returned is that whole sentence, cut at `.`, `?` or `!` the way a tapped word's
 * sentence is (locateSentence in word-card.tsx).
 */

/** A character of `text` that takes part in matching, lower-cased, with curly quotes made plain. */
function fold(ch: string): string {
  if (ch === "‘" || ch === "’" || ch === "ʼ") return "'";
  return ch.toLowerCase();
}

const WORD = /[a-z0-9']/;

/**
 * The letters and digits of `text`, folded, and for each one its index in `text`. Apostrophes count
 * only inside a word (don't), as in looseText.
 */
function letters(text: string): { chars: string; at: number[] } {
  let chars = "";
  const at: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = fold(text[i] ?? "");
    if (!WORD.test(ch)) continue;
    if (ch === "'") {
      const prev = fold(text[i - 1] ?? "");
      const next = fold(text[i + 1] ?? "");
      if (!/[a-z0-9]/.test(prev) || !/[a-z0-9]/.test(next)) continue;
    }
    chars += ch;
    at.push(i);
  }
  return { chars, at };
}

const END = new Set([".", "?", "!"]);

/** Short words that end in a full stop without ending the sentence ("Mr. Brown"). */
const TITLES = new Set(["mr", "mrs", "ms", "dr", "st", "jr", "sr", "prof", "mt", "vs", "etc", "no"]);

/**
 * Does the mark at `i` end a sentence? Only when space, a closing quote or the end follows (so
 * "3.50" and "e.g." do not), and a full stop is not the end of a title such as "Mr.".
 */
function endsSentence(text: string, i: number): boolean {
  const ch = text[i] ?? "";
  if (!END.has(ch)) return false;
  let j = i + 1;
  while (j < text.length && /["'”’)\]]/.test(text[j] ?? "")) j += 1;
  if (j < text.length && !/\s/.test(text[j] ?? "")) return false;
  if (ch === ".") {
    const word = /([A-Za-z]+)$/.exec(text.slice(Math.max(0, i - 6), i))?.[1] ?? "";
    if (TITLES.has(word.toLowerCase())) return false;
    // A single capital letter is an initial ("J. K. Rowling").
    if (/^[A-Z]$/.test(word)) return false;
  }
  return true;
}

/** The [start, end) of the sentence of `text` around the span [from, to). */
export function sentenceAround(text: string, from: number, to: number): { start: number; end: number } {
  let start = 0;
  for (let i = from - 1; i >= 0; i -= 1) {
    if (endsSentence(text, i)) {
      start = i + 1;
      break;
    }
  }
  let end = text.length;
  for (let i = Math.max(to, from); i < text.length; i += 1) {
    if (endsSentence(text, i)) {
      end = i + 1;
      // Keep a closing quote or bracket with its sentence.
      while (end < text.length && /["'”’)\]]/.test(text[end] ?? "")) end += 1;
      break;
    }
  }
  while (start < end && /\s/.test(text[start] ?? "")) start += 1;
  while (end > start && /\s/.test(text[end - 1] ?? "")) end -= 1;
  return { start, end };
}

/**
 * The sentence of `text` that holds `context`, as [start, end) offsets into `text`, or null when the
 * context is not there. A context that runs across sentence ends gives the span from the first
 * sentence's start to the last one's end.
 */
export function findNoteSentence(text: string, context: string): { start: number; end: number } | null {
  const hay = letters(text);
  const needle = letters(context).chars;
  if (!needle) return null;
  const hit = hay.chars.indexOf(needle);
  if (hit < 0) return null;
  const from = hay.at[hit] ?? 0;
  const to = (hay.at[hit + needle.length - 1] ?? from) + 1;
  // The context's own last character may be the sentence's full stop: start the search for the
  // sentence end from just before it, so the stop is found and kept.
  return sentenceAround(text, from, Math.max(from, to - 1));
}

/* ------------------------------------------------------------------ the same span in the page */

type TextPiece = { node: Text; start: number };

/**
 * The paragraph's text exactly as its text nodes hold it (soft hyphens included), and where each text
 * node starts. Offsets into this string map straight back to DOM positions, so a Range can be built
 * without re-deriving flowText's spacing. Matching ignores spaces and soft hyphens, so the two agree.
 */
export function rawTextOf(block: Element): { text: string; pieces: TextPiece[] } {
  const pieces: TextPiece[] = [];
  let text = "";
  const walker = block.ownerDocument.createTreeWalker(block, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    pieces.push({ node: node as Text, start: text.length });
    text += node.nodeValue ?? "";
  }
  return { text, pieces };
}

/** A DOM Range over [start, end) of `rawTextOf(block).text`, or null when the span is empty. */
export function rangeOf(
  block: Element,
  raw: { text: string; pieces: TextPiece[] },
  span: { start: number; end: number },
): Range | null {
  if (span.end <= span.start || raw.pieces.length === 0) return null;
  const locate = (offset: number, atEnd: boolean) => {
    for (let i = raw.pieces.length - 1; i >= 0; i -= 1) {
      const piece = raw.pieces[i];
      if (!piece) continue;
      const length = piece.node.nodeValue?.length ?? 0;
      // An end that falls exactly on a node boundary belongs to the earlier node.
      if (atEnd ? offset > piece.start : offset >= piece.start)
        return { node: piece.node, offset: Math.min(length, offset - piece.start) };
    }
    const first = raw.pieces[0];
    return first ? { node: first.node, offset: 0 } : null;
  };
  const a = locate(span.start, false);
  const b = locate(span.end, true);
  if (!a || !b) return null;
  const range = block.ownerDocument.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}

/** The sentence of `block` that holds `context`, as a DOM Range, or null. */
export function noteSentenceRange(block: Element, context: string): Range | null {
  const raw = rawTextOf(block);
  // Soft hyphens are dropped before matching; map back through a parallel index.
  let visible = "";
  const back: number[] = [];
  for (let i = 0; i < raw.text.length; i += 1) {
    const ch = raw.text[i] ?? "";
    if (ch === "­") continue;
    visible += ch;
    back.push(i);
  }
  back.push(raw.text.length);
  const span = findNoteSentence(visible, context);
  if (!span) return null;
  return rangeOf(block, raw, { start: back[span.start] ?? 0, end: back[span.end] ?? raw.text.length });
}
