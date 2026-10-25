/**
 * Readers credited for meanings accepted into word lists: `contributors.json` on the books host
 * (see functions/lib/contributors.ts). Loaded at most once per page and kept in memory, so a credit
 * on the word card and the Overview rank cost one cached file, not a request per word.
 */
import { useEffect, useState } from "react";
import { booksUrl } from "@/lib/books-base";
import { parseContributors, PUBLIC_ID, type Contributor } from "@/lib/contributors-file";

export type { Contributor };

let loading: Promise<Contributor[]> | null = null;

export function loadContributors(): Promise<Contributor[]> {
  loading ??= fetch(booksUrl("contributors.json"), { cache: "no-cache" })
    .then((response) => (response.ok ? response.json() : null))
    .then(parseContributors)
    .catch(() => {
      loading = null; // try again on the next card or visit
      return [];
    });
  return loading;
}

/** All credited readers, most help first. Empty until the file has loaded (or when there is none). */
export function useContributors(): Contributor[] {
  const [people, setPeople] = useState<Contributor[]>([]);
  useEffect(() => {
    let alive = true;
    void loadContributors().then((rows) => {
      if (alive) setPeople(rows);
    });
    return () => {
      alive = false;
    };
  }, []);
  return people;
}

/** The credited reader for one public id, once the file has loaded. */
export function useContributor(id: string | undefined): Contributor | null {
  const people = useContributors();
  if (!id) return null;
  return people.find((person) => person.id === id) ?? null;
}

/** The avatar image of a reader, or "" when they have none. The version keeps a cached old one from showing. */
export function avatarUrl(id: string, version: number | undefined): string {
  if (!version || !PUBLIC_ID.test(id)) return "";
  return booksUrl(`avatars/${id}.webp?v=${version}`);
}
