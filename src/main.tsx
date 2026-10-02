import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MarginApp } from "@/components/margin-app";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <MarginApp />
  </StrictMode>,
);

/** One reload at most per visit, so a broken connection cannot make a reload loop. */
function reloadOnce() {
  try {
    if (sessionStorage.getItem("cibian-reloaded") === "1") return;
    sessionStorage.setItem("cibian-reloaded", "1");
  } catch {
    // no session storage: reload anyway, once, because the flag below stops a second call
  }
  window.location.reload();
}

if (import.meta.env.PROD) {
  // A page from an older build asks for a page chunk that a newer build has replaced: load the new build.
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadOnce();
  });
  window.addEventListener("load", () => {
    try {
      sessionStorage.removeItem("cibian-reloaded");
    } catch {
      // see reloadOnce
    }
  });
}

// Offline app shell. Only in a real build: the dev server must never be cached.
// Register at once so the first book download can be cached (see waitForServiceWorker).
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
