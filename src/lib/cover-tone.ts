/**
 * A book's own colour (design system CoverTone): one colour taken from its cover, laid only on the
 * parts of the page that belong to that book (the shelf's continue card, Discover's new book, the top
 * of a book's detail). Buttons, links and progress stay brand green.
 *
 * The design mixes the shades with CSS `color-mix(in oklab, ...)`, which needs Chrome 111; the e-ink
 * readers run Chrome 69, so the same mixes are done here and handed to CSS as plain colours:
 * `--book-wash` (20% book on paper), `--book-tint` (44%), `--book-deep` (60% book on ink, small labels)
 * and `--book-shadow` (the cover's shadow). Night uses less colour and a black shadow; e-ink none.
 *
 * Picking the colour, once per cover and cached: draw the cover at 24×36, skip transparent, near-white
 * and near-black pixels, put the rest in 12 hue groups scored by count × (0.2 + saturation), take the
 * best group's average. Almost grey (OKLCH chroma < 0.04) is no colour. Lightness is clamped to
 * OKLCH L 0.35-0.65 so a very pale or very dark cover still gives a visible colour.
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { usePrefs } from "@/lib/reader-prefs";
import { pickTone, toneStyle } from "@/lib/tone-math";

const CACHE_KEY = "cibian-cover-tone-v1";
const CACHE_MAX = 400;
const memory = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

function readCache(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function writeCache(url: string, hex: string): void {
  try {
    const all = readCache();
    all[url] = hex;
    const keys = Object.keys(all);
    for (const key of keys.slice(0, Math.max(0, keys.length - CACHE_MAX))) delete all[key];
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    // Only a convenience: the colour is picked again next time.
  }
}

function loadTone(url: string): Promise<string> {
  const known = memory.get(url) ?? readCache()[url];
  if (known !== undefined) {
    memory.set(url, known);
    return Promise.resolve(known);
  }
  const running = pending.get(url);
  if (running) return running;
  const job = new Promise<string>((resolve) => {
    const image = new Image();
    // Covers on the books host send CORS headers; without them the canvas cannot be read.
    if (!url.startsWith("data:") && !url.startsWith("blob:") && new URL(url, location.href).origin !== location.origin) {
      image.crossOrigin = "anonymous";
    }
    image.decoding = "async";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 24;
        canvas.height = 36;
        const context = canvas.getContext("2d");
        if (!context) return resolve("");
        context.drawImage(image, 0, 0, 24, 36);
        resolve(pickTone(context.getImageData(0, 0, 24, 36).data));
      } catch {
        resolve("");
      }
    };
    image.onerror = () => resolve("");
    image.src = url;
  }).then((hex) => {
    memory.set(url, hex);
    writeCache(url, hex);
    pending.delete(url);
    return hex;
  });
  pending.set(url, job);
  return job;
}

/**
 * The tone of one book as CSS custom properties. `fixed` is a known colour (a speech's generated
 * cover); otherwise the colour comes from `cover`. Until it is known (and for a grey cover) the
 * shades fall back to `sheet`.
 */
export function useBookTone(cover: string | undefined, fixed?: string): CSSProperties {
  const theme = usePrefs((state) => state.theme);
  const [picked, setPicked] = useState<string>(() => (cover ? memory.get(cover) ?? "" : ""));
  useEffect(() => {
    if (fixed || !cover) return;
    let alive = true;
    void loadTone(cover).then((hex) => {
      if (alive) setPicked(hex);
    });
    return () => {
      alive = false;
    };
  }, [cover, fixed]);
  return useMemo(() => toneStyle(fixed || picked, theme), [fixed, picked, theme]);
}
