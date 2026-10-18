/**
 * Line-break hints for the reader. Kindle, Apple Books, and the Chinese novel
 * apps keep both edges of a line even, and they break a long word at a syllable
 * instead of stretching the spaces in front of it. These are the same English
 * hyphenation patterns those apps use. The hint is a soft hyphen (U+00AD): it
 * is invisible unless the line actually breaks there, and `flowText` drops it
 * so a tap still matches the stored sentence. Only the reader calls this.
 * The stored chapter and the word list stay unchanged.
 */
import createHyphenator from "hyphen";
import patterns from "hyphen/patterns/en-us.js";

const SHY = "\u00AD";

const breakWord = createHyphenator(patterns, { minWordLength: 6 });
const shownWords = new Map<string, string>();

/**
 * The word as the page may break it. Short words, and words with an apostrophe,
 * are returned unchanged. The letters and their order never change.
 * The same spelling is broken once per session. A chapter repeats it often.
 */
export function hyphenateDisplay(word: string): string {
  const cached = shownWords.get(word);
  if (cached !== undefined) return cached;
  let shown = word;
  if (word.length >= 6 && /^[\p{L}]+$/u.test(word)) {
    const broken = breakWord(word);
    if (broken.includes(SHY)) shown = broken;
  }
  shownWords.set(word, shown);
  return shown;
}

/**
 * Reading html with a tappable span inside each word button, and a soft hyphen
 * inside a long word. `data-word` stays the real spelling, so a tap still finds
 * the glossary entry.
 */
export function hyphenateReadingRoot(root: Element): void {
  const doc = root.ownerDocument;
  if (!doc) return;
  for (const button of root.querySelectorAll("button[data-word]")) {
    const surface = button.getAttribute("data-word") ?? "";
    const tap = doc.createElement("span");
    tap.className = "book-tap";
    tap.textContent = hyphenateDisplay(surface);
    button.textContent = "";
    button.appendChild(tap);
  }
}

export function hyphenateReadingHtml(html: string): string {
  if (!html || typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return html;
  hyphenateReadingRoot(root);
  return root.innerHTML;
}
