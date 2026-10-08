/**
 * Which name is on screen, and which comes next. The overview rotates one name
 * at a time so a longer list still fits on one screen. An empty list has no frame.
 * Names come from confirmed sponsorships, not from a list typed here.
 */
export function thanksFrame(
  names: readonly string[],
  index: number,
): { name: string; next: number } | null {
  if (names.length === 0) return null;
  const at = ((Math.floor(index) % names.length) + names.length) % names.length;
  return { name: names[at] ?? "", next: (at + 1) % names.length };
}
