/**
 * Share images, drawn on the reader's own device (no server, no upload): "I finished a book" and
 * "My reading". 1080 x 1440 (3:4), which WeChat, QQ, Telegram and X all show whole.
 *
 * Three fixed styles. Every card ends with the site name and a QR code to https://inputread.site,
 * drawn dark on a white square in every style so a phone camera can read it.
 *
 * The words come in as `labels` from the caller (i18n), so this file has no language of its own.
 * Everything that decides a layout (wrapping, the QR grid) is a plain function and tested.
 */
import qrcode from "qrcode-generator";

export const CARD_W = 1080;
export const CARD_H = 1440;
export const SHARE_URL = "https://inputread.site/";

export type ShareTheme = "paper" | "forest" | "night";
export const SHARE_THEMES: readonly ShareTheme[] = ["paper", "forest", "night"];

type Palette = { bg: string; panel: string; ink: string; muted: string; accent: string; line: string; cover: string };
export const PALETTES: Record<ShareTheme, Palette> = {
  paper: { bg: "#f8f6f0", panel: "#ffffff", ink: "#181715", muted: "#6b665e", accent: "#235948", line: "#e3ded2", cover: "#235948" },
  forest: { bg: "#1f4237", panel: "#27503f", ink: "#f6f1e4", muted: "#b9c8bf", accent: "#e8c27a", line: "#3a6352", cover: "#123329" },
  night: { bg: "#151a26", panel: "#1e2536", ink: "#eef0f6", muted: "#9aa3b8", accent: "#9db8ff", line: "#2c3448", cover: "#2a3a66" },
};

const SERIF = '"Literata", Georgia, "Times New Roman", serif';
const SANS = '"Inter", -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

export type Footer = { brand: string; tagline: string; site: string; scan: string };

export type BookCardData = {
  kind: "book";
  headline: string;
  title: string;
  author: string;
  /** "Finished on 29 October 2026" */
  finishedLine: string;
  /** "24 words saved from this book", or "" */
  wordsLine: string;
  cover: CanvasImageSource | null;
  footer: Footer;
};

export type OverviewCardData = {
  kind: "overview";
  headline: string;
  stats: Array<{ value: number; label: string }>;
  /** "120 mastered", or "" */
  note: string;
  recentLabel: string;
  recent: Array<{ title: string; author: string }>;
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

const MARGIN = 96;
const FOOTER_TOP = CARD_H - 312;

function drawFooter(ctx: CanvasRenderingContext2D, footer: Footer, p: Palette) {
  ctx.fillStyle = p.line;
  ctx.fillRect(MARGIN, FOOTER_TOP, CARD_W - MARGIN * 2, 2);
  // QR on a white square, whatever the style.
  const box = 200;
  const bx = CARD_W - MARGIN - box;
  const by = FOOTER_TOP + 56;
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, bx, by, box, box, 18);
  ctx.fill();
  const modules = qrModules(SHARE_URL);
  const inner = box - 28;
  const cell = inner / modules.length;
  ctx.fillStyle = "#111111";
  modules.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (dark) ctx.fillRect(bx + 14 + c * cell, by + 14 + r * cell, Math.ceil(cell), Math.ceil(cell));
    }),
  );
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = p.ink;
  font(ctx, 700, 56, SERIF);
  ctx.fillText(footer.brand, MARGIN, FOOTER_TOP + 116);
  ctx.fillStyle = p.muted;
  font(ctx, 500, 30, SANS);
  ctx.fillText(footer.tagline, MARGIN, FOOTER_TOP + 166);
  ctx.fillStyle = p.accent;
  font(ctx, 600, 30, SANS);
  ctx.fillText(footer.site, MARGIN, FOOTER_TOP + 212);
  ctx.fillStyle = p.muted;
  font(ctx, 500, 24, SANS);
  ctx.fillText(footer.scan, MARGIN, FOOTER_TOP + 252);
}

function drawGeneratedCover(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, title: string, p: Palette) {
  ctx.fillStyle = p.cover;
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2;
  roundRect(ctx, x + 18, y + 18, w - 36, h - 36, 6);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  font(ctx, 700, 40, SERIF);
  ctx.textBaseline = "alphabetic";
  const lines = wrapLines((text) => ctx.measureText(text).width, title, w - 80, 4);
  let ty = y + h / 2 - ((lines.length - 1) * 50) / 2 + 14;
  ctx.textAlign = "center";
  for (const line of lines) {
    ctx.fillText(line, x + w / 2, ty);
    ty += 50;
  }
}

function drawBook(ctx: CanvasRenderingContext2D, data: BookCardData, p: Palette) {
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = p.accent;
  font(ctx, 600, 34, SANS);
  centred(ctx, [data.headline], 150, 0);

  // The cover, with a soft shadow.
  const cw = 330;
  const ch = 495;
  const cx = (CARD_W - cw) / 2;
  const cy = 206;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.28)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = p.cover;
  roundRect(ctx, cx, cy, cw, ch, 14);
  ctx.fill();
  ctx.restore();
  if (data.cover) {
    ctx.save();
    roundRect(ctx, cx, cy, cw, ch, 14);
    ctx.clip();
    ctx.drawImage(data.cover, cx, cy, cw, ch);
    ctx.restore();
  } else {
    drawGeneratedCover(ctx, cx, cy, cw, ch, data.title, p);
  }

  let y = cy + ch + 96;
  ctx.fillStyle = p.ink;
  font(ctx, 700, 60, SERIF);
  const titleLines = wrapLines((text) => ctx.measureText(text).width, data.title, CARD_W - MARGIN * 2, 2);
  y = centred(ctx, titleLines, y, 72);
  ctx.fillStyle = p.muted;
  font(ctx, 500, 34, SERIF);
  y = centred(ctx, wrapLines((text) => ctx.measureText(text).width, data.author, CARD_W - MARGIN * 2, 1), y + 4, 44);

  // Date and word count as a quiet pill row.
  ctx.fillStyle = p.ink;
  font(ctx, 600, 34, SANS);
  const facts = [data.finishedLine, data.wordsLine].filter(Boolean);
  y += 30;
  for (const fact of facts) {
    const w = Math.min(ctx.measureText(fact).width + 64, CARD_W - MARGIN * 2);
    ctx.fillStyle = p.panel;
    roundRect(ctx, (CARD_W - w) / 2, y - 46, w, 66, 33);
    ctx.fill();
    ctx.fillStyle = p.ink;
    centred(ctx, [fact], y, 0);
    y += 84;
  }
}

function drawOverview(ctx: CanvasRenderingContext2D, data: OverviewCardData, p: Palette) {
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = p.ink;
  font(ctx, 700, 64, SERIF);
  centred(ctx, wrapLines((text) => ctx.measureText(text).width, data.headline, CARD_W - MARGIN * 2, 1), 190, 0);

  // Three numbers side by side on panels.
  const gap = 24;
  const n = Math.max(1, data.stats.length);
  const pw = (CARD_W - MARGIN * 2 - gap * (n - 1)) / n;
  const py = 260;
  const ph = 260;
  data.stats.forEach((stat, i) => {
    const px = MARGIN + i * (pw + gap);
    ctx.fillStyle = p.panel;
    roundRect(ctx, px, py, pw, ph, 28);
    ctx.fill();
    ctx.textAlign = "center";
    ctx.fillStyle = p.accent;
    const value = String(stat.value);
    let size = 112;
    font(ctx, 700, size, SERIF);
    while (ctx.measureText(value).width > pw - 40 && size > 48) {
      size -= 8;
      font(ctx, 700, size, SERIF);
    }
    ctx.fillText(value, px + pw / 2, py + 150);
    ctx.fillStyle = p.muted;
    font(ctx, 600, 30, SANS);
    const label = wrapLines((text) => ctx.measureText(text).width, stat.label, pw - 32, 1)[0] ?? "";
    ctx.fillText(label, px + pw / 2, py + 214);
  });

  let y = py + ph + 64;
  if (data.note) {
    ctx.fillStyle = p.muted;
    font(ctx, 500, 30, SANS);
    centred(ctx, [data.note], y, 0);
    y += 70;
  }
  if (data.recent.length > 0) {
    ctx.textAlign = "left";
    ctx.fillStyle = p.accent;
    font(ctx, 600, 30, SANS);
    ctx.fillText(data.recentLabel, MARGIN, y);
    y += 30;
    for (const book of data.recent.slice(0, 4)) {
      if (y + 96 > FOOTER_TOP - 24) break;
      ctx.fillStyle = p.line;
      ctx.fillRect(MARGIN, y, CARD_W - MARGIN * 2, 2);
      y += 62;
      ctx.textAlign = "left";
      ctx.fillStyle = p.ink;
      font(ctx, 700, 40, SERIF);
      const title = wrapLines((text) => ctx.measureText(text).width, book.title, CARD_W - MARGIN * 2, 1)[0] ?? "";
      ctx.fillText(title, MARGIN, y);
      ctx.fillStyle = p.muted;
      font(ctx, 500, 26, SERIF);
      const author = wrapLines((text) => ctx.measureText(text).width, book.author, CARD_W - MARGIN * 2, 1)[0] ?? "";
      ctx.fillText(author, MARGIN, y + 38);
      y += 64;
    }
  }
}

/** Draw one card on a CARD_W x CARD_H context. */
export function drawShareCard(ctx: CanvasRenderingContext2D, data: ShareCardData, theme: ShareTheme): void {
  const p = PALETTES[theme];
  ctx.clearRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  // A thin accent band at the top, the same in every card.
  ctx.fillStyle = p.accent;
  ctx.fillRect(0, 0, CARD_W, 12);
  if (data.kind === "book") drawBook(ctx, data, p);
  else drawOverview(ctx, data, p);
  drawFooter(ctx, data.footer, p);
}

/** Make sure the card's web fonts are ready; a canvas does not wait for them. */
export async function loadCardFonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load) return;
  await Promise.all(
    ["700 60px Literata", "500 34px Literata", "600 34px Inter", "500 30px Inter"].map((spec) =>
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
