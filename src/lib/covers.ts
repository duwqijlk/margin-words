/**
 * Fetching a catalog cover. The books host serves cover.jpg with a long browser cache (4 hours), so a
 * changed cover would not show up in time. The catalog gives every cover a sha256; it is added to the
 * address (`?v=<first 12 letters>`), so a new picture is a new address and is fetched fresh.
 */

export function dataUrlOf(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => resolve("");
    reader.readAsDataURL(blob);
  });
}

/** The address to fetch for a cover with this version. Without a version the address is unchanged. */
export function coverAddress(url: string, sha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) return url;
  const hash = url.indexOf("#");
  const base = hash >= 0 ? url.slice(0, hash) : url;
  return `${base}${base.includes("?") ? "&" : "?"}v=${sha256.slice(0, 12)}`;
}

/** The cover as a data URL, or "" when it cannot be fetched. Never throws. */
export async function fetchCoverData(url: string, sha256: string): Promise<string> {
  try {
    const response = await fetch(coverAddress(url, sha256));
    if (!response.ok) return "";
    return await dataUrlOf(await response.blob());
  } catch {
    return "";
  }
}
