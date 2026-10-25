#!/usr/bin/env node
/**
 * Move every catalog cover to covers/<kind>-<id>.jpg on the books host, with a one-year cache.
 *
 *   node scripts/move-covers.mjs             check only: what would be copied, shrunk, and rewritten
 *   node scripts/move-covers.mjs --upload    copy the covers, then rewrite the two catalogs
 *
 * Why: covers under word-lists/ and public-books/ go through the glossary-block Worker (it is bound to
 * those paths), so every cover load was a Worker request on the Free plan's daily allowance, and they
 * were cached for 4 hours. Under covers/ no Worker runs, and `Cache-Control: immutable` lets the browser
 * and the CDN keep a cover for good: its address already carries its version (?v=<sha>), so a replaced
 * cover is a new address.
 *
 * A cover over 200 KB is shrunk to a card-sized JPEG (scripts/resize-cover.py, about 400px wide).
 * Only each row's `cover` field changes, catalog by catalog; every other byte of each row is kept.
 * Old files stay where they are, so a page that still has the old catalog keeps working.
 * Uses the Cloudflare login of this computer (`npx wrangler login`).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "https://books.inputread.site";
const BUCKET = "margin-words-books";
const SHRINK_OVER = 200 * 1024;
const CACHE = "public, max-age=31536000, immutable";
const upload = process.argv.includes("--upload");
const WINDOWS = process.platform === "win32";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const quote = (value) => (WINDOWS ? `"${value}"` : value);

function wrangler(args) {
  return execFileSync("npx", ["wrangler", ...args.map(quote)], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "inherit"],
    shell: WINDOWS,
  });
}

async function getBytes(path, tries = 4) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(`${HOST}/${path}`, { cache: "no-store", headers: { origin: "https://inputread.site" } });
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      // A dropped connection is retried; a missing file (HTTP 404) is not.
      if (attempt >= tries || /HTTP 4\d\d/.test(String(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

function shrink(file) {
  const script = join(ROOT, "scripts", "resize-cover.py");
  for (const python of ["python3", "python"]) {
    const run = spawnSync(python, [script, file], { maxBuffer: 16 * 1024 * 1024 });
    if (run.status === 0 && run.stdout?.length) return new Uint8Array(run.stdout);
  }
  throw new Error(`could not shrink ${file}`);
}

const work = mkdtempSync(join(tmpdir(), "move-covers-"));
try {
  const catalogs = [
    { kind: "lists", key: "word-lists/catalog.json", rows: "lists", base: "word-lists/" },
    { kind: "public", key: "public-books/catalog.json", rows: "packs", base: "public-books/" },
  ];
  const plan = [];
  for (const catalog of catalogs) {
    catalog.bytes = await getBytes(catalog.key);
    catalog.live = JSON.parse(new TextDecoder().decode(catalog.bytes));
    for (const row of catalog.live[catalog.rows] ?? []) {
      const url = row?.cover?.url;
      if (typeof url !== "string" || !url) continue;
      if (url.startsWith(`${HOST}/covers/`)) continue; // already moved
      if (!/^[a-z0-9][a-z0-9_-]{0,63}\/cover[a-z0-9_.-]*\.(jpg|jpeg|png|webp)$/i.test(url)) {
        console.warn(`skip ${row.id}: unexpected cover url ${url}`);
        continue;
      }
      plan.push({ catalog, row, from: `${catalog.base}${url}`, to: `covers/${catalog.kind}-${row.id}.jpg` });
    }
  }

  let shrunk = 0;
  let before = 0;
  let after = 0;
  for (const item of plan) {
    const original = await getBytes(item.from);
    before += original.byteLength;
    let bytes = original;
    if (original.byteLength > SHRINK_OVER) {
      const file = join(work, `${item.catalog.kind}-${item.row.id}.src`);
      writeFileSync(file, original);
      bytes = shrink(file);
      shrunk += 1;
    }
    after += bytes.byteLength;
    item.bytes = bytes;
    item.sha = sha256(bytes);
    item.file = join(work, `${item.catalog.kind}-${item.row.id}.jpg`);
    writeFileSync(item.file, bytes);
  }
  console.log(
    JSON.stringify(
      {
        covers: plan.length,
        shrunk,
        mbBefore: +(before / 1048576).toFixed(1),
        mbAfter: +(after / 1048576).toFixed(1),
        largestKbAfter: Math.round(Math.max(0, ...plan.map((item) => item.bytes.byteLength)) / 1024),
        mode: upload ? "upload" : "check only",
      },
      null,
      1,
    ),
  );
  if (!upload) {
    console.log("Check only. Run again with --upload to copy the covers and rewrite the catalogs.");
    process.exit(0);
  }

  // 1. The new files first: a catalog may only point at a file that is already there.
  for (const item of plan) {
    wrangler(["r2", "object", "put", `${BUCKET}/${item.to}`, "--file", item.file, "--content-type", "image/jpeg", "--cache-control", CACHE, "--remote"]);
  }
  // 2. Each catalog, read again right now, with only `cover` changed on the moved rows.
  for (const catalog of catalogs) {
    const fresh = JSON.parse(new TextDecoder().decode(await getBytes(catalog.key)));
    let changed = 0;
    for (const row of fresh[catalog.rows] ?? []) {
      const item = plan.find((entry) => entry.catalog === catalog && entry.row.id === row.id);
      if (!item) continue;
      // An absolute address: older pages refuse "..", and new URL() keeps an absolute one as it is.
      row.cover = { url: `${HOST}/${item.to}`, bytes: item.bytes.byteLength, sha256: item.sha };
      changed += 1;
    }
    const file = join(work, catalog.key.replace("/", "-"));
    writeFileSync(file, `${JSON.stringify(fresh, null, 1)}\n`);
    wrangler(["r2", "object", "put", `${BUCKET}/${catalog.key}`, "--file", file, "--content-type", "application/json", "--remote"]);
    console.log(`${catalog.key}: ${changed} covers now under covers/`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
