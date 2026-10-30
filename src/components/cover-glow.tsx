import { coverCrossOrigin } from "@/lib/cover-request";

/**
 * The cover glow (design system v44): the book's own cover, blurred and enlarged, behind a card that
 * belongs to one book (the continue card, Discover's newest book, the top of the book detail), as if
 * the cover were giving off light. Put it first inside a `glow` box. Styles are `.glow` /
 * `.cover-glow` in styles.css: dimmer at night, none on e-ink or with reduced transparency. A book
 * with no cover image (a speech's drawn cover) has no glow.
 *
 * It loads the very same request as the cover beside it: the same URL and the same anonymous CORS
 * mode (`coverCrossOrigin`), so the browser answers it from the image the cover already loaded and
 * never downloads the cover twice. A plain <img> (no CORS) would be a second request, and its
 * cached copy without CORS headers could then break the cover itself (see cover-request.ts).
 */
export function CoverGlow({ src, variant }: { src?: string; variant?: "detail" }) {
  if (!src) return null;
  return (
    <img
      className={variant === "detail" ? "cover-glow cover-glow-detail" : "cover-glow"}
      src={src}
      crossOrigin={coverCrossOrigin(src)}
      alt=""
      aria-hidden
      draggable={false}
      decoding="async"
      data-cover-glow
    />
  );
}
