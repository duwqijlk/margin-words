/**
 * Reading text of a piece of a chapter, the way a reader sees it.
 * `textContent` glues the words on both sides of a line break (`real<br/>and` gives "realand").
 * `flowText` puts one space there instead. It also drops a soft hyphen, which is only a
 * line-break hint in the reader. It never changes the html, so the word tokens,
 * paragraph indexes and occurrence numbers of the glossary anchors stay exactly the same.
 * Pure: no app imports, so the unit tests and the command-line tools can load it.
 */

const BREAK_TAGS = new Set(["br", "hr"]);
const BLOCK_TAGS = new Set([
  "p",
  "div",
  "li",
  "ul",
  "ol",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "tr",
  "table",
  "pre",
  "dd",
  "dt",
  "dl",
  "figure",
  "figcaption",
]);

type NodeLike = {
  nodeType: number;
  nodeValue?: string | null;
  localName?: string;
  childNodes: ArrayLike<NodeLike>;
};

type ElLike = {
  localName?: string;
  getAttribute?: (name: string) => string | null;
  querySelector?: (selector: string) => unknown;
  parentElement?: ElLike | null;
};

/**
 * A blockquote that is the chapter body, not a quotation.
 * Calibre wraps a whole chapter in `<blockquote class="calibre…">` full of
 * `<p>` and headings. A poem or a real quote (no heading, no calibre class)
 * stays one paragraph, even when it contains `<p>` lines.
 * Used only when the word list sets `"segmentation": 2`. Otherwise every
 * blockquote stays one paragraph, the same as before this rule.
 */
export function isChapterWrapper(el: ElLike | null | undefined): boolean {
  if (!el || el.localName !== "blockquote") return false;
  if (!el.querySelector?.("p, li, h1, h2, h3, h4")) return false;
  const cls = el.getAttribute?.("class") ?? "";
  if (/\bcalibre\d*\b/i.test(cls)) return true;
  return Boolean(el.querySelector?.("h1, h2, h3, h4"));
}

/**
 * THE skip half of the paragraph rule, shared by `paragraphsOf` and `paragraphBlocks`.
 * Skip a block nested in a p or li. Skip a block nested in a blockquote too:
 * the blockquote itself is the paragraph. `blockquoteSplit` (glossary
 * `"segmentation": 2`) is the exception: a chapter-wrapper blockquote is not
 * a paragraph, and the headings and paragraphs inside it are.
 */
export function skipNestedParagraph(block: ElLike, blockquoteSplit = false): boolean {
  // A title inserted when spine.merge appends a file. It is visible and not a paragraph.
  if (block.getAttribute?.("data-merge-title") != null) return true;
  const parent = block.parentElement;
  const parentName = parent?.localName ?? "";
  if (parentName === "p" || parentName === "li") return true;
  if (!blockquoteSplit) return parentName === "blockquote";
  if (parentName === "blockquote" && !isChapterWrapper(parent)) return true;
  return isChapterWrapper(block);
}

/** Soft hyphens are only line-break hints. They are not part of the sentence. */
function visibleText(value: string): string {
  return value.replace(/\u00AD/g, "");
}

function walk(node: NodeLike, out: string[]) {
  if (node.nodeType === 3) {
    out.push(visibleText(node.nodeValue ?? ""));
    return;
  }
  if (node.nodeType !== 1 && node.nodeType !== 11 && node.nodeType !== 9) return;
  const name = node.nodeType === 1 ? (node.localName ?? "").toLowerCase() : "";
  if (BREAK_TAGS.has(name)) {
    out.push(" ");
    return;
  }
  const block = BLOCK_TAGS.has(name);
  if (block) out.push(" ");
  for (let i = 0; i < node.childNodes.length; i += 1) walk(node.childNodes[i] as NodeLike, out);
  if (block) out.push(" ");
}

/** Text of a node or fragment with every line break (and every inner block) read as a space. Not trimmed. */
export function flowTextRaw(node: Node | NodeLike | null | undefined): string {
  if (!node) return "";
  const out: string[] = [];
  walk(node as NodeLike, out);
  return out.join("");
}

/**
 * The same text, but only what comes before a place in the tree: the whole of `stop` is left out when it is
 * an element, and only the first `offset` characters when it is a text node. Used to find where a tapped
 * word starts inside its paragraph, with the same line-break rule as `flowText` so the two line up.
 */
export function flowTextBefore(root: Node | NodeLike, stop: Node | NodeLike, offset = 0): string {
  const out: string[] = [];
  let done = false;
  const go = (node: NodeLike) => {
    if (done) return;
    if (node === stop) {
      if (node.nodeType === 3) out.push(visibleText((node.nodeValue ?? "").slice(0, offset)));
      done = true;
      return;
    }
    if (node.nodeType === 3) {
      out.push(visibleText(node.nodeValue ?? ""));
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 11 && node.nodeType !== 9) return;
    const name = node.nodeType === 1 ? (node.localName ?? "").toLowerCase() : "";
    if (BREAK_TAGS.has(name)) {
      out.push(" ");
      return;
    }
    const block = BLOCK_TAGS.has(name);
    if (block) out.push(" ");
    for (let i = 0; i < node.childNodes.length && !done; i += 1) go(node.childNodes[i] as NodeLike);
    if (block && !done) out.push(" ");
  };
  go(root as NodeLike);
  return out.join("").replace(/\s+/g, " ").trimStart();
}

/** `flowTextRaw` with white space collapsed to single spaces and the ends trimmed. */
export function flowText(node: Node | NodeLike | null | undefined): string {
  return flowTextRaw(node).replace(/\s+/g, " ").trim();
}

/**
 * Shortest snippet for which the "ignore spaces" match is used. Shorter snippets must match as whole words,
 * so a short snippet cannot match by accident inside other words.
 */
export const SQUASH_MIN = 8;

/** Text with every kind of white space removed. */
export const squash = (text: string): string => text.replace(/\s+/g, "");

/**
 * Is `needle` inside `haystack`? Both are already normalised by the caller (one space between
 * words). First as whole words; if that fails, with all white space ignored, so a stored example
 * whose words were glued at a line break ("realand") still finds the text ("real and").
 */
export function includesLoose(haystack: string, needle: string): boolean {
  if (needle === "") return false;
  if (` ${haystack} `.includes(` ${needle} `)) return true;
  const flat = squash(needle);
  return flat.length >= SQUASH_MIN && squash(haystack).includes(flat);
}
