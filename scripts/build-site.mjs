#!/usr/bin/env node
/**
 * Optional: put the book packs next to the built reader, so ONE folder can be hosted
 * (for example on Vercel, or a folder opened with any static server).
 *
 *   npx vite build && node scripts/build-site.mjs        writes ./site = dist/ + packs/
 *   node scripts/build-site.mjs --no-zips                leave out the .zip files (smaller)
 *
 * The reader (dist/) never contains books by itself. This script only copies.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(ROOT, "dist");
const packs = join(ROOT, "packs");
const site = join(ROOT, "site");
if (!existsSync(join(dist, "index.html"))) {
  console.error("build-site: dist/ is missing. Run `npx vite build` first.");
  process.exit(1);
}
if (!existsSync(join(packs, "catalog.json"))) {
  console.error("build-site: packs/catalog.json is missing. Run `node scripts/build-packs.mjs` first.");
  process.exit(1);
}
rmSync(site, { recursive: true, force: true });
mkdirSync(site, { recursive: true });
cpSync(dist, site, { recursive: true });
const noZips = process.argv.includes("--no-zips");
cpSync(packs, join(site, "packs"), {
  recursive: true,
  filter: (src) => !(noZips && src.endsWith(".zip")),
});
console.log(`Wrote ${site}: the reader plus packs/${noZips ? " (without zip files)" : ""}.`);
