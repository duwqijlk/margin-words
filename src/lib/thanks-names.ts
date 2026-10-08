/**
 * People who support this reading app. Add a name when someone asks to be listed.
 * Do not invent names. The overview shows one name at a time, so a longer list
 * still fits on one screen.
 */
export const THANKS_NAMES: readonly string[] = [];

/** Which name is on screen, and which comes next. An empty list has no frame. */
export function thanksFrame(
  names: readonly string[],
  index: number,
): { name: string; next: number } | null {
  if (names.length === 0) return null;
  const at = ((Math.floor(index) % names.length) + names.length) % names.length;
  return { name: names[at] ?? "", next: (at + 1) % names.length };
}
