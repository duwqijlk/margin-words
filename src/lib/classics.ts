/**
 * Free classics that ship with the app (public-domain books in ./public-books/).
 *
 * ADDING MORE BOOKS: nothing here lists book ids. Every pack in public-books/catalog.json is a "classic".
 * To add one, drop a folder public-books/<id>/ with book.epub, glossary.json, optional cover.jpg and
 * info.json ({"title","author","order"}), then run `node scripts/build-packs.mjs --out public-books`
 * (see public-books/README.md). A new book shows up in "Free books" for a one-tap download. Only a book
 * whose info.json has "preinstall": true (the catalog then carries preinstall: true) is put on the shelf
 * by itself on the first start (today: alice, treasure-island, anne), so the first load stays light.
 *
 * On start the app installs the preinstall books that are not on the shelf yet, except a book that the
 * user deleted on purpose: deleting a book from the shelf writes a "removed" flag for its pack id
 * (localStorage), and a flagged pack is never added again by itself. Downloading it from "Free books"
 * clears the flag.
 */
import { create } from "zustand";
import { useEffect, useState } from "react";
import { listPackRecords } from "@/lib/book-db";
import { useDownloads } from "@/lib/downloads";
import { BUNDLED_CATALOG_URL, loadCatalog } from "@/lib/packs";
import { readRemoved } from "@/lib/removed-packs";

/** True while the first-run install of the classics is running (the shelf shows a placeholder, not "empty"). */
export const useClassicsRunning = create<{ running: boolean }>()(() => ({ running: false }));

let once: Promise<void> | null = null;

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (reason: unknown) => {
        clearTimeout(timer);
        reject(reason instanceof Error ? reason : new Error("failed"));
      },
    );
  });

/**
 * Look at the bundled catalog and start installing every classic that is missing and not removed.
 * Resolves when the downloads were started (not when they end), so the shelf can show placeholders at once.
 * Never throws: with no network the shelf just stays as it is, and the next start tries again.
 */
export function ensureClassics(): Promise<void> {
  if (!once) once = run();
  return once;
}

async function run(): Promise<void> {
  // Set at once, so a first-run shelf shows placeholders and not the "empty shelf" for a moment.
  useClassicsRunning.setState({ running: true });
  let started = false;
  try {
    const { catalog } = await withTimeout(loadCatalog(BUNDLED_CATALOG_URL), 5000);
    const have = new Set((await listPackRecords()).map((record) => record.packId));
    const removed = new Set(readRemoved());
    // Only the books marked "preinstall" in the catalog come by themselves; the others are in "Free books".
    // Last one first: the shelf lists the newest book first, so Alice ends up first.
    const todo = [...catalog.packs]
      .filter((pack) => pack.preinstall && !have.has(pack.id) && !removed.has(pack.id))
      .reverse();
    if (todo.length === 0) return;
    started = true;
    void (async () => {
      try {
        for (const pack of todo) await useDownloads.getState().start(BUNDLED_CATALOG_URL, pack);
      } finally {
        useClassicsRunning.setState({ running: false });
      }
    })();
  } catch {
    // Offline on the very first start, or no bundled catalog: nothing to do.
  } finally {
    if (!started) useClassicsRunning.setState({ running: false });
  }
}

/** Pack ids listed in the bundled catalog (read once; empty when it cannot be loaded). */
let bundledIds: Promise<Set<string>> | null = null;
function bundledPackIds(): Promise<Set<string>> {
  if (!bundledIds)
    bundledIds = loadCatalog(BUNDLED_CATALOG_URL)
      .then(({ catalog }) => new Set(catalog.packs.map((pack) => pack.id)))
      .catch(() => {
        bundledIds = null;
        return new Set<string>();
      });
  return bundledIds;
}

/** Ids of the books on the shelf that came from a bundled classic (to show the "Free classic" label). */
export function useClassicBookIds(bookKey: string): Set<string> {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const finished = useDownloads((state) => state.finished);
  useEffect(() => {
    let alive = true;
    void Promise.all([listPackRecords(), bundledPackIds()])
      .then(([records, packs]) => {
        if (alive) setIds(new Set(records.filter((r) => packs.has(r.packId)).map((r) => r.bookId)));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [bookKey, finished]);
  return ids;
}
