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
