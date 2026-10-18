import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
// @ts-expect-error plain JS plugins next to the TS config
import { dvhFallbacks, guideFolder, offlineShell, packsFolder, publicBooks, wordLists } from "./scripts/vite-plugins.mjs";

/**
 * The reader is a plain static single-page app: `vite build` writes ordinary files to ./dist
 * (index.html, assets/, sw.js, kit/, _headers, _redirects). Book files are not in dist.
 * Optional accounts live in ./functions (Cloudflare Pages Functions) and are not part of this build.
 * They are fetched from VITE_BOOKS_BASE (production default https://books.inputread.site) or, in dev
 * and in `npm run build:local`, from this server (./public-books and ./word-lists).
 * `base: "/"`: the app has real paths (/shelf, /discover, /read/<id>), so every file is addressed from the
 * site root. A host must answer unknown paths with index.html (public/_redirects does that on Cloudflare
 * Pages). Copyrighted EPUBs live in ./packs and are never deployed (see README).
 */
export default defineConfig({
  base: "/",
  server: { host: "0.0.0.0", port: 8080, strictPort: true },
  preview: { host: "127.0.0.1", port: 8081, strictPort: true },
  resolve: { tsconfigPaths: true },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    /**
     * `chrome69`, not the default `baseline-widely-available` (chrome107). The default leaves
     * optional chaining, `??`, `??=` and class static blocks in the bundle. An Android e-ink
     * reader such as the Moaan InkPalm runs Android 8.1 with a WebView around Chrome 69, which
     * cannot PARSE those, so the entry chunk throws before a single line runs and the page stays
     * blank. The floor is the oldest engine we can still support; it costs a little size.
     */
    target: "chrome69",
  },
  // Tailwind is a PostCSS plugin now (postcss.config.js), not a Vite plugin: that is how v3 works.
  plugins: [
    packsFolder(),
    publicBooks(),
    wordLists(),
    guideFolder(),
    viteReact(),
    offlineShell(),
    dvhFallbacks(),
  ],
});
