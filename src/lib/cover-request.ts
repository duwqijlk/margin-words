/**
 * Cover images and cover fetches share one URL (`public-books/<id>/cover.jpg`,
 * `word-lists/<id>/cover.jpg`). The books host sends Access-Control-Allow-Origin
 * and Vary: Origin only when the request has an Origin header. A plain <img>
 * does not send Origin, so the HTTP cache can keep a copy that a later fetch()
 * is not allowed to read.
 *
 * Cover <img> elements use anonymous CORS, so a new cache entry carries those
 * headers and can be read by fetch(). Cover fetches also use cache: "no-store",
 * so a copy already cached by an older <img> cannot answer them. The bytes are
 * stored as a data URL after that, so skipping the HTTP cache is one small JPEG.
 */

/** `crossorigin` for a cover <img>. Data and blob URLs are already in memory. */
export function coverCrossOrigin(src: string | undefined): "anonymous" | undefined {
  if (!src || /^(data|blob):/i.test(src)) return undefined;
  return "anonymous";
}

/** Fetch a cover. Bypasses the HTTP cache so a no-Origin <img> response cannot be reused. */
export function fetchCover(url: string): Promise<Response> {
  return fetch(url, { cache: "no-store" });
}
