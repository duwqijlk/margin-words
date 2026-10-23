import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { localIpaData } from "./ipa-data-plugin.mjs";

const letters = "abcdefghijklmnopqrstuvwxyz";
const shard = (letter, version = "test") => JSON.stringify({
  schemaVersion: 1,
  version,
  words: { [`${letter}bath`]: { UK: [{ ipa: "bɑːθ" }], US: [{ ipa: "bæθ" }] } },
});
function writeRuntime(root, missing = "") {
  const directory = resolve(root, "src", "data", "ipa");
  mkdirSync(directory, { recursive: true });
  const shards = {};
  for (const letter of letters) {
    if (letter === missing) continue;
    const bytes = shard(letter);
    writeFileSync(resolve(directory, `${letter}.json`), bytes);
    shards[letter] = { file: `${letter}.json`, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  writeFileSync(resolve(directory, "manifest.json"), JSON.stringify({ schemaVersion: 1, version: "test", shards }));
  return directory;
}

test("ordinary builds load the complete tracked runtime snapshot", () => {
  const plugin = localIpaData({ mode: "production", root: process.cwd() });
  const code = plugin.load(plugin.resolveId("virtual:local-ipa-data"));
  assert.match(code, /export const version = "local-ipa-primary/);
  assert.equal((code.match(/import url_[a-z] from/g) ?? []).length, 26);
  assert.equal(plugin.config(), undefined, "production keeps the ordinary dist output");
  assert.throws(() => localIpaData({ mode: "production", root: process.cwd(), directory: "/data" }), /requires local-ipa/);
});

test("ordinary builds fail closed for missing or incomplete tracked data", () => {
  const root = mkdtempSync(resolve(tmpdir(), "ipa-plugin-production-"));
  try {
    writeRuntime(root, "z");
    assert.throws(() => localIpaData({ mode: "production", root }), /exactly a-z shards/);
    writeRuntime(root);
    const directory = resolve(root, "src", "data", "ipa");
    writeFileSync(resolve(directory, "a.json"), "corrupted");
    assert.throws(() => localIpaData({ mode: "production", root }), /hash mismatch/);
    writeRuntime(root);
    const malformed = JSON.parse(readFileSync(resolve(directory, "a.json"), "utf8"));
    malformed.words.abath.UK.push({ ipa: "second" });
    const bytes = JSON.stringify(malformed);
    writeFileSync(resolve(directory, "a.json"), bytes);
    const manifest = JSON.parse(readFileSync(resolve(directory, "manifest.json"), "utf8"));
    manifest.shards.a.sha256 = createHash("sha256").update(bytes).digest("hex");
    writeFileSync(resolve(directory, "manifest.json"), JSON.stringify(manifest));
    assert.throws(() => localIpaData({ mode: "production", root }), /at most one reading/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("local IPA preview validates hashes, confines inputs and isolates its output", () => {
  const root = mkdtempSync(resolve(tmpdir(), "ipa-plugin-preview-"));
  try {
    const directory = resolve(root, "local-exports", "data"); mkdirSync(directory, { recursive: true });
    const shards = {};
    for (const letter of letters) {
      const word = letter === "b" ? "bath" : `${letter}word`;
      const value = { schemaVersion: 1, version: "test", words: { [word]: { UK: [{ ipa: "bɑːθ" }], US: [{ ipa: "bæθ" }] } } };
      const bytes = JSON.stringify(value);
      writeFileSync(resolve(directory, `${letter}.json`), bytes);
      shards[letter] = { file: `${letter}.json`, sha256: createHash("sha256").update(bytes).digest("hex") };
    }
    const manifest = { schemaVersion: 1, version: "test", shards };
    writeFileSync(resolve(directory, "manifest.json"), JSON.stringify(manifest));
    const plugin = localIpaData({ mode: "local-ipa", root, directory });
    const code = plugin.load(plugin.resolveId("virtual:local-ipa-data"));
    assert.match(code, /import url_b from/); assert.match(code, /b\.json\?url&no-inline/);
    assert.match(code, /fetch\(url_b\)/); assert.match(code, /response\.ok/);
    assert.doesNotMatch(code, /import\(/, "optional data failure must not trigger code-chunk reload recovery");
    const outDir = plugin.config().build.outDir;
    assert.equal(outDir, resolve(root, "local-exports/ipa-word-card/preview"));
    const network = { server: { host: "127.0.0.1" }, preview: { host: "127.0.0.1" } };
    plugin.configResolved({ build: { outDir }, ...network });
    assert.throws(() => plugin.configResolved({ build: { outDir: resolve(root, "dist") }, ...network }), /isolated/);
    assert.throws(() => plugin.configResolved({ build: { outDir }, ...network, server: { host: "0.0.0.0" } }), /loopback/);
    writeFileSync(resolve(directory, "b.json"), "corrupted");
    assert.throws(() => localIpaData({ mode: "local-ipa", root, directory }), /hash/);
    assert.throws(() => localIpaData({ mode: "local-ipa", root, directory: root }), /inside local-exports/);
    const unsafe = resolve(root, "local-exports/ipa-word-card/preview/data");
    mkdirSync(unsafe, { recursive: true });
    assert.throws(() => localIpaData({ mode: "local-ipa", root, directory: unsafe }), /inside the build output/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
