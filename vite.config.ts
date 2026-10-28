import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
// @ts-expect-error build-only JS plugin
import { localIpaData } from "./scripts/ipa-data-plugin.mjs";
import viteReact from "@vitejs/plugin-react";
import legacy from "@vitejs/plugin-legacy";
// @ts-expect-error build-only JS plugin
import { seoPages } from "./scripts/seo-plugin.mjs";
// @ts-expect-error plain JS plugins next to the TS config
import {
  dvhFallbacks,
  guideFolder,
  legacyOnlyWithoutModules,
  offlineShell,
  packsFolder,
  publicBooks,
  wordLists,
} from "./scripts/vite-plugins.mjs";

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
export default defineConfig(({ mode }) => ({
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
    localIpaData({ mode, root: fileURLToPath(new URL(".", import.meta.url)), directory: process.env.LOCAL_IPA_DATA_DIR }),
    packsFolder(),
    publicBooks(),
    wordLists(),
    guideFolder(),
    // Title, description, keywords, JSON-LD and a plain-HTML introduction for search engines
    // (docs/seo.json), plus dist/sitemap.xml.
    seoPages(),
    viteReact(),
    /**
     * A second, ES5 copy of the app for engines that do not understand `<script type="module">`
     * at all: the Kindle browser (WebKit from 2012) ignores the module script, so the page stayed
     * blank - the app never started and the `<noscript>` line was hidden because JavaScript is on.
     * This build writes `nomodule` chunks plus a small ES5 loader; every modern browser skips
     * them. Keep it before the shell plugins: they hash the finished bundle.
     *
     * `modernTargets` MUST repeat the floor from `build.target` below: without it the plugin
     * replaces `build.target` with its own default (chrome105) and puts optional chaining and
     * `??` back into the modern bundle, which the e-ink WebView cannot parse at all. The plugin
     * prints "plugin-legacy overrode 'build.target'" for that: expected, the two lists match.
     * `legacyOnlyWithoutModules()` then removes the plugin's `import.meta.resolve` probe, which
     * would send every Chrome 69-104 device to the ES5 build as well.
     */
    legacy({
      targets: ["chrome >= 49", "safari >= 10", "ios >= 10", "firefox >= 52", "edge >= 15"],
      modernTargets: ["chrome >= 69", "safari >= 12", "ios >= 12", "firefox >= 62", "edge >= 79"],
      modernPolyfills: false,
      renderLegacyChunks: true,
      polyfills: true,
    }),
    legacyOnlyWithoutModules(),
    offlineShell(),
    dvhFallbacks(),
  ],
}));
