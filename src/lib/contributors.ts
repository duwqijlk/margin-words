/**
 * Readers credited for meanings accepted into word lists: `contributors.json` on the books host
 * (see functions/lib/contributors.ts). Loaded at most once per page and kept in memory, so a credit
 * on the word card and the Overview rank cost one cached file, not a request per word.
 */
import { useEffect, useState } from "react";
import { booksUrl } from "@/lib/books-base";
import {
  avatarPath,
  parseBookMaintainers,
  parseContributors,
  type BookMaintainers,
  type Contributor,
} from "@/lib/contributors-file";

export type { BookMaintainers, Contributor };

type File = { people: Contributor[]; books: Record<string, BookMaintainers> };

let loading: Promise<File> | null = null;

/** contributors.json, once per page: the readers, and each catalog book's maintainers. */
function loadFile(): Promise<File> {
  // The file is kept 5 minutes by the browser and the CDN (functions/lib/contributors.ts).
  loading ??= fetch(booksUrl("contributors.json"))
    .then((response) => (response.ok ? response.json() : null))
    .then((data: unknown) => ({ people: parseContributors(data), books: parseBookMaintainers(data) }))
    .catch(() => {
      loading = null; // try again on the next card or visit
      return { people: [], books: {} };
    });
  return loading;
}

export function loadContributors(): Promise<Contributor[]> {
  return loadFile().then((file) => file.people);
}

/**
 * Start loading the file early (when a book opens), so the first credit on a word card does not
 * wait for it, and fetch the credited readers' pictures so the card shows them at once.
 */
export function preloadContributors(): void {
  void loadContributors().then((people) => {
    for (const person of people) {
      const url = avatarUrl(person.id, person.avatar);
      if (!url) continue;
      const image = new Image();
      image.decoding = "async";
      image.src = url;
    }
  });
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

/** Every catalog book's maintainers, keyed by `<catalog>:<id>`. Empty until the file has loaded. */
export function useBookMaintainers(): Record<string, BookMaintainers> {
  const [books, setBooks] = useState<Record<string, BookMaintainers>>({});
  useEffect(() => {
    let alive = true;
    void loadFile().then((file) => {
      if (alive) setBooks(file.books);
    });
    return () => {
      alive = false;
    };
  }, []);
  return books;
}

/**
 * The avatar image of a reader, or "" when they have none. Each picture has its own file
 * (avatars/<id>-<version>.webp), so a cached address always shows the picture it named.
 */
export function avatarUrl(id: string, version: number | undefined): string {
  const path = avatarPath(id, version);
  return path ? booksUrl(path) : "";
}
