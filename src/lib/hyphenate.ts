/**
 * Line-break hints for the reader. A phone novel keeps both edges even (the same
 * way Kindle, Apple Books, and the Chinese novel apps do) by breaking a long word
 * at a real ending or beginning instead of stretching the spaces in front of it.
 * The hint is a soft hyphen (U+00AD): it is invisible unless the line actually
 * breaks there, and `flowText` drops it so a tap still matches the stored sentence.
 * Only the reader calls this. The stored chapter and the word list stay unchanged.
 */

const SHY = "\u00AD";

/** Longer endings first, so "ation" wins over "tion". */
const SUFFIXES = [
  "ously",
  "ation",
  "ition",
  "ments",
  "ment",
  "ness",
  "able",
  "ible",
  "less",
  "ences",
  "ence",
  "ances",
  "ance",
  "tions",
  "tion",
  "sions",
  "sion",
  "ships",
  "ship",
  "hood",
  "wards",
  "ward",
  "ities",
  "ity",
  "ous",
  "ive",
  "ful",
];

/** Beginnings that are words of their own ("some-thing", "extra-ordinarily"). */
const PREFIXES = ["under", "over", "extra", "every", "some", "dis", "mis", "non", "pre", "out", "any"];

/**
 * The word as the page may break it. Short words, and words with an apostrophe,
 * are returned unchanged. The letters and their order never change.
 */
export function hyphenateDisplay(word: string): string {
  if (word.length < 8 || !/^[\p{L}]+$/u.test(word)) return word;
  const lower = word.toLowerCase();
  const points = new Set<number>();
  const allow = (at: number, minRight: number) => {
    if (at >= 3 && word.length - at >= minRight) points.add(at);
  };
  let suffixed = false;
  for (const suffix of SUFFIXES) {
    if (!lower.endsWith(suffix)) continue;
    const at = word.length - suffix.length;
    if (at >= 5 && suffix.length >= 3) allow(at, 3);
    suffixed = true;
    break;
  }
  if (!suffixed && lower.endsWith("ly") && word.length - 2 >= 6) allow(word.length - 2, 2);
  for (const prefix of PREFIXES) {
    if (!lower.startsWith(prefix)) continue;
    if (word.length - prefix.length >= 5) allow(prefix.length, 5);
    break;
  }
  if (points.size === 0) return word;
  const cuts = [...points].sort((a, b) => a - b);
  let out = "";
  let prev = 0;
  for (const at of cuts) {
    out += word.slice(prev, at) + SHY;
    prev = at;
  }
  return out + word.slice(prev);
}

/**
 * Reading html with a tappable span inside each word button, and a soft hyphen
 * inside a long word. `data-word` stays the real spelling, so a tap still finds
 * the glossary entry.
 */
export function hyphenateReadingHtml(html: string): string {
  if (!html || typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return html;
  for (const button of root.querySelectorAll("button[data-word]")) {
    const surface = button.getAttribute("data-word") ?? "";
    const tap = doc.createElement("span");
    tap.className = "book-tap";
    tap.textContent = hyphenateDisplay(surface);
    button.replaceChildren(tap);
  }
  return root.innerHTML;
}
