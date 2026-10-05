/**
 * A new service worker, or a missing page chunk, may reload the page once so the
 * files on screen match. The mark used to be cleared on the load event, which
 * runs even when the next chunk then fails, so a refresh reloaded forever until
 * a hard refresh (Ctrl+F5) skipped the service worker.
 */

/** A second reload inside this window is the same burst, not a later update. */
export const RELOAD_QUIET_MS = 15_000;

/** sessionStorage value after the shell was already dropped once. */
export const RELOAD_STOP = "stop";

/** What to do when something asks the page to load again. */
export type ReloadPlan = "reload" | "reset" | "stop";

/**
 * Empty mark: reload. A timestamp still inside the quiet window: drop the
 * service worker once (`reset`). `stop`: do nothing, so the page cannot loop.
 */
export function reloadPlan(now: number, stored: string | null, quietMs = RELOAD_QUIET_MS): ReloadPlan {
  if (stored === RELOAD_STOP) return "stop";
  const at = stored == null || stored === "" ? NaN : Number(stored);
  const recent = Number.isFinite(at) && at > 0 && now - at < quietMs;
  return recent ? "reset" : "reload";
}
