/**
 * Share images, drawn on the reader's own device (no server, no upload), as in the design system
 * ShareCard: 1080 x 1512 (3:4.2), which WeChat, QQ, Telegram and X all show whole.
 *
 *   - "I finished a book": the real cover, large and lifted, with a round highlighter-yellow
 *     "Finished" seal on its corner; the title in Literata, the author, the words saved from it.
 *   - "My reading": the finished books' covers fanned out, three big numbers (books finished,
 *     days of reading, words saved) and the words mastered.
 * Three styles: paper (a ground in the book's own colour, from its cover), forest (deep green,
 * white type) and night (dark). Every card ends with the wordmark inputread, a line about the site
 * and a QR code to https://inputread.site, dark on a white tile in every style so a camera reads it.
 *
 * The words come in from the caller (i18n), so this file has no language of its own. Everything
 * that decides a layout (wrapping, the QR grid, the colour maths) is a plain function and tested;
 * the drawing is checked in a browser.
 */
import qrcode from "qrcode-generator";

export const CARD_W = 1080;
export const CARD_H = 1512;
export const SHARE_URL = "https://inputread.site/";

export type ShareTheme = "paper" | "forest" | "night";
export const SHARE_THEMES: readonly ShareTheme[] = ["paper", "forest", "night"];

type Palette = {
  /** The ground: a radial wash from the top-left corner. */
  from: string;
  to: string;
  ink: string;
  ink2: string;
  line: string;
  /** The little round swatch in the style picker. */
  swatch: string;
};

/** Paper's ground is replaced by the book's own colour when there is one (`ground` in the data). */
export const PALETTES: Record<ShareTheme, Palette> = {
  paper: { from: "#e6efe9", to: "#f6f9f7", ink: "#111513", ink2: "#4a524e", line: "rgba(17,21,19,0.14)", swatch: "linear-gradient(135deg, #ffffff, #dfe8e2)" },
  forest: { from: "#1f6b47", to: "#0e3a27", ink: "#f4f7f5", ink2: "#bcd4c6", line: "rgba(255,255,255,0.18)", swatch: "#0e3a27" },
  night: { from: "#23282a", to: "#0f1211", ink: "#eef2f0", ink2: "#a9b2ad", line: "rgba(255,255,255,0.14)", swatch: "#0f1211" },
};

const SERIF = '"Literata", Georgia, "Times New Roman", serif';
const SANS = '"Atkinson Hyperlegible", -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
/** The seal is the one highlighter yellow on the card. */
const SEAL = "#ffe14d";

export type Footer = { brand: string; tagline: string; site: string; scan: string };
/** The book's own colour for the paper style: tint at the top-left corner, wash further out. */
export type Ground = { from: string; to: string };

export type BookCardData = {
  kind: "book";
  /** "I finished an English book" */
  headline: string;
  title: string;
  author: string;
  /** "24 words saved from this book", or "" (the number is drawn bold) */
  wordsLine: string;
  /** The seal's word ("Finished"). */
  seal: string;
  cover: CanvasImageSource | null;
  ground?: Ground;
  footer: Footer;
};

export type OverviewCardData = {
  kind: "overview";
  /** "My English reading · As of 29 October 2026" */
  headline: string;
  /** Three numbers with a small unit after them and a label under. */
  nums: Array<{ label: string; value: number; unit: string }>;
  /** "642 words mastered", or "" (the number is drawn bold) */
  note: string;
  /** Up to three finished books, latest first; a missing picture is drawn as a plain cover. */
  covers: Array<{ title: string; image: CanvasImageSource | null }>;
  ground?: Ground;
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

/** A stable number from a text, for sizes and colours that must not change between draws. */
export function textHash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
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

const PAD = 82;

/** Draw text centred on the card, one line per entry. */
function centred(ctx: CanvasRenderingContext2D, lines: string[], y: number, lineHeight: number): number {
  ctx.textAlign = "center";
  for (const line of lines) {
    ctx.fillText(line, CARD_W / 2, y);
    y += lineHeight;
  }
  return y;
}

/** A line with one number in it ("64 words saved from this book"): the number bold and larger, all centred. */
function lineWithNumber(ctx: CanvasRenderingContext2D, text: string, y: number, p: Palette) {
  const match = text.match(/^(.*?)(\d[\d,]*)(.*)$/);
  ctx.textAlign = "left";
  if (!match) {
    font(ctx, 400, 46, SANS);
    ctx.fillStyle = p.ink2;
    ctx.textAlign = "center";
    ctx.fillText(text, CARD_W / 2, y);
    return;
  }
  const [, before, number, after] = match;
  font(ctx, 400, 46, SANS);
  const wBefore = ctx.measureText(before ?? "").width;
  const wAfter = ctx.measureText(after ?? "").width;
  font(ctx, 700, 56, SERIF);
  const wNum = ctx.measureText(number ?? "").width;
  let x = (CARD_W - wBefore - wNum - wAfter) / 2;
  font(ctx, 400, 46, SANS);
  ctx.fillStyle = p.ink2;
  ctx.fillText(before ?? "", x, y);
  x += wBefore;
  font(ctx, 700, 56, SERIF);
  ctx.fillStyle = p.ink;
  ctx.fillText(number ?? "", x, y);
  x += wNum;
  font(ctx, 400, 46, SANS);
  ctx.fillStyle = p.ink2;
  ctx.fillText(after ?? "", x, y);
}

/** A cover: the picture, or a plain board with the title when it could not be read. */
function drawCover(ctx: CanvasRenderingContext2D, image: CanvasImageSource | null, title: string, x: number, y: number, w: number, h: number, shadow: number) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = shadow;
  ctx.shadowOffsetY = shadow * 0.5;
  roundRect(ctx, x, y, w, h, 18);
  ctx.fillStyle = "#ebe5d8";
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, x, y, w, h, 18);
  ctx.clip();
  if (image) {
    ctx.drawImage(image, x, y, w, h);
  } else {
    ctx.fillStyle = "#1e4a3a";
    ctx.fillRect(x, y + h * 0.84, w, h * 0.16);
    ctx.strokeStyle = "rgba(27,26,23,0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + w * 0.06, y + w * 0.06, w * 0.88, h * 0.84 - w * 0.12);
    ctx.fillStyle = "#1b1a17";
    font(ctx, 700, Math.round(w * 0.11), SERIF);
    const lines = wrapLines((text) => ctx.measureText(text).width, title, w * 0.76, 4);
    ctx.textAlign = "center";
    let ty = y + h * 0.36;
    for (const line of lines) {
      ctx.fillText(line, x + w / 2, ty);
      ty += w * 0.14;
    }
  }
  // The spine: a soft fold of light down the left edge.
  const fold = ctx.createLinearGradient(x, 0, x + w * 0.07, 0);
  fold.addColorStop(0, "rgba(0,0,0,0.22)");
  fold.addColorStop(0.4, "rgba(255,255,255,0.14)");
  fold.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = fold;
  ctx.fillRect(x, y, w * 0.07, h);
  ctx.restore();
}

function drawFooter(ctx: CanvasRenderingContext2D, footer: Footer, p: Palette) {
  const top = CARD_H - 300;
  ctx.fillStyle = p.line;
  ctx.fillRect(PAD, top, CARD_W - PAD * 2, 3);
  // The QR tile, bottom right, with its line under it; both end at the right margin.
  const box = 165;
  font(ctx, 400, 32, SANS);
  const scanWidth = ctx.measureText(footer.scan).width;
  const column = Math.max(box, scanWidth);
  const centre = CARD_W - PAD - column / 2;
  const bx = centre - box / 2;
  const by = top + 36;
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, bx, by, box, box, 14);
  ctx.fill();
  const modules = qrModules(SHARE_URL);
  const inner = box - 22;
  const cell = inner / modules.length;
  ctx.fillStyle = "#111513";
  modules.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (dark) ctx.fillRect(bx + 11 + c * cell, by + 11 + r * cell, Math.ceil(cell), Math.ceil(cell));
    }),
  );
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = p.ink2;
  ctx.textAlign = "center";
  ctx.fillText(footer.scan, centre, by + box + 42);
  // The wordmark and the line about the site, bottom left.
  ctx.textAlign = "left";
  ctx.fillStyle = p.ink;
  font(ctx, 600, 64, SERIF);
  ctx.fillText(footer.brand, PAD, by + box - 30);
  ctx.fillStyle = p.ink2;
  font(ctx, 400, 36, SANS);
  ctx.fillText(wrapLines((t) => ctx.measureText(t).width, footer.tagline, CARD_W - PAD * 2 - column - 32, 1)[0] ?? "", PAD, by + box + 20);
}

function drawGround(ctx: CanvasRenderingContext2D, p: Palette, ground: Ground | undefined) {
  const from = ground?.from ?? p.from;
  const to = ground?.to ?? p.to;
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.hypot(CARD_W, CARD_H) * 0.85);
  g.addColorStop(0, from);
  g.addColorStop(0.7, to);
  g.addColorStop(1, to);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
}

function drawOver(ctx: CanvasRenderingContext2D, text: string, p: Palette) {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = p.ink2;
  // A long line gets smaller type before it is cut.
  let size = 45;
  font(ctx, 700, size, SANS);
  while (ctx.measureText(text).width > CARD_W - PAD * 2 && size > 34) {
    size -= 2;
    font(ctx, 700, size, SANS);
  }
  ctx.fillText(wrapLines((t) => ctx.measureText(t).width, text, CARD_W - PAD * 2, 1)[0] ?? "", PAD, PAD + 40);
}

function drawBook(ctx: CanvasRenderingContext2D, data: BookCardData, p: Palette) {
  drawOver(ctx, data.headline, p);
  const cw = 372;
  const ch = Math.round(cw * 1.5);
  const cx = (CARD_W - cw) / 2;
  const cy = 236;
  drawCover(ctx, data.cover, data.title, cx, cy, cw, ch, 70);
  // The seal: a round highlighter-yellow stamp on the top-right corner, a little turned.
  ctx.save();
  ctx.translate(cx + cw + 68 - 98, cy - 52 + 98);
  ctx.rotate((12 * Math.PI) / 180);
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 14;
  ctx.beginPath();
  ctx.arc(0, 0, 98, 0, Math.PI * 2);
  ctx.fillStyle = SEAL;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.fillStyle = "#111513";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let size = 56;
  font(ctx, 800, size, SANS);
  while (ctx.measureText(data.seal).width > 160 && size > 30) {
    size -= 4;
    font(ctx, 800, size, SANS);
  }
  ctx.fillText(data.seal, 0, 2);
  ctx.restore();
  ctx.textBaseline = "alphabetic";

  // Title (one line, two when long), author, the words saved.
  let y = cy + ch + 118;
  ctx.fillStyle = p.ink;
  font(ctx, 700, 82, SERIF);
  const width = CARD_W - PAD * 2;
  let lines = wrapLines((text) => ctx.measureText(text).width, data.title, width, 1);
  let lh = 0;
  if (lines[0]?.endsWith("\u2026")) {
    font(ctx, 700, 66, SERIF);
    lines = wrapLines((text) => ctx.measureText(text).width, data.title, width, 2);
    lh = 76;
    y -= 22;
  }
  centred(ctx, lines, y, lh);
  y += (lines.length - 1) * lh + 66;
  ctx.fillStyle = p.ink2;
  font(ctx, 400, 46, SANS);
  centred(ctx, wrapLines((text) => ctx.measureText(text).width, data.author, width, 1), y, 0);
  if (data.wordsLine) lineWithNumber(ctx, data.wordsLine, y + 76, p);
}

function drawOverview(ctx: CanvasRenderingContext2D, data: OverviewCardData, p: Palette) {
  drawOver(ctx, data.headline, p);
  // The fan: three covers, the middle one in front, the outer two turned out from the bottom.
  const w = 276;
  const h = Math.round(w * 1.5);
  const fanW = 660;
  const left = (CARD_W - fanW) / 2;
  const bottom = 236 + 444;
  const slots = [
    { x: left, turn: -10, ox: w, z: 0 },
    { x: CARD_W - (CARD_W - fanW) / 2 - w, turn: 10, ox: 0, z: 1 },
    { x: left + 192, turn: 0, ox: w / 2, z: 2 },
  ];
  const books = data.covers.slice(0, 3);
  // Order: second and third books behind, the latest in the middle in front.
  const placed = [books[1], books[2], books[0]];
  slots.forEach((slot, i) => {
    const book = placed[i];
    if (!book) return;
    ctx.save();
    ctx.translate(slot.x + slot.ox, bottom);
    ctx.rotate((slot.turn * Math.PI) / 180);
    drawCover(ctx, book.image, book.title, -slot.ox, -h, w, h, 40);
    ctx.restore();
  });

  // Three numbers.
  const top = bottom + 150;
  const col = (CARD_W - PAD * 2) / 3;
  data.nums.slice(0, 3).forEach((num, i) => {
    const cxCol = PAD + col * i + col / 2;
    ctx.textBaseline = "alphabetic";
    font(ctx, 700, 98, SERIF);
    const value = num.value.toLocaleString("en-US");
    const wValue = ctx.measureText(value).width;
    font(ctx, 700, 45, SANS);
    // Latin units get a space after the number ("6 books"); Chinese ones sit right on the number.
    const unit = num.unit && /^[A-Za-z]/.test(num.unit) ? ` ${num.unit}` : num.unit;
    const wUnit = unit ? ctx.measureText(unit).width + 4 : 0;
    let x = cxCol - (wValue + wUnit) / 2;
    ctx.textAlign = "left";
    ctx.fillStyle = p.ink;
    font(ctx, 700, 98, SERIF);
    ctx.fillText(value, x, top);
    x += wValue + 4;
    if (unit) {
      font(ctx, 700, 45, SANS);
      ctx.fillText(unit, x, top);
    }
    ctx.textAlign = "center";
    ctx.fillStyle = p.ink2;
    font(ctx, 400, 41, SANS);
    ctx.fillText(num.label, cxCol, top + 62);
  });
  if (data.note) lineWithNumber(ctx, data.note, top + 168, p);
}

/** Draw one card on a CARD_W x CARD_H context. */
export function drawShareCard(ctx: CanvasRenderingContext2D, data: ShareCardData, theme: ShareTheme): void {
  const p = PALETTES[theme];
  ctx.clearRect(0, 0, CARD_W, CARD_H);
  drawGround(ctx, p, theme === "paper" ? data.ground : undefined);
  if (data.kind === "book") drawBook(ctx, data, p);
  else drawOverview(ctx, data, p);
  drawFooter(ctx, data.footer, p);
}

/** Make sure the card's web fonts are ready; a canvas does not wait for them. */
export async function loadCardFonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load) return;
  await Promise.all(
    ["700 82px Literata", "600 64px Literata", '700 45px "Atkinson Hyperlegible"', '400 46px "Atkinson Hyperlegible"'].map((spec) =>
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
