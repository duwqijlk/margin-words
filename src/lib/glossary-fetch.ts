/**
 * Word lists on the public books host are fetched through the account API,
 * which counts seven distinct books per week for a plain reader with a checked email.
 * A list on any other host (local dev, a catalog the reader typed) stays a direct fetch.
 */
import { DEFAULT_BOOKS_BASE } from "@/lib/books-base";
import { tr } from "@/lib/i18n";
import { dayLabel, useGlossaryQuota } from "@/lib/glossary-quota";

const BOOKS_HOST = new URL(DEFAULT_BOOKS_BASE).hostname;

/** Book id when this address is a glossary on the public books host, else null. */
export function remoteGlossaryId(absoluteUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(absoluteUrl);
  } catch {
    return null;
  }
  if (url.hostname !== BOOKS_HOST) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 3 || parts[2] !== "glossary.json") return null;
  if (parts[0] !== "word-lists" && parts[0] !== "public-books") return null;
  const id = parts[1] ?? "";
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) ? id : null;
}

/** The bytes of one word list. `fallback` is the message for any failure except the weekly cap. */
export async function fetchProtectedGlossary(bookId: string, fallback: string): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(`/api/glossary/${encodeURIComponent(bookId)}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new Error(fallback);
  }
  // The weekly count changed (a new place used) or the server refused one: show the new numbers.
  void useGlossaryQuota.getState().refresh();
  if (response.ok) return new Uint8Array(await response.arrayBuffer());
  let code = "";
  let resetAt = 0;
  try {
    const body = (await response.json()) as { error?: unknown; resetAt?: unknown };
    code = typeof body.error === "string" ? body.error : "";
    resetAt = typeof body.resetAt === "number" && Number.isFinite(body.resetAt) ? body.resetAt : 0;
  } catch {
    code = "";
  }
  if (code === "glossary-week")
    throw new Error(resetAt ? tr("quota.fullNovel", { day: dayLabel(resetAt) }) : tr("err.glossaryWeek"));
  if (code === "glossary-week-speech")
    throw new Error(resetAt ? tr("quota.fullSpeech", { day: dayLabel(resetAt) }) : tr("err.glossaryWeekSpeech"));
  if (code === "email-unverified") throw new Error(tr("err.emailUnverified"));
  throw new Error(fallback);
}
