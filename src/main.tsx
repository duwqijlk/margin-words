import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MarginApp } from "@/components/margin-app";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <MarginApp />
  </StrictMode>,
);

// Offline app shell. Only in a real build: the dev server must never be cached.
// Register at once so the first book download can be cached (see waitForServiceWorker).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {
    // The app still works online without it.
  });
}
