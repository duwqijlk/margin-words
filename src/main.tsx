import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MarginApp } from "@/components/margin-app";
import { RELOAD_QUIET_MS, RELOAD_STOP, reloadPlan } from "@/lib/reload-guard";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <MarginApp />
  </StrictMode>,
);

/** Survives a reload. Cleared only after the page has stayed up (see the load handler). */
const RELOAD_KEY = "cibian-reloaded";
let memoryMark: string | null = null;

function readReloadMark(): string | null {
  try {
    return sessionStorage.getItem(RELOAD_KEY) ?? memoryMark;
  } catch {
    return memoryMark;
  }
}

function writeReloadMark(value: string): void {
  memoryMark = value;
  try {
    sessionStorage.setItem(RELOAD_KEY, value);
  } catch {
    // Private mode can block session storage. The memory mark still stops a second call here.
  }
}

/** One reload for this burst. A second call in the quiet window does nothing. */
function reloadOnce(): boolean {
  if (reloadPlan(Date.now(), readReloadMark()) !== "reload") return false;
  writeReloadMark(String(Date.now()));
  window.location.reload();
  return true;
}

/**
 * The chunks still failed after a reload. Step the worker aside and load once more
 * from the network. This is the hard refresh that used to be the only way out.
 */
async function dropStaleShell(): Promise<void> {
  writeReloadMark(RELOAD_STOP);
  try {
    if ("serviceWorker" in navigator) {
      const current = await navigator.serviceWorker.getRegistration();
      current?.active?.postMessage("cibian-bypass");
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("margin-words-shell-") || key.startsWith("margin-words-books"))
          .map((key) => caches.delete(key)),
      );
    }
  } catch {
    // Reload anyway.
  }
  window.location.reload();
}

if (import.meta.env.PROD) {
  // A page from an older build asks for a page chunk that a newer build has replaced: load the new build.
  // The mark is not cleared on load. Load fires even when the next chunk fails, and clearing it
  // there made every refresh reload again (a blank page, or a refresh that never stopped).
  let chunkFailed = false;
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    chunkFailed = true;
    const plan = reloadPlan(Date.now(), readReloadMark());
    if (plan === "reload") {
      writeReloadMark(String(Date.now()));
      window.location.reload();
      return;
    }
    if (plan === "reset") void dropStaleShell();
  });
  window.addEventListener("load", () => {
    window.setTimeout(() => {
      if (chunkFailed) return;
      try {
        sessionStorage.removeItem(RELOAD_KEY);
      } catch {
        // see writeReloadMark
      }
      memoryMark = null;
    }, RELOAD_QUIET_MS);
  });
}

// Offline app shell. Only in a real build: the dev server must never be cached.
// Book files are not part of this cache. An added book stays in IndexedDB.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let updated = false;
  // A new version took over: reload so the page and its files are all from the same version.
  // While someone is reading, wait until they leave the book.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || updated) return;
    updated = true;
    if (!window.location.pathname.startsWith("/read/")) {
      reloadOnce();
      return;
    }
    window.addEventListener("cibian-route", () => reloadOnce(), { once: true });
  });
  navigator.serviceWorker
    .register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then((registration) => {
      const check = () => void registration.update().catch(() => undefined);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
      check();
    })
    .catch(() => {
      // The app still works online without it.
    });
}
