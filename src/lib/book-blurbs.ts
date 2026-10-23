import { useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { parseBlurbs, type BlurbTable } from "@/lib/book-blurbs-parse";
// Hashed files in the site build, fetched only when a detail sheet opens. Same pattern as the IPA data.
import zhUrl from "../../docs/blurbs/zh.json?url&no-inline";
import enUrl from "../../docs/blurbs/en.json?url&no-inline";

const URLS: Record<Locale, string> = { zh: zhUrl, en: enUrl };
const tables = new Map<Locale, Promise<BlurbTable>>();

function loadBlurbs(locale: Locale): Promise<BlurbTable> {
  let table = tables.get(locale);
  if (!table) {
    table = fetch(URLS[locale])
      .then((response) => (response.ok ? response.json() : null))
      .then(parseBlurbs)
      .catch(() => {
        // A failed read is tried again the next time a sheet opens.
        tables.delete(locale);
        return {};
      });
    tables.set(locale, table);
  }
  return table;
}

/**
 * The summary of one book in the interface language, or "" when there is none (yet).
 * There is no fallback to the other language: a Chinese screen shows Chinese or nothing.
 */
export function useBookBlurb(id: string | null, locale: Locale): string {
  const [blurb, setBlurb] = useState("");
  useEffect(() => {
    setBlurb("");
    if (!id) return;
    let alive = true;
    void loadBlurbs(locale).then((table) => {
      if (alive) setBlurb(table[id] ?? "");
    });
    return () => {
      alive = false;
    };
  }, [id, locale]);
  return blurb;
}
