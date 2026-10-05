/** A nickname is a short label the reader chooses. It does not have to be unique. */

export const NICKNAME_MAX = 16;

/** Trimmed nickname of 1 to 16 characters, or null when the text cannot be saved. */
export function cleanNickname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let raw = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    raw += code < 32 || code === 127 ? " " : char;
  }
  const text = raw.replace(/\s+/g, " ").trim();
  const chars = [...text];
  if (chars.length < 1 || chars.length > NICKNAME_MAX) return null;
  return chars.join("");
}
