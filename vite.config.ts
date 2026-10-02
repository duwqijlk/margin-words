import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// @ts-expect-error plain JS plugins next to the TS config
import { guideFolder, offlineShell, packsFolder, publicBooks, wordLists } from "./scripts/vite-plugins.mjs";

/**
 * The reader is a plain static single-page app: `vite build` writes ordinary files to ./dist
 * (index.html, assets/, sw.js, guide/). No server, no server functions. Book files are not in dist.
 * They are fetched from VITE_BOOKS_BASE (production default https://books.inputread.site) or, in dev
 * and in `npm run build:local`, from this server (./public-books and ./word-lists).
 * `base: "./"` makes every URL relative, so the output works from any folder or sub-path of
 * any static host. Copyrighted EPUBs live in ./packs and are never deployed (see README).
 */
export default defineConfig({
  base: "./",
  server: { host: "0.0.0.0", port: 8080, strictPort: true },
  preview: { host: "127.0.0.1", port: 8081, strictPort: true },
  resolve: { tsconfigPaths: true },
  build: { outDir: "dist", emptyOutDir: true },
  plugins: [packsFolder(), publicBooks(), wordLists(), guideFolder(), tailwindcss(), viteReact(), offlineShell()],
});
