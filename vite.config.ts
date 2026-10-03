import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// @ts-expect-error plain JS plugins next to the TS config
import { guideFolder, offlineShell, packsFolder, publicBooks, wordLists } from "./scripts/vite-plugins.mjs";

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
  build: { outDir: "dist", emptyOutDir: true },
  plugins: [packsFolder(), publicBooks(), wordLists(), guideFolder(), tailwindcss(), viteReact(), offlineShell()],
});
