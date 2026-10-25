import { useEffect, useMemo, useRef, useState } from "react";
import { listPackRecords } from "@/lib/book-db";
import { catalogRowOf, cloudCover, type CoverSources } from "@/lib/cloud-cover";
import { noteSpeechBooks } from "@/lib/speech-books";
import { BUNDLED_CATALOG_URL, loadCatalog, resolveAgainst } from "@/lib/packs";
import { loadWordListCatalog, WORD_LIST_CATALOG_URL } from "@/lib/word-list-catalog";
import { coverCrossOrigin } from "@/lib/cover-request";
import { cn } from "@/components/ui";

/**
 * The cover address of every shelf book, from the live catalogs (see src/lib/cloud-cover.ts). Each
 * card's <img> loads it straight from the books host, cached by the browser and the CDN; nothing is
 * stored on the device. A book with no catalog cover is not in the map and draws its own cover.
 */
export function useCovers(books: ReadonlyArray<{ id: string; title: string; author: string; isbn?: string }>) {
  const [sources, setSources] = useState<CoverSources | null>(null);
  const [packIds, setPackIds] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    void Promise.all([
      loadCatalog(BUNDLED_CATALOG_URL)
        .then((result) => result.catalog.packs)
        .catch(() => []),
      loadWordListCatalog().catch(() => []),
    ]).then(([classics, lists]) => {
      if (!alive) return;
      const row = (catalogUrl: string) => (pack: {
        id: string;
        title: string;
        author: string;
        isbn?: string;
        cover: { url: string; sha256: string } | null;
        category?: "novel" | "speech";
      }) => ({
        id: pack.id,
        title: pack.title,
        author: pack.author,
        isbn: pack.isbn ?? "",
        cover: pack.cover?.url ? { url: resolveAgainst(catalogUrl, pack.cover.url), sha256: pack.cover.sha256 } : null,
        category: pack.category,
      });
      setSources({ classics: classics.map(row(BUNDLED_CATALOG_URL)), lists: lists.map(row(WORD_LIST_CATALOG_URL)) });
    });
    return () => {
      alive = false;
    };
  }, []);
  const key = books.map((book) => book.id).join("|");
  useEffect(() => {
    let alive = true;
    void listPackRecords()
      .then((records) => {
        if (alive) setPackIds(Object.fromEntries(records.map((record) => [record.bookId, record.packId])));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [key]);
  return useMemo(() => {
    const out: Record<string, string> = {};
    if (!sources) return out;
    const speeches: string[] = [];
    for (const book of books) {
      const url = cloudCover(book, packIds[book.id], sources);
      if (url) out[book.id] = url;
      if (catalogRowOf(book, packIds[book.id], sources)?.category === "speech") speeches.push(book.id);
    }
    // Shared with the shelf cards below; done after render so no listener is set during render.
    queueMicrotask(() => noteSpeechBooks(speeches));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, packIds, key]);
}

/**
 * Typographic cover for a book that has no cover picture. Sizes use container units, so the same cover is
 * right at 90px and at 220px wide. Two looks:
 *  - "book": a bookbinding cloth colour, one hairline frame, the title centred in a serif face and the
 *    author under a short rule.
 *  - "talk" (speeches, which often may not use the event's own picture): a deep ground, a large opening
 *    quotation mark in a light tint, the title set left like a pull quote and the speaker under a rule.
 * Each colour is [ground, deeper ground, tint]. The bottom-right corner stays clear for the add button.
 */
const COVER_PALETTES: ReadonlyArray<readonly [string, string, string]> = [
  ["#2c5a4a", "#18362c", "#bfe0cf"],
  ["#9a4a2e", "#5e2a18", "#f3c9a8"],
  ["#2f466c", "#18253d", "#bcd0ee"],
  ["#6b3f5e", "#3c2236", "#ecc4dc"],
  ["#8c6a24", "#56400f", "#f1dca3"],
  ["#3f4756", "#22272f", "#cdd3dd"],
  ["#286a70", "#153f43", "#b6e1e2"],
  ["#5a4a8a", "#322858", "#d4ccf2"],
  ["#4f7457", "#2d4834", "#cde3cf"],
];

export type CoverLook = "book" | "talk";

function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function BookCover({
  title,
  author,
  cover,
  className,
  whenVisible = false,
  look = "book",
}: {
  title: string;
  author: string;
  cover?: string;
  className?: string;
  /** How a cover with no picture is drawn. Speeches use "talk". */
  look?: CoverLook;
  /** Set the image address only once this cover is near the screen. Discover uses this. */
  whenVisible?: boolean;
}) {
  const frame = useRef<HTMLSpanElement>(null);
  // A picture that failed to load is only given up on until the cover changes (a new picture gets a new try).
  const [broken, setBroken] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [near, setNear] = useState(!whenVisible);
  useEffect(() => {
    if (!whenVisible || !cover) {
      setNear(true);
      return;
    }
    setNear(false);
    const el = frame.current;
    if (!el || typeof IntersectionObserver !== "function") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [whenVisible, cover]);
  const pair =
    COVER_PALETTES[hashOf(`${title}|${author}`) % COVER_PALETTES.length] ?? COVER_PALETTES[0];
  const [from, to, tint] = pair as readonly [string, string, string];
  const size = title.length <= 14 ? "11.5cqw" : title.length <= 30 ? "9.5cqw" : "8cqw";
  const talkSize = title.length <= 24 ? "10.5cqw" : title.length <= 48 ? "9cqw" : "7.8cqw";
  const failed = Boolean(cover) && broken === cover;
  const showImage = Boolean(cover) && !failed && near;
  const pending = Boolean(cover) && !failed && !showImage;
  const showGenerated = !cover || failed;
  // A picture already in the cache can finish before React attaches `onLoad`, and then the image
  // stayed at opacity 0 with nothing to un-hide it. Check the element itself once it is mounted.
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const el = imgRef.current;
    if (el?.complete && el.naturalWidth > 0) setLoaded(cover ?? null);
  }, [cover, showImage]);
  return (
    <span
      ref={frame}
      className={cn(
        "cover-frame relative block aspect-cover w-full shrink-0 overflow-hidden rounded-md bg-line shadow-cover ring-1 ring-ink/10 transition-[transform,box-shadow] duration-200 [container-type:inline-size]",
        className,
      )}
      {...(showGenerated ? { "data-generated-cover": "" } : {})}
    >
      {pending || (showImage && loaded !== cover) ? (
        <span className="absolute inset-0 animate-pulse bg-line" data-cover-pending="" aria-hidden />
      ) : null}
      {showImage ? (
        <img
          ref={imgRef}
          src={cover}
          alt=""
          crossOrigin={coverCrossOrigin(cover)}
          className={cn("absolute inset-0 h-full w-full object-cover", loaded !== cover && "opacity-0")}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(cover ?? null)}
          onError={() => setBroken(cover ?? null)}
        />
      ) : null}
      {showGenerated && look === "talk" ? (
        <span
          data-generated-inner=""
          data-cover-look="talk"
          className="absolute inset-0 flex flex-col text-left text-[#fbf7ee]"
          style={{
            // A soft light from the top left, like a stage, on a deep ground.
            backgroundImage: `radial-gradient(120% 80% at 0% 0%, ${from} 0%, ${to} 70%)`,
            padding: "10cqw 10cqw 9cqw",
          }}
        >
          <span
            className="pointer-events-none font-display leading-none font-semibold select-none"
            style={{ fontSize: "34cqw", height: "20cqw", marginLeft: "-1.5cqw", color: tint, opacity: 0.9 }}
            aria-hidden
          >
            {"\u201c"}
          </span>
          <span
            data-cover-title=""
            className="relative font-display leading-[1.15] font-medium [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:6] overflow-hidden"
            style={{ fontSize: talkSize, marginTop: "3cqw" }}
            lang="en"
          >
            {title}
          </span>
          {author ? (
            <span className="mt-auto grid gap-[2.5cqw]" style={{ paddingRight: "26cqw" }}>
              <span className="h-px w-[12cqw]" style={{ backgroundColor: tint, opacity: 0.8 }} aria-hidden />
              <span
                data-cover-author=""
                className="font-medium [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden"
                style={{ fontSize: "5.8cqw", lineHeight: 1.25, color: tint }}
                lang="en"
              >
                {author}
              </span>
            </span>
          ) : null}
        </span>
      ) : null}
      {showGenerated && look === "book" ? (
        <span
          data-generated-inner=""
          data-cover-look="book"
          className="absolute inset-0 flex flex-col items-center justify-between text-center text-[#fbf6ea]"
          style={{
            backgroundImage: `linear-gradient(160deg, ${from}, ${to})`,
            padding: "15cqw 12cqw 17cqw",
          }}
        >
          {/* One hairline frame, like a stamped cloth binding. */}
          <span
            className="pointer-events-none absolute inset-[5.5cqw] rounded-[0.8cqw] border"
            style={{ borderColor: tint, opacity: 0.4 }}
            aria-hidden
          />
          <span className="h-px w-[12cqw]" style={{ backgroundColor: tint, opacity: 0.7 }} aria-hidden />
          <span
            data-cover-title=""
            className="relative font-display leading-[1.12] font-semibold [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:5] overflow-hidden text-balance"
            style={{ fontSize: size }}
            lang="en"
          >
            {title}
          </span>
          <span className="grid justify-items-center gap-[2.5cqw]">
            <span className="h-px w-[12cqw]" style={{ backgroundColor: tint, opacity: 0.7 }} aria-hidden />
            {author ? (
              <span
                data-cover-author=""
                className="max-w-[62cqw] tracking-[0.06em] uppercase [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden"
                style={{ fontSize: "4.8cqw", lineHeight: 1.3, color: tint }}
                lang="en"
              >
                {author}
              </span>
            ) : null}
          </span>
        </span>
      ) : null}
      {/* spine shading */}
      <span
        className="pointer-events-none absolute inset-y-0 left-0 w-[6%] bg-gradient-to-r from-black/30 via-black/10 to-transparent"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-0 rounded-[0.3rem] ring-1 ring-inset ring-black/10"
        aria-hidden
      />
    </span>
  );
}
