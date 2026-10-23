import { useEffect, useState } from "react";
import { booksUrl } from "@/lib/books-base";
import type { Locale } from "@/lib/i18n";
import { blurbKey, parseBlurbFile, type BlurbKind, type BookBlurb } from "@/lib/book-blurb-file";

/**
 * Summaries read this session, by object key. A book with no file (404) is remembered as empty,
 * so reopening its sheet does not ask again. A failed read is forgotten and tried next time.
 */
const seen = new Map<string, Promise<BookBlurb>>();

function loadBlurb(kind: BlurbKind, id: string): Promise<BookBlurb> {
  const key = blurbKey(kind, id);
  let blurb = seen.get(key);
  if (!blurb) {
    // no-cache: an edit in the admin shows up on the next open, as the catalogs do.
    blurb = fetch(booksUrl(key), { cache: "no-cache" })
      .then((response) => {
        if (response.status === 404) return { zh: "", en: "" };
        if (!response.ok) throw new Error("blurb");
        // A host that answers a missing file with a page (status 200, HTML) means "no summary" too,
        // not a failure to retry on every open. Not "must be JSON": the books host sends files
        // written by the admin with no content type at all.
        if (/html/i.test(response.headers.get("content-type") ?? "")) return { zh: "", en: "" };
        return response.json().then(parseBlurbFile);
      })
      .catch(() => {
        seen.delete(key);
        return { zh: "", en: "" };
      });
    seen.set(key, blurb);
  }
  return blurb;
}

/** Forget a cached summary, so the admin sees a save at once. */
export function forgetBlurb(kind: BlurbKind, id: string): void {
  seen.delete(blurbKey(kind, id));
}

/**
 * The summary of one book in the interface language, or "" while it loads and when there is none.
 * There is no fallback to the other language: a Chinese screen shows Chinese or nothing.
 */
export function useBookBlurb(book: { kind: BlurbKind; id: string } | null, locale: Locale): string {
  const [blurb, setBlurb] = useState("");
  const kind = book?.kind;
  const id = book?.id;
  useEffect(() => {
    setBlurb("");
    if (!kind || !id) return;
    let alive = true;
    void loadBlurb(kind, id).then((value) => {
      if (alive) setBlurb(value[locale]);
    });
    return () => {
      alive = false;
    };
  }, [kind, id, locale]);
  return blurb;
}
