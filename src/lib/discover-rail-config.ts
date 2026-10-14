/**
 * Load the series rows an admin saved for Discover.
 * Missing file: Discover keeps picking the three largest series itself.
 * A saved list, even an empty one, is the rows Discover shows.
 */
import { booksUrl } from "@/lib/books-base";
import { normalizeDiscoverRails, type DiscoverRailSpec } from "@/lib/discover-rails";

export type { DiscoverRailSpec };
export { normalizeDiscoverRails };

export const DISCOVER_RAILS_URL = booksUrl("word-lists/discover-rails.json");

/** `null` means the file is absent or unusable, so Discover stays on the automatic rows. */
export function parseDiscoverRails(value: unknown): DiscoverRailSpec[] | null {
  if (!value || typeof value !== "object" || !("rails" in value)) return null;
  const parsed = normalizeDiscoverRails(value);
  return parsed.ok ? parsed.rails : null;
}

export async function loadDiscoverRailFile(): Promise<DiscoverRailSpec[] | null> {
  const response = await fetch(DISCOVER_RAILS_URL, { cache: "no-cache" });
  if (!response.ok) return null;
  try {
    return parseDiscoverRails(await response.json());
  } catch {
    return null;
  }
}
