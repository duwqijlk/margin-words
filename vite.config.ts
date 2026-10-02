import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// @ts-expect-error plain JS plugins next to the TS config
import { guideFolder, offlineShell, packsFolder, publicBooks } from "./scripts/vite-plugins.mjs";

/**
 * The reader is a plain static single-page app: `vite build` writes ordinary files to ./dist
 * (index.html, assets/, sw.js, public-books/). No server, no server functions. The only books inside are the
 * public-domain classics of ./public-books; the copyrighted packs in ./packs never go into dist.
 * `base: "./"` makes every URL relative, so the output works from any folder or sub-path of
 * any static host. Other book packs live in ./packs and are loaded at run time (see README).
 */
export default defineConfig({
  base: "./",
  server: { host: "0.0.0.0", port: 8080, strictPort: true },
  preview: { host: "127.0.0.1", port: 8081, strictPort: true },
  resolve: { tsconfigPaths: true },
  build: { outDir: "dist", emptyOutDir: true },
  plugins: [packsFolder(), publicBooks(), guideFolder(), tailwindcss(), viteReact(), offlineShell()],
});
