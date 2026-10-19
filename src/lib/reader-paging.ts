/**
 * Paging calculations for the reader.
 *
 * PageDown and PageUp move by whole text lines, leaving an overlap of lines kept back
 * as tolerance so that the reader never skips unread lines across page turns.
 *
 * On squarish e-ink screens (aspect ratio ~3:4 or 4:5, e.g. 600x800, 758x1024, 1072x1448),
 * paragraph margins (1.1em) and Android WebView navigation/status bars reduce physical
 * line capacity, so a larger tolerance is applied to avoid overshooting.
 */

export const MIN_TURN_MS = 220;
export const PAGE_KEEP_LINES_DEFAULT = 4;
export const PAGE_KEEP_LINES_EINK = 5;

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
 * An e-ink reader in portrait orientation has an aspect ratio (height / width)
 * between 1.15 and 1.62 (e.g. 3:4 = 1.33, 4:5 = 1.25, 10:16 = 1.60) and width < 1024px.
 * Wide screens (>= 1024px) are computer layouts; tall screens (> 1.62) are phones.
 */
export function isEinkScreen(width: number, height: number): boolean {
  if (width >= 1024) return false;
  const ratio = height / Math.max(1, width);
  return ratio >= 1.15 && ratio <= 1.62;
}

export function calculatePageStep(input: {
  viewportHeight: number;
  topBarHeight: number;
  lineHeight: number;
  viewportWidth: number;
}): number {
  const visible = Math.max(120, input.viewportHeight - input.topBarHeight);
  const line = input.lineHeight > 4 ? input.lineHeight : 32;
  const rawLines = Math.floor(visible / line);

  const isEink = isEinkScreen(input.viewportWidth, input.viewportHeight);
  const keepLines = isEink
    ? Math.max(PAGE_KEEP_LINES_EINK, Math.ceil(rawLines * 0.28))
    : PAGE_KEEP_LINES_DEFAULT;

  const lines = rawLines - keepLines;
  if (lines < 1) return Math.round(Math.min(visible, line));
  return Math.round(lines * line);
}
