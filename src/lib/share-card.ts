/**
 * A fixed phone-screen picture for the notebook share button.
 * The file is 720×1280 (a 360×640 phone screen at 2×), not a large poster.
 * Drawn on a canvas so it is ready in one pass, with no network call.
 */

export const SHARE_CARD_CSS_WIDTH = 360;
export const SHARE_CARD_CSS_HEIGHT = 640;
export const SHARE_CARD_SCALE = 2;
export const SHARE_CARD_WIDTH = SHARE_CARD_CSS_WIDTH * SHARE_CARD_SCALE;
export const SHARE_CARD_HEIGHT = SHARE_CARD_CSS_HEIGHT * SHARE_CARD_SCALE;
export const SHARE_SITE = "inputread.site";

const EN_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const SANS = 'Inter, "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", sans-serif';
const DISPLAY = 'Literata, Georgia, "Songti SC", "Noto Serif SC", serif';

const PAPER = "#f3efe4";
const INK = "#1f1d1a";
const MUTED = "#6e675c";
const ACCENT = "#28604f";
const ACCENT_SOFT = "#e2eee8";
const LINE = "#e4dccb";

export type ShareCardText = {
  nickname: string;
  /** Already translated, for example "words learned". */
  wordsLabel: string;
  /** Already translated month-and-day line. */
  dateLabel: string;
  count: number;
};

/** Month and day only. The Chinese template adds the month and day marks around these numbers. */
export function shareDateParts(date: Date, locale: "en" | "zh"): { month: string; day: string } {
  const day = String(date.getDate());
  if (locale === "zh") return { month: String(date.getMonth() + 1), day };
  return { month: EN_MONTHS[date.getMonth()] ?? String(date.getMonth() + 1), day };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function fillFitted(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  weight: number,
  size: number,
  min: number,
  family: string,
  color: string,
) {
  let px = size;
  ctx.fillStyle = color;
  ctx.font = `${weight} ${px}px ${family}`;
  while (px > min && ctx.measureText(text).width > maxWidth) {
    px -= 1;
    ctx.font = `${weight} ${px}px ${family}`;
  }
  let shown = text;
  if (ctx.measureText(shown).width > maxWidth) {
    const chars = [...shown];
    while (chars.length > 1 && ctx.measureText(`${chars.join("")}…`).width > maxWidth) chars.pop();
    shown = `${chars.join("")}…`;
  }
  ctx.fillText(shown, x, y);
}

/** Paint the fixed template onto a canvas sized as a phone screen. */
export function drawShareCard(canvas: HTMLCanvasElement, text: ShareCardText) {
  canvas.width = SHARE_CARD_WIDTH;
  canvas.height = SHARE_CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const width = SHARE_CARD_CSS_WIDTH;
  const height = SHARE_CARD_CSS_HEIGHT;
  ctx.setTransform(SHARE_CARD_SCALE, 0, 0, SHARE_CARD_SCALE, 0, 0);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, width, 8);

  fillFitted(ctx, text.dateLabel, width / 2, 64, width - 48, 600, 16, 13, SANS, MUTED);
  fillFitted(ctx, text.nickname, width / 2, 118, width - 48, 650, 34, 20, SANS, INK);

  const plateW = 240;
  const plateH = 176;
  const plateX = (width - plateW) / 2;
  const plateY = 176;
  ctx.fillStyle = ACCENT_SOFT;
  roundRect(ctx, plateX, plateY, plateW, plateH, 28);
  ctx.fill();
  fillFitted(ctx, String(Math.max(0, Math.floor(text.count))), width / 2, plateY + 74, plateW - 24, 650, 76, 36, DISPLAY, ACCENT);
  fillFitted(ctx, text.wordsLabel, width / 2, plateY + 132, plateW - 28, 600, 16, 12, SANS, MUTED);

  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(40, height - 88);
  ctx.lineTo(width - 40, height - 88);
  ctx.stroke();
  fillFitted(ctx, SHARE_SITE, width / 2, height - 48, width - 48, 650, 18, 14, SANS, ACCENT);
}

/** One canvas pass, then a PNG. The blob is the phone-sized file. */
export async function renderShareCard(text: ShareCardText): Promise<Blob> {
  if (typeof document !== "undefined" && document.fonts?.load) {
    await Promise.all([
      document.fonts.load(`650 34px ${SANS}`),
      document.fonts.load(`650 76px ${DISPLAY}`),
    ]).catch(() => undefined);
  }
  const canvas = document.createElement("canvas");
  drawShareCard(canvas, text);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("share-card");
  return blob;
}
