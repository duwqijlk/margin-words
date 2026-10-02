import { useEffect, useRef, useState } from "react";
import { loadAllCovers } from "@/lib/book-db";
import { coverCrossOrigin } from "@/lib/cover-request";
import { cn } from "@/components/ui";

export function useCovers(ids: string[]) {
  const [covers, setCovers] = useState<Record<string, string>>({});
  const key = ids.join("|");
  useEffect(() => {
    let alive = true;
    const load = () => {
      void loadAllCovers()
        .then((next) => {
          if (alive) setCovers(next);
        })
        .catch(() => {
          if (alive) setCovers({});
        });
    };
    load();
    window.addEventListener("cibian-covers", load);
    return () => {
      alive = false;
      window.removeEventListener("cibian-covers", load);
    };
  }, [key]);
  return covers;
}

/**
 * Typographic cover for a book that has no cover picture: a calm bookbinding colour picked from the title,
 * a framed title in a serif face, the author underneath. Sizes use container units, so the same cover is
 * right at 90px and at 220px wide.
 */
const COVER_PALETTES: ReadonlyArray<readonly [string, string]> = [
  ["#2f6b57", "#1b4033"],
  ["#b85c38", "#76381f"],
  ["#35507a", "#1d2c47"],
  ["#7a4a6b", "#472840"],
  ["#b8872b", "#7d5512"],
  ["#4a5568", "#252b37"],
  ["#2f7f86", "#1a4c52"],
  ["#8a5a3c", "#522f1e"],
  ["#5f8a68", "#3b5e45"],
];

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
}: {
  title: string;
  author: string;
  cover?: string;
  className?: string;
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
  const [from, to] = pair as readonly [string, string];
  const size = title.length <= 14 ? "11.5cqw" : title.length <= 30 ? "9.5cqw" : "8cqw";
  const failed = Boolean(cover) && broken === cover;
  const showImage = Boolean(cover) && !failed && near;
  const pending = Boolean(cover) && !failed && !showImage;
  const showGenerated = !cover || failed;
  return (
    <span
      ref={frame}
      className={cn(
        "cover-frame relative block aspect-[2/3] w-full shrink-0 overflow-hidden rounded-md bg-line shadow-cover ring-1 ring-ink/10 transition-[transform,box-shadow] duration-200 [container-type:inline-size]",
        className,
      )}
      {...(showGenerated ? { "data-generated-cover": "" } : {})}
    >
      {pending || (showImage && loaded !== cover) ? (
        <span className="absolute inset-0 animate-pulse bg-line" data-cover-pending="" aria-hidden />
      ) : null}
      {showImage ? (
        <img
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
      {showGenerated ? (
        <span
          className="absolute inset-0 flex flex-col items-center justify-between text-center text-[#fbf6ea]"
          style={{
            backgroundImage: `linear-gradient(155deg, ${from}, ${to})`,
            padding: "13cqw 11cqw 11cqw",
          }}
        >
          <span
            className="pointer-events-none absolute -top-[22cqw] -right-[22cqw] size-[76cqw] rounded-full bg-white/10"
            aria-hidden
          />
          <span
            className="pointer-events-none absolute inset-[5cqw] rounded-[1cqw] border border-white/35"
            aria-hidden
          />
          <span className="h-px w-[16cqw] bg-white/60" aria-hidden />
          <span
            className="relative font-display leading-[1.12] font-semibold [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:5] overflow-hidden text-balance"
            style={{ fontSize: size }}
            lang="en"
          >
            {title}
          </span>
          <span className="grid justify-items-center gap-[3cqw]">
            <span className="h-px w-[16cqw] bg-white/60" aria-hidden />
            {author ? (
              <span
                className="max-w-full tracking-[0.08em] uppercase opacity-90 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden"
                style={{ fontSize: "5.6cqw", lineHeight: 1.3 }}
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
