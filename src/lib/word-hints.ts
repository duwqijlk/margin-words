export type WordHints = "subtle" | "underline" | "off";

/** New clients keep the enum; older clients can still read the quietMarks mirror. */
export function wordHintPrefs(raw: { wordHints?: unknown; quietMarks?: unknown }): { wordHints: WordHints; quietMarks: boolean } {
  const wordHints =
    raw.wordHints === "subtle" || raw.wordHints === "underline" || raw.wordHints === "off"
      ? raw.wordHints
      : raw.quietMarks === true ? "off" : "subtle";
  return { wordHints, quietMarks: wordHints === "off" };
}
