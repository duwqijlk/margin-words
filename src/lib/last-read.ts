/**
 * The words the reader stopped at (design system ContinueReading): the short piece of the book's own
 * text that the progress anchor keeps (at most 80 characters, whole words). An ellipsis marks where it
 * was cut from a longer paragraph.
 */
export function lastReadLine(anchor: { quote: string; offset: number } | undefined): string {
  const quote = (anchor?.quote ?? "").replace(/\s+/g, " ").trim();
  if (quote.length < 12) return "";
  const head = anchor && anchor.offset > 0 ? "\u2026" : "";
  const tail = /[.!?\u2026"'\u201d\u2019)\]]$/.test(quote) ? "" : "\u2026";
  return head + quote + tail;
}
