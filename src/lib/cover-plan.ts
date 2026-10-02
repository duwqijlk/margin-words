/**
 * What to do with the cover a card has now, given the cover the catalog gives it. Pure, so it is tested alone.
 */
export type CoverInfo = { source: "catalog" | "epub" | "chapter"; ref: string };

export type CoverTarget = { url: string; sha256: string };

/**
 * What a stored cover should be, given what is stored.
 *  - "keep": nothing to do
 *  - "fetch": download the catalog picture (it is missing, or older than the catalog's)
 *  - "tag": the stored picture is the catalog's; only note that
 *  - "derive": no picture and no catalog one: look in the book
 */
export function coverPlan(input: {
  have: boolean;
  info: CoverInfo | undefined;
  stored: boolean;
  target: CoverTarget | null;
  /** sha256 of the stored picture, worked out only when nothing says where it came from */
  haveSha?: string;
}): "keep" | "fetch" | "tag" | "derive" {
  const { have, info, stored, target } = input;
  if (!target) return !have && stored ? "derive" : "keep";
  if (!have) return "fetch";
  if (info?.source === "catalog") return !target.sha256 || info.ref === target.sha256 ? "keep" : "fetch";
  if (info?.source === "epub") return "keep";
  if (info?.source === "chapter") return "fetch";
  return input.haveSha && input.haveSha === target.sha256 ? "tag" : "fetch";
}

