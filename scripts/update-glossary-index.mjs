#!/usr/bin/env node
/**
 * Kept for old habits. The glossary index is now the pack catalog: packs/catalog.json lists, for every
 * book, the number of words (`words`) and the revision (`rev`, a short hash). Run the pack builder instead:
 *
 *   node scripts/update-glossary-index.mjs         = node scripts/build-packs.mjs
 *   node scripts/update-glossary-index.mjs --check = node scripts/build-packs.mjs --check
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const builder = join(dirname(fileURLToPath(import.meta.url)), "build-packs.mjs");
const run = spawnSync(process.execPath, [builder, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(run.status ?? 1);
