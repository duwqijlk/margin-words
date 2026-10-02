// The packs folder must match its catalog, and every pack must be a valid pack.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HAS_PACKS = existsSync(join(ROOT, "packs/catalog.json")); // the app-only zip has no packs
const catalog = HAS_PACKS ? JSON.parse(readFileSync(join(ROOT, "packs/catalog.json"), "utf8")) : { packs: [] };
const skip = HAS_PACKS ? false : "no packs/ folder (app-only copy)";
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

test("catalog lists 16 packs with the fields readers need", { skip }, () => {
  assert.equal(catalog.format, 1);
  assert.equal(catalog.packs.length, 16);
  for (const pack of catalog.packs) {
    for (const key of ["id", "title", "author", "rev", "epub", "glossary", "zip"]) {
      assert.ok(pack[key], `${pack.id}: missing ${key}`);
    }
  }
});

test("catalog sizes and sha256 match the files", { skip }, () => {
  for (const pack of catalog.packs) {
    for (const key of ["epub", "glossary", "zip"]) {
      const file = join(ROOT, "packs", pack[key].url);
      assert.ok(existsSync(file), `${file} is missing`);
      assert.equal(sha(file), pack[key].sha256, `${pack.id}.${key} sha256`);
      assert.equal(readFileSync(file).length, pack[key].bytes, `${pack.id}.${key} bytes`);
    }
  }
});

test("build-packs --check says the packs folder is up to date", { skip }, () => {
  const run = spawnSync("node", ["scripts/build-packs.mjs", "--check"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
