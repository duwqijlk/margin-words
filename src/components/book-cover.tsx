import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
        series?: string;
      }) => ({
        id: pack.id,
        title: pack.title,
        author: pack.author,
        isbn: pack.isbn ?? "",
        cover: pack.cover?.url ? { url: resolveAgainst(catalogUrl, pack.cover.url), sha256: pack.cover.sha256 } : null,
        category: pack.category,
        series: pack.series ?? "",
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
    const ted: string[] = [];
    for (const book of books) {
      const url = cloudCover(book, packIds[book.id], sources);
      if (url) out[book.id] = url;
      const row = catalogRowOf(book, packIds[book.id], sources);
      if (row?.category === "speech") {
        speeches.push(book.id);
        if (isTedSeries(row.series)) ted.push(book.id);
      }
    }
    // Shared with the shelf cards below; done after render so no listener is set during render.
    queueMicrotask(() => noteSpeechBooks(speeches, ted));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, packIds, key]);
}

/**
 * Typographic cover for a book that has no cover picture. Sizes use container units, so the same cover is
 * right at 90px and at 220px wide. Two looks:
 *  - "book": a bookbinding cloth colour, one hairline frame, the title centred in a serif face and the
 *    author under a short rule.
 *  - "talk" (speeches, which often may not use the event's own picture; design system BookCover v48):
 *    a small microphone and SPEECH at the top left, faint sound rings spreading from the top-right
 *    corner, the title in the lower half, the speaker under it and a 16-bar waveform drawn from the
 *    title, so no two speeches look alike. The ground runs from a light top right to a deep bottom left.
 *  - "ted" (a talk in the TED series): the same, with a fine outlined tag in place of SPEECH, our own
 *    small stage drawing and "TALK · TED" in plain type; no TED red, lettering or logo.
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

export type CoverLook = "book" | "talk" | "ted";

/** The series name of TED talks in the catalog. */
export function isTedSeries(series: string | undefined): boolean {
  return (series ?? "").trim().toUpperCase() === "TED";
}

/** How a book with no cover picture is drawn, from its catalog category and series. */
export function coverLookOf(category: string | undefined, series?: string): CoverLook {
  if (category !== "speech") return "book";
  return isTedSeries(series) ? "ted" : "talk";
}

/** The speech cover's waveform: 16 bar heights (15-95%) worked out from the title, the same every time. */
export function talkWave(title: string): number[] {
  return Array.from({ length: 16 }, (_, i) => 15 + (hashOf(`${title}#${i}`) % 81));
}

/**
 * The ground colour of a speech's generated cover (the same pick as the cover itself): that book's
 * own colour (src/lib/cover-tone.ts), since a generated cover has no picture to take it from.
 */
export function talkCoverTone(title: string, author: string): string {
  const pair = COVER_PALETTES[hashOf(`${title}|${author}`) % COVER_PALETTES.length] ?? COVER_PALETTES[0];
  return (pair as readonly string[])[0] ?? "";
}

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
  const talkSize = title.length <= 18 ? "11cqw" : title.length <= 40 ? "9.4cqw" : "8cqw";
  const talk = look === "talk" || look === "ted";
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
        "cover-frame relative block aspect-cover w-full shrink-0 overflow-hidden rounded-cover bg-line shadow-cover transition-[transform,box-shadow] duration-[280ms] [container-type:inline-size]",
        className,
      )}
      {...(showGenerated ? { "data-generated-cover": "" } : {})}
    >
      {pending || (showImage && loaded !== cover) ? (
        <span className="cover-shimmer absolute inset-0" data-cover-pending="" aria-hidden />
      ) : null}
      {showImage ? (
        <img
          ref={imgRef}
          src={cover}
          alt=""
          crossOrigin={coverCrossOrigin(cover)}
          className={cn("absolute inset-0 h-full w-full object-cover transition-opacity duration-[280ms]", loaded !== cover && "opacity-0")}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(cover ?? null)}
          onError={() => setBroken(cover ?? null)}
        />
      ) : null}
      {showGenerated && talk ? (
        <span
          data-generated-inner=""
          data-cover-look={look}
          className="talk-cover"
          style={{ "--g": from, "--d": to, "--t": tint } as CSSProperties}
        >
          {look === "ted" ? (
            <span className="talk-mark" data-talk-mark="" aria-hidden>
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="8" r="3.2" fill="currentColor" stroke="none" />
                <ellipse cx="12" cy="17.5" rx="8.5" ry="2.6" />
              </svg>
              Talk<i>{"\u00b7"}</i>TED
            </span>
          ) : (
            <span className="talk-kind" data-talk-kind="" aria-hidden>
              <svg viewBox="0 0 24 24">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <path d="M12 18v4" />
              </svg>
              Speech
            </span>
          )}
          <span data-cover-title="" className="talk-title" style={{ fontSize: talkSize }} lang="en">
            {title}
          </span>
          {author ? (
            <span data-cover-author="" className="talk-by" lang="en">
              {author}
            </span>
          ) : null}
          <span className="talk-wave" data-talk-wave="" aria-hidden>
            {talkWave(title).map((height, index) => (
              <i key={index} style={{ height: `${height}%` }} />
            ))}
          </span>
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
        className="pointer-events-none absolute inset-0 rounded-cover ring-1 ring-inset ring-black/10"
        aria-hidden
      />
    </span>
  );
}
