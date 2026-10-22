import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { localIpaData } from "./ipa-data-plugin.mjs";

test("ordinary IPA build is empty and rejects accidental local input", () => {
  const plugin = localIpaData({ mode: "production", root: process.cwd() });
  assert.equal(plugin.load(plugin.resolveId("virtual:local-ipa-data")), "export const version = ''; export const loaders = {};");
  assert.throws(() => localIpaData({ mode: "production", root: process.cwd(), directory: "/data" }), /requires local-ipa/);
  assert.throws(() => localIpaData({ mode: "local-ipa", root: process.cwd() }), /absolute/);
});

test("local IPA build validates hashes, confines inputs and isolates its output", () => {
  const root = mkdtempSync(resolve(tmpdir(), "ipa-plugin-"));
  try {
    const directory = resolve(root, "local-exports", "data"); mkdirSync(directory, { recursive: true });
    const bytes = JSON.stringify({ schemaVersion: 1, version: "test", words: { bath: { UK: [{ ipa: "bɑːθ" }], US: [{ ipa: "bæθ" }] } } });
    writeFileSync(resolve(directory, "b.json"), bytes);
    const manifest = { schemaVersion: 1, version: "test", shards: { b: { file: "b.json", sha256: createHash("sha256").update(bytes).digest("hex") } } };
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
