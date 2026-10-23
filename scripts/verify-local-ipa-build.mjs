import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "dist");
const preview = process.argv.includes("--preview");
const assets = resolve(dir, "assets");
const names = readdirSync(assets);
const json = names.filter(name => /^[a-z]-[A-Za-z0-9_-]+\.json$/.test(name));
const html = readFileSync(resolve(dir, "index.html"), "utf8");
const sourceDir = resolve(process.cwd(), preview ? "local-exports/ipa-word-card/data" : "src/data/ipa");
const manifest = JSON.parse(readFileSync(resolve(sourceDir, "manifest.json"), "utf8"));
const expected = Object.values(manifest.shards).map(shard => shard.sha256);
assert.equal(Object.keys(manifest.shards).sort().join(""), "abcdefghijklmnopqrstuvwxyz", "manifest must contain exactly a-z shards");
assert.equal(new Set(expected).size, 26, "manifest must contain 26 unique shard hashes");
assert.equal(json.length, 26, "build must emit exactly 26 IPA shards");
assert.match(html, /nomodule/);
assert.match(html, /type="module"/);
assert.equal(readdirSync(dir).includes("scripts"), preview, "synthetic preview entry is local-only");
for (const [letter, descriptor] of Object.entries(manifest.shards)) {
  const source = readFileSync(resolve(sourceDir, descriptor.file));
  const emitted = names.find(name => name.startsWith(`${letter}-`) && name.endsWith(".json"));
  assert.ok(emitted, `missing emitted ${letter} shard`);
  const emittedBytes = readFileSync(resolve(assets, emitted));
  assert.equal(createHash("sha256").update(emittedBytes).digest("hex"), descriptor.sha256, `${letter} emitted shard matches source`);
  assert.equal(emittedBytes.equals(source), true, `${letter} emitted shard preserves source bytes`);
}
assert.ok(!names.some(name => /provenance|audit|downloads/i.test(name)
  || (/preview/i.test(name) && !(preview && /^ipaPreview(?:-legacy)?-[A-Za-z0-9_-]+\.js$/.test(name)))), "research files entered build output");
console.log(JSON.stringify({ directory: dir, localIpaEnabled: true, shardChunks: json.length, syntheticPreview: preview, modernAndLegacy: true }));
