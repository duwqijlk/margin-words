/** One credited reader in contributors.json (see functions/lib/contributors.ts). */
export type Contributor = { id: string; name: string; helped: number; avatar?: number };

export const PUBLIC_ID = /^[a-z0-9]{12}$/;

/** Where a reader's picture is on the books host: one file per version, never written twice. */
export function avatarPath(id: string, version: number | undefined): string {
  if (!version || !PUBLIC_ID.test(id)) return "";
  return `avatars/${id}-${version}.webp`;
}

/** Only well-formed rows; anything else in the file is ignored. */
export function parseContributors(data: unknown): Contributor[] {
  const people = (data as { people?: unknown } | null)?.people;
  if (!Array.isArray(people)) return [];
  const out: Contributor[] = [];
  for (const row of people) {
    if (!row || typeof row !== "object") continue;
    const { id, name, helped, avatar } = row as Record<string, unknown>;
    if (typeof id !== "string" || !PUBLIC_ID.test(id)) continue;
    const count = typeof helped === "number" && Number.isFinite(helped) ? Math.max(0, Math.floor(helped)) : 0;
    out.push({
      id,
      name: typeof name === "string" ? name.slice(0, 32) : "",
      helped: count,
      ...(typeof avatar === "number" && avatar > 0 ? { avatar: Math.floor(avatar) } : {}),
    });
  }
  return out;
}

/** One catalog book's maintainers: how many, and the first few by help (public ids). */
export type BookMaintainers = { count: number; top: string[] };

/** The `books` part of contributors.json, keyed by `<catalog>:<id>`. Malformed rows are left out. */
export function parseBookMaintainers(data: unknown): Record<string, BookMaintainers> {
  const books = (data as { books?: unknown } | null)?.books;
  const out: Record<string, BookMaintainers> = {};
  if (!books || typeof books !== "object" || Array.isArray(books)) return out;
  for (const [ref, raw] of Object.entries(books as Record<string, unknown>)) {
    if (!/^(word-lists|public-books):[a-z0-9][a-z0-9_-]{0,63}$/.test(ref) || !raw || typeof raw !== "object") continue;
    const { count, top } = raw as { count?: unknown; top?: unknown };
    const ids = Array.isArray(top) ? top.filter((id): id is string => typeof id === "string" && PUBLIC_ID.test(id)).slice(0, 3) : [];
    const n = typeof count === "number" && Number.isFinite(count) ? Math.max(ids.length, Math.floor(count)) : ids.length;
    if (n > 0) out[ref] = { count: n, top: ids };
  }
  return out;
}

/** The count a cover shows after its faces: "" when all are shown, "+5", or "99+" past 99. */
export function moreLabel(count: number, shown: number): string {
  const rest = Math.max(0, Math.floor(count) - shown);
  if (rest === 0) return "";
  return rest > 99 ? "99+" : `+${rest}`;
}
