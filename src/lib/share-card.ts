/**
 * Share images, drawn on the reader's own device (no server, no upload). 1080 x 1440 (3:4), which
 * WeChat, QQ, Telegram and X all show whole.
 *
 * Two cards, both built on things that belong to books rather than to dashboards:
 *   - "I finished a book" is a bookplate: the real cover, large, on a field tinted with the cover's
 *     own colour, with a square seal stamped on its corner (the word "finished" and the date), the
 *     way a reader stamps a collector's seal into a book they own.
 *   - "My reading" is a library card: a short shelf of the finished books' spines, then the totals
 *     as a ledger with dotted leaders.
 * Three fixed styles. Every card ends with the site name and a QR code to https://inputread.site,
 * dark on a white tile in every style so a phone camera reads it.
 *
 * The words come in from the caller (i18n), so this file has no language of its own. Everything
 * that decides a layout (wrapping, the QR grid, spine sizes, colour maths) is a plain function and
 * tested; the drawing is checked in a browser.
 */
import qrcode from "qrcode-generator";

export const CARD_W = 1080;
export const CARD_H = 1440;
export const SHARE_URL = "https://inputread.site/";

export type ShareTheme = "paper" | "forest" | "night";
export const SHARE_THEMES: readonly ShareTheme[] = ["paper", "forest", "night"];

type Palette = {
  bg: string;
  ink: string;
  muted: string;
  accent: string;
  rule: string;
  /** The seal: its ink, and the colour its characters are cut in. */
  seal: string;
  sealCut: string;
  shelf: string;
  /** Book-cloth colours for spines and a book with no cover. */
  cloths: readonly string[];
};

export const PALETTES: Record<ShareTheme, Palette> = {
  paper: {
    bg: "#f6f2e9",
    ink: "#1d1b18",
    muted: "#756e64",
    accent: "#235948",
    rule: "#d8d0c1",
    seal: "#b23a2b",
    sealCut: "#f6f2e9",
    shelf: "#8a6a4a",
    cloths: ["#235948", "#7b4b24", "#2f4a6d", "#8c3b3b", "#5b6b3a", "#4a3f63"],
  },
  forest: {
    bg: "#173a2f",
    ink: "#f2ead6",
    muted: "#a7bbaf",
    accent: "#e0b96c",
    rule: "#2e5848",
    seal: "#c8432f",
    sealCut: "#f2ead6",
    shelf: "#0e2a21",
    cloths: ["#e0b96c", "#a8462f", "#6f8f5b", "#d9cfb4", "#3f6f8a", "#8a5a3b"],
  },
  night: {
    bg: "#11162a",
    ink: "#eceff7",
    muted: "#959fb8",
    accent: "#9fb9ff",
    rule: "#283152",
    seal: "#e0563f",
    sealCut: "#11162a",
    shelf: "#070a16",
    cloths: ["#9fb9ff", "#e0563f", "#d8b46a", "#6fb3a3", "#b48ad8", "#e8e3d6"],
  },
};

const SERIF = '"Literata", Georgia, "Times New Roman", serif';
/** Chinese in a Song face where the device has one (iOS, Windows, most Android), English in Literata. */
const SERIF_ZH = '"Literata", "Songti SC", "STSong", "Noto Serif CJK SC", "Source Han Serif SC", "SimSun", serif';
const SANS = '"Inter", -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

export type Footer = { brand: string; tagline: string; site: string; scan: string };

export type BookCardData = {
  kind: "book";
  /** "I finished an English book" */
  headline: string;
  title: string;
  author: string;
  /** "24 words saved from this book", or "" */
  wordsLine: string;
  /** The seal: one or two short words ("finished"), and the date as digits (2026.10.28). */
  seal: string;
  sealDate: string;
  cover: CanvasImageSource | null;
  footer: Footer;
};

export type OverviewCardData = {
  kind: "overview";
  headline: string;
  /** "As of 29 October 2026" */
  asOf: string;
  /** The ledger: "Books finished ...... 6 books". */
  rows: Array<{ label: string; value: number; unit: string }>;
  /** "120 words mastered", or "" */
  note: string;
  /** Finished books, latest first: their spines stand on the shelf. */
  shelf: Array<{ title: string }>;
  footer: Footer;
};

export type ShareCardData = BookCardData | OverviewCardData;

/**
 * Break `text` into at most `maxLines` lines no wider than `maxWidth`. Words stay whole unless one
 * alone is too wide; Chinese (no spaces) breaks between characters. A cut last line ends with "…".
 */
export function wrapLines(measure: (text: string) => number, text: string, maxWidth: number, maxLines: number): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || maxLines < 1) return [];
  // Latin words stay whole; every CJK character is its own piece.
  const pieces = clean.match(/[\u3400-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]|[^\s\u3400-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]+|\s+/g) ?? [clean];
  const lines: string[] = [];
  let line = "";
  const push = () => {
    lines.push(line.trim());
    line = "";
  };
  for (let i = 0; i < pieces.length; i += 1) {
    const piece = pieces[i];
    const next = line + piece;
    if (measure(next.trim()) <= maxWidth || !line.trim()) {
      if (measure(piece.trim()) > maxWidth && !line.trim()) {
        // One piece wider than the line: cut it by characters.
        let part = "";
        for (const ch of piece) {
          if (measure(part + ch) > maxWidth && part) {
            line = part;
            push();
            if (lines.length === maxLines) return ellipsize(measure, lines, maxWidth, true);
            part = "";
          }
          part += ch;
        }
        line = part;
      } else {
        line = next;
      }
      continue;
    }
    push();
    if (lines.length === maxLines) return ellipsize(measure, lines, maxWidth, true);
    line = /^\s+$/.test(piece) ? "" : piece;
  }
  if (line.trim()) push();
  return lines;
}

function ellipsize(measure: (text: string) => number, lines: string[], maxWidth: number, cut: boolean): string[] {
  if (!cut) return lines;
  const last = lines.length - 1;
  let text = lines[last];
  while (text && measure(`${text}…`) > maxWidth) text = text.slice(0, -1);
  lines[last] = `${text.replace(/[\s,.;:]+$/, "")}…`;
  return lines;
}

/** The QR code of `text` as rows of dark (true) and light modules. Medium error correction. */
export function qrModules(text: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => qr.isDark(row, col)));
}

/** A rounded rectangle path. ctx.roundRect is missing on the older engines this site still runs on. */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function font(ctx: CanvasRenderingContext2D, weight: number, size: number, family: string) {
  ctx.font = `${weight} ${size}px ${family}`;
}

function centred(ctx: CanvasRenderingContext2D, lines: string[], y: number, lineHeight: number): number {
  ctx.textAlign = "center";
  for (const line of lines) {
    ctx.fillText(line, CARD_W / 2, y);
    y += lineHeight;
  }
  return y;
}


/** A stable number from a text, for sizes and colours that must not change between draws. */
export function textHash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type Spine = { x: number; width: number; height: number; cloth: number; title: string };

/**
 * The spines on the shelf, left to right, inside `width`. Real books first (latest finished on the
 * left); a short shelf is filled with plain spines so it never looks empty. Sizes come from the
 * title, so the same books always stand the same way.
 */
export function shelfSpines(titles: readonly string[], width: number, minBooks = 7): Spine[] {
  const gap = 8;
  const spines: Spine[] = [];
  let x = 0;
  const all = [...titles];
  while (all.length < minBooks) all.push("");
  for (let i = 0; i < all.length; i += 1) {
    const title = all[i];
    const h = textHash(title || `plain-${i}`);
    const w = 58 + (h % 26);
    if (x + w > width) break;
    spines.push({ x, width: w, height: 236 + ((h >>> 8) % 100), cloth: (h >>> 16) % 6, title });
    x += w + gap;
  }
  return spines;
}

/** "#rrggbb" or "rgb(r,g,b)" to [r, g, b]. */
function rgbOf(color: string): [number, number, number] {
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const parts = color.match(/\d+/g)?.map(Number) ?? [0, 0, 0];
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** `a` moved toward `b` by `t` (0..1), as rgb(). */
export function mix(a: string, b: string, t: number): string {
  const x = rgbOf(a);
  const y = rgbOf(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** The average colour of a cover, or null when it cannot be read. */
function coverTone(image: CanvasImageSource): string | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 6;
    canvas.height = 9;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, 6, 9);
    const data = ctx.getImageData(0, 0, 6, 9).data;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    const n = data.length / 4;
    return `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
  } catch {
    return null;
  }
}

/** A faint paper grain, the same on every draw. */
function grain(ctx: CanvasRenderingContext2D, color: string, seed: number) {
  let s = seed || 1;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < 3200; i += 1) {
    ctx.globalAlpha = 0.025 + next() * 0.04;
    ctx.fillRect(next() * CARD_W, next() * CARD_H, 1 + next() * 1.6, 1 + next() * 1.6);
  }
  ctx.restore();
}

const MARGIN = 96;
const FOOTER_TOP = CARD_H - 236;

function drawFooter(ctx: CanvasRenderingContext2D, footer: Footer, p: Palette) {
  ctx.fillStyle = p.rule;
  ctx.fillRect(MARGIN, FOOTER_TOP, CARD_W - MARGIN * 2, 2);
  const box = 156;
  const bx = CARD_W - MARGIN - box;
  const by = FOOTER_TOP + 40;
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, bx, by, box, box, 14);
  ctx.fill();
  const modules = qrModules(SHARE_URL);
  const inner = box - 24;
  const cell = inner / modules.length;
  ctx.fillStyle = "#16151a";
  modules.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (dark) ctx.fillRect(bx + 12 + c * cell, by + 12 + r * cell, Math.ceil(cell), Math.ceil(cell));
    }),
  );
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = p.ink;
  font(ctx, 700, 46, SERIF);
  ctx.fillText(footer.brand, MARGIN, FOOTER_TOP + 92);
  ctx.fillStyle = p.muted;
  font(ctx, 500, 27, SANS);
  ctx.fillText(footer.tagline, MARGIN, FOOTER_TOP + 136);
  ctx.fillStyle = p.accent;
  font(ctx, 600, 27, SANS);
  ctx.fillText(`${footer.site}  ${footer.scan}`, MARGIN, FOOTER_TOP + 178);
}

/** A cover drawn as cloth: for a book whose picture could not be read. */
function drawClothCover(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, title: string, cloth: string) {
  ctx.fillStyle = cloth;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 22, y + 22, w - 44, h - 44);
  ctx.fillStyle = "#ffffff";
  font(ctx, 700, 44, SERIF);
  const lines = wrapLines((text) => ctx.measureText(text).width, title, w - 96, 5);
  let ty = y + h / 2 - ((lines.length - 1) * 56) / 2 + 14;
  ctx.textAlign = "center";
  for (const line of lines) {
    ctx.fillText(line, x + w / 2, ty);
    ty += 56;
  }
}

/** The square seal, stamped a little crooked, with the ink a little uneven. */
function drawSeal(ctx: CanvasRenderingContext2D, cx: number, cy: number, word: string, date: string, p: Palette, seed: number) {
  const size = 188;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.12);
  ctx.globalAlpha = 0.93;
  ctx.fillStyle = p.seal;
  roundRect(ctx, -size / 2, -size / 2, size, size, 12);
  ctx.fill();
  ctx.strokeStyle = p.sealCut;
  ctx.lineWidth = 4;
  roundRect(ctx, -size / 2 + 12, -size / 2 + 12, size - 24, size - 24, 6);
  ctx.stroke();
  ctx.fillStyle = p.sealCut;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  let wordSize = 76;
  font(ctx, 900, wordSize, SERIF_ZH);
  while (ctx.measureText(word).width > size - 44 && wordSize > 30) {
    wordSize -= 4;
    font(ctx, 900, wordSize, SERIF_ZH);
  }
  ctx.fillText(word, 0, 16);
  font(ctx, 700, 25, SANS);
  ctx.fillText(date, 0, 62);
  // Ink that did not take: a few pale flecks.
  let s = seed || 7;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 70; i += 1) {
    ctx.beginPath();
    ctx.arc((next() - 0.5) * size, (next() - 0.5) * size, 0.8 + next() * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawBook(ctx: CanvasRenderingContext2D, data: BookCardData, p: Palette) {
  const seed = textHash(data.title);
  // A field in the cover's own colour, darkened toward the ink so white type and the seal read on it.
  const tone = data.cover ? coverTone(data.cover) : null;
  const base = tone ?? p.cloths[seed % p.cloths.length];
  const field = { x: 64, y: 64, w: CARD_W - 128, h: 760 };
  const gradient = ctx.createLinearGradient(0, field.y, 0, field.y + field.h);
  gradient.addColorStop(0, mix(base, p.bg, 0.22));
  gradient.addColorStop(1, mix(base, "#000000", 0.48));
  ctx.fillStyle = gradient;
  roundRect(ctx, field.x, field.y, field.w, field.h, 36);
  ctx.fill();
  grain(ctx, "#ffffff", seed);

  // The book, standing in the field.
  const cw = 380;
  const ch = 570;
  const cx = (CARD_W - cw) / 2;
  const cy = 138;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.42)";
  ctx.shadowBlur = 56;
  ctx.shadowOffsetY = 28;
  ctx.fillStyle = base;
  ctx.fillRect(cx, cy, cw, ch);
  ctx.restore();
  if (data.cover) ctx.drawImage(data.cover, cx, cy, cw, ch);
  else drawClothCover(ctx, cx, cy, cw, ch, data.title, base);
  // The spine edge: a soft fold of light down the left of the cover.
  const fold = ctx.createLinearGradient(cx, 0, cx + 28, 0);
  fold.addColorStop(0, "rgba(0,0,0,0.28)");
  fold.addColorStop(0.35, "rgba(255,255,255,0.18)");
  fold.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = fold;
  ctx.fillRect(cx, cy, 28, ch);

  // Half on the cover, half off it: the cover's own title stays readable.
  drawSeal(ctx, cx + cw + 40, cy + ch - 70, data.seal, data.sealDate, p, seed);

  // The words under the field.
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = p.muted;
  font(ctx, 500, 32, SERIF_ZH);
  centred(ctx, [data.headline], field.y + field.h + 68, 0);
  // One line at 64px; a long title gets two lines at 54px, so the block keeps one height.
  ctx.fillStyle = p.ink;
  font(ctx, 700, 64, SERIF);
  const width = CARD_W - MARGIN * 2;
  let titleLines = wrapLines((text) => ctx.measureText(text).width, data.title, width, 1);
  let lineHeight = 0;
  if (titleLines[0]?.endsWith("\u2026")) {
    font(ctx, 700, 54, SERIF);
    titleLines = wrapLines((text) => ctx.measureText(text).width, data.title, width, 2);
    lineHeight = 64;
  }
  const titleTop = field.y + field.h + (titleLines.length > 1 ? 142 : 152);
  centred(ctx, titleLines, titleTop, lineHeight);
  const below = titleTop + (titleLines.length - 1) * lineHeight;
  ctx.fillStyle = p.muted;
  ctx.font = `italic 400 34px ${SERIF}`;
  centred(ctx, wrapLines((text) => ctx.measureText(text).width, data.author, width, 1), below + 54, 0);
  if (data.wordsLine) {
    ctx.fillStyle = p.accent;
    font(ctx, 600, 30, SANS);
    centred(ctx, [data.wordsLine], below + 108, 0);
  }
}

function drawOverview(ctx: CanvasRenderingContext2D, data: OverviewCardData, p: Palette) {
  const seed = textHash(data.shelf.map((book) => book.title).join("|") || data.headline);
  grain(ctx, p.ink, seed);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = p.ink;
  font(ctx, 700, 76, SERIF_ZH);
  ctx.fillText(wrapLines((text) => ctx.measureText(text).width, data.headline, CARD_W - MARGIN * 2, 1)[0] ?? "", MARGIN, 182);
  ctx.fillStyle = p.muted;
  font(ctx, 500, 29, SANS);
  ctx.fillText(data.asOf, MARGIN, 236);

  // The shelf: finished books' spines, plain ones to fill it out.
  const boardY = 640;
  const spines = shelfSpines(
    data.shelf.map((book) => book.title),
    CARD_W - MARGIN * 2 - 16,
  );
  // The row of books stands in the middle of the board.
  const last = spines[spines.length - 1];
  const used = last ? last.x + last.width : 0;
  const offset = MARGIN + 8 + Math.max(0, (CARD_W - MARGIN * 2 - 16 - used) / 2);
  for (const spine of spines) {
    const x = offset + spine.x;
    const y = boardY - spine.height;
    const plain = !spine.title;
    const cloth = plain ? mix(p.rule, p.bg, 0.15) : p.cloths[spine.cloth];
    ctx.fillStyle = cloth;
    roundRect(ctx, x, y, spine.width, spine.height + 6, 5);
    ctx.fill();
    // Two bands across the spine, as on a cloth binding.
    ctx.fillStyle = plain ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.22)";
    ctx.fillRect(x, y + 22, spine.width, 4);
    ctx.fillRect(x, y + spine.height - 30, spine.width, 4);
    if (!plain) {
      ctx.save();
      ctx.translate(x + spine.width / 2 + 9, boardY - 44);
      ctx.rotate(-Math.PI / 2);
      const light = rgbOf(cloth).reduce((sum, v) => sum + v, 0) > 360;
      ctx.fillStyle = light ? "rgba(20,18,16,0.85)" : "rgba(255,255,255,0.92)";
      font(ctx, 700, 24, SERIF);
      ctx.textAlign = "left";
      const room = spine.height - 92;
      const label = wrapLines((text) => ctx.measureText(text).width, spine.title, room, 1)[0] ?? "";
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  }
  ctx.fillStyle = p.shelf;
  ctx.fillRect(MARGIN - 16, boardY + 6, CARD_W - MARGIN * 2 + 32, 18);
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(MARGIN - 16, boardY + 24, CARD_W - MARGIN * 2 + 32, 8);

  // The ledger.
  let y = 800;
  for (const row of data.rows) {
    ctx.textAlign = "left";
    ctx.fillStyle = p.ink;
    font(ctx, 500, 38, SERIF_ZH);
    const label = wrapLines((text) => ctx.measureText(text).width, row.label, 420, 1)[0] ?? "";
    ctx.fillText(label, MARGIN, y);
    const labelEnd = MARGIN + ctx.measureText(label).width;
    font(ctx, 500, 30, SANS);
    const unitWidth = row.unit ? ctx.measureText(row.unit).width : 0;
    const unitX = CARD_W - MARGIN - unitWidth;
    ctx.fillStyle = p.muted;
    if (row.unit) ctx.fillText(row.unit, unitX, y);
    let size = 92;
    font(ctx, 700, size, SERIF);
    const value = String(row.value);
    while (ctx.measureText(value).width > 360 && size > 48) {
      size -= 6;
      font(ctx, 700, size, SERIF);
    }
    const valueWidth = ctx.measureText(value).width;
    const valueX = unitX - (row.unit ? 14 : 0) - valueWidth;
    ctx.fillStyle = p.accent;
    ctx.fillText(value, valueX, y);
    // Dotted leader from the label to the number, as in a ledger.
    ctx.fillStyle = p.rule;
    for (let dx = labelEnd + 24; dx < valueX - 20; dx += 16) {
      ctx.beginPath();
      ctx.arc(dx, y - 10, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    y += 116;
  }
  if (data.note && y < FOOTER_TOP - 30) {
    ctx.textAlign = "left";
    ctx.fillStyle = p.muted;
    font(ctx, 500, 28, SANS);
    ctx.fillText(data.note, MARGIN, y - 30);
  }
}

/** Draw one card on a CARD_W x CARD_H context. */
export function drawShareCard(ctx: CanvasRenderingContext2D, data: ShareCardData, theme: ShareTheme): void {
  const p = PALETTES[theme];
  ctx.clearRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  if (data.kind === "book") drawBook(ctx, data, p);
  else drawOverview(ctx, data, p);
  drawFooter(ctx, data.footer, p);
}

/** Make sure the card's web fonts are ready; a canvas does not wait for them. */
export async function loadCardFonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load) return;
  await Promise.all(
    ["700 64px Literata", "italic 400 34px Literata", "500 32px Literata", "600 30px Inter", "500 27px Inter"].map((spec) =>
      document.fonts.load(spec).catch(() => []),
    ),
  );
}

/** Load a cover for the canvas. Null when it cannot be read (no CORS, offline): the card draws its own. */
export async function loadCover(url: string | undefined): Promise<CanvasImageSource | null> {
  if (!url) return null;
  try {
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (typeof createImageBitmap === "function") return await createImageBitmap(blob);
    const src = URL.createObjectURL(blob);
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  } catch {
    return null;
  }
}

/** The finished PNG. */
export function renderCardBlob(data: ShareCardData, theme: ShareTheme): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  drawShareCard(ctx, data, theme);
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), "image/png");
    } catch {
      // A cover from another origin without CORS taints the canvas.
      resolve(null);
    }
  });
}
