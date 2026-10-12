/**
 * Which picture in an EPUB should start selected on the book upload page.
 * A file whose name says it is the cover wins. Otherwise the largest picture.
 * The admin can still pick another picture, or no cover.
 */

export function preferredCoverPath(images: readonly { path: string; bytes: number }[]): string | null {
  if (images.length === 0) return null;
  const named = images.filter((image) => isCoverName(image.path));
  const pool = named.length > 0 ? named : images;
  return pool.reduce((best, image) => (image.bytes > best.bytes ? image : best)).path;
}

function isCoverName(path: string): boolean {
  const base = path.split("/").pop() ?? path;
  return /(^|[^a-z])cover([^a-z]|$)/i.test(base);
}
