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

/**
 * The word as the page may break it. Short words, and words with an apostrophe,
 * are returned unchanged. The letters and their order never change.
 */
export function hyphenateDisplay(word: string): string {
  if (word.length < 6 || !/^[\p{L}]+$/u.test(word)) return word;
  const broken = breakWord(word);
  return broken.includes(SHY) ? broken : word;
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
