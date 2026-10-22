import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "local-exports/ipa-word-card/default-preview");
const enabled = process.argv.includes("--enabled");
const assets = resolve(dir, "assets");
const names = readdirSync(assets);
const shards = names.filter(name => /^[a-z]-[A-Za-z0-9_-]+\.json$/.test(name));
const html = readFileSync(resolve(dir, "index.html"), "utf8");
assert.match(html, /nomodule/);
assert.match(html, /type="module"/);
if (enabled) {
  assert.ok(shards.length >= 26, "local build has real lazy pronunciation shards");
  const fixture = resolve(dir, "scripts/fixtures/ipa-preview.html");
  assert.ok(statSync(fixture).isFile(), "local-only synthetic proof page is present");
} else {
  assert.equal(shards.length, 0, "ordinary build never packages pronunciation shards");
  assert.ok(!readdirSync(dir).includes("scripts"), "ordinary build excludes synthetic preview page");
}
console.log(JSON.stringify({ directory: dir, localIpaEnabled: enabled, shardChunks: shards.length, modernAndLegacy: true }));
