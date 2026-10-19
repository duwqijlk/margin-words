/**
 * Paging calculations for the reader.
 *
 * PageDown and PageUp move by whole text lines, leaving an overlap of lines kept back
 * as tolerance so that the reader never skips unread lines across page turns.
 *
 * Keep four lines for native bars and reading continuity on every device. Extra browser
 * scrolling is handled by the page guard, not by shrinking e-ink pages to half a screen.
 * Paragraph margins already occupy scroll distance; they do not need another deduction.
 */

export const MIN_TURN_MS = 220;
export const PAGE_KEEP_LINES_DEFAULT = 4;

/** Height of the sticky top bar, which covers the top of the text while reading. */
export function topBarHeight(bar: HTMLElement | null): number {
  if (!bar) return 56;
  const height = bar.getBoundingClientRect().height;
  return height > 0 ? height : 56;
}

/** One line of the book text, in px: the reading column's own line-height. */
export function readerLineHeight(article: HTMLElement | null): number {
  if (!article) return 32;
  const style = window.getComputedStyle(article);
  const line = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(line) && line > 4) return line;
  const size = Number.parseFloat(style.fontSize);
  return Number.isFinite(size) && size > 4 ? size * 1.8 : 32;
}

/**
 * Detects whether the current device is an e-ink reader.
 * Checks media queries (update: slow, monochrome), user-agent keywords,
 * and portrait screen dimensions with aspect ratio between 1.10 and 1.85.
 */
export function isEinkScreen(width: number, height: number, ua?: string): boolean {
  if (typeof window !== "undefined") {
    try {
      if (window.matchMedia?.("(update: slow)").matches) return true;
      if (window.matchMedia?.("(monochrome)").matches) return true;
    } catch {
      // ignore
    }
  }
  const userAgent = ua ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  if (
    /e[-]?ink|moaan|inkpalm|onyx|boox|meebook|likebook|kindle|kobo|tolino|pocketbook/i.test(
      userAgent,
    )
  ) {
    return true;
  }
  if (width < 1024) {
    const ratio = height / Math.max(1, width);
    return ratio >= 1.1 && ratio <= 1.85;
  }
  return false;
}

export function calculatePageStep(input: {
  viewportHeight: number;
  topBarHeight?: number;
  lineHeight: number;
  viewportWidth: number;
  userAgent?: string;
}): number {
  const bar = typeof input.topBarHeight === "number" ? input.topBarHeight : 0;
  const visible = Math.max(120, input.viewportHeight - bar);
  const line = input.lineHeight > 4 ? input.lineHeight : 32;
  const rawLines = Math.floor(visible / line);

  const lines = rawLines - PAGE_KEEP_LINES_DEFAULT;
  if (lines < 1) return Math.round(Math.min(visible, line));
  return Math.round(lines * line);
}

const PROBE_KEY = "cibian-paging-probe";

/**
 * The paging probe: a small line on the reading page with the last key the device sent, our page
 * size and the last move, so a device that still turns too far can say why. Turned on by opening
 * a book with `?probe=paging` on its address (`/read/<id>?probe=paging`) and off with
 * `?probe=off`; in between it stays on in this browser.
 */
export function pagingProbeOn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const asked = new URLSearchParams(window.location.search).get("probe");
    if (asked === "paging") window.localStorage.setItem(PROBE_KEY, "1");
    else if (asked === "off") window.localStorage.removeItem(PROBE_KEY);
    return window.localStorage.getItem(PROBE_KEY) === "1";
  } catch {
    return false;
  }
}
