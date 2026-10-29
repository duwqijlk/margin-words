/**
 * Pure colour maths for a book's tone (src/lib/cover-tone.ts): sRGB <-> OKLab, `color-mix(in oklab)`
 * done by hand (Chrome 69 has no color-mix), picking one colour from a cover's pixels, and the four
 * shades per theme. No imports, so the tests can load it directly.
 */
import type { CSSProperties } from "react";

export type Rgb = [number, number, number];

/* ---- colour maths (sRGB <-> OKLab) */

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function rgbToOklab([r, g, b]: Rgb): Rgb {
  const lr = toLinear(r / 255);
  const lg = toLinear(g / 255);
  const lb = toLinear(b / 255);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToRgb([L, A, B]: Rgb): Rgb {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const clamp = (c: number) => Math.max(0, Math.min(255, Math.round(toGamma(Math.max(0, Math.min(1, c))) * 255)));
  return [clamp(lr), clamp(lg), clamp(lb)];
}

export function hexToRgb(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const n = parseInt(match[1] ?? "0", 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** `color-mix(in oklab, a weight%, b)`. */
export function mixOklab(a: string, b: string, weight: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return a;
  const la = rgbToOklab(ra);
  const lb = rgbToOklab(rb);
  return rgbToHex(oklabToRgb([0, 1, 2].map((i) => la[i]! * weight + lb[i]! * (1 - weight)) as Rgb));
}

/** One colour from a cover's pixels (RGBA bytes), or "" for a grey or white cover. */
export function pickTone(pixels: ArrayLike<number>): string {
  type Bin = { score: number; r: number; g: number; b: number; n: number };
  const bins: Bin[] = Array.from({ length: 12 }, () => ({ score: 0, r: 0, g: 0, b: 0, n: 0 }));
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    const a = pixels[i + 3]!;
    if (a < 128) continue;
    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    const light = (max + min) / 2;
    if (light > 0.92 || light < 0.08) continue;
    const delta = max - min;
    const sat = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1));
    let hue = 0;
    if (delta > 0) {
      const rr = r / 255;
      const gg = g / 255;
      const bb = b / 255;
      if (max === rr) hue = ((gg - bb) / delta + 6) % 6;
      else if (max === gg) hue = (bb - rr) / delta + 2;
      else hue = (rr - gg) / delta + 4;
    }
    const bin = bins[Math.min(11, Math.floor((hue / 6) * 12))]!;
    bin.score += 0.2 + sat;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bin.n += 1;
  }
  const best = bins.reduce((top, bin) => (bin.score > top.score ? bin : top), bins[0]!);
  if (!best.n) return "";
  const [L, A, B] = rgbToOklab([best.r / best.n, best.g / best.n, best.b / best.n]);
  if (Math.hypot(A, B) < 0.04) return "";
  return rgbToHex(oklabToRgb([Math.max(0.35, Math.min(0.65, L)), A, B]));
}

/** Paper, ink, sheet and ink-2 of each theme (the same values as src/styles.css). */
const THEME: Record<string, { paper: string; ink: string; sheet: string; muted: string }> = {
  light: { paper: "#ffffff", ink: "#111513", sheet: "#f3f5f4", muted: "#4a524e" },
  sepia: { paper: "#f4ecdc", ink: "#2c2318", sheet: "#ebe1cc", muted: "#5e5040" },
  dark: { paper: "#0f1211", ink: "#eef2f0", sheet: "#181c1a", muted: "#b2bab6" },
  eink: { paper: "#ffffff", ink: "#000000", sheet: "#f2f2f2", muted: "#333333" },
};

/** The four shades for one book colour in the current theme (CSS custom properties). */
export function toneStyle(book: string, theme: string): CSSProperties {
  const { paper, ink, sheet, muted } = THEME[theme] ?? THEME.light!;
  if (theme === "eink" || !hexToRgb(book)) {
    return {
      "--book-wash": sheet,
      "--book-tint": sheet,
      "--book-deep": theme === "eink" ? ink : muted,
      "--book-shadow": "rgb(0 0 0 / 0.35)",
    } as CSSProperties;
  }
  const dark = theme === "dark";
  const shadow = dark ? "#000000" : mixOklab(book, "#000000", 0.55);
  const [r, g, b] = hexToRgb(shadow) ?? [0, 0, 0];
  return {
    "--book": book,
    "--book-wash": mixOklab(book, paper, 0.2),
    "--book-tint": mixOklab(book, paper, dark ? 0.36 : 0.44),
    "--book-deep": mixOklab(book, ink, dark ? 0.45 : 0.6),
    "--book-shadow": shadow,
    "--book-shadow-rgb": `${r} ${g} ${b}`,
  } as CSSProperties;
}

