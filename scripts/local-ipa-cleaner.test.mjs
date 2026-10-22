import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cleaner = fileURLToPath(new URL("./build-local-ipa.py", import.meta.url));
const python = process.env.PYTHON || "python";

test("local IPA cleaner synthetic cases run isolated, with no source downloads", () => {
  const result = spawnSync(python, ["-I", cleaner, "--self-test"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /SELF TEST OK/);
});

test("local IPA cleaner requires isolated Python and absolute source/output arguments", () => {
  const nonIsolated = spawnSync(python, [cleaner, "--self-test"], { encoding: "utf8" });
  assert.notEqual(nonIsolated.status, 0);
  assert.match(nonIsolated.stderr, /python -I/);
  const relative = spawnSync(python, ["-I", cleaner, "--source-root", "relative", "--out", "relative-out"], { encoding: "utf8" });
  assert.notEqual(relative.status, 0);
  assert.match(relative.stderr, /must be absolute/);
});

test("cleaner uses pinned sources and never executes or extracts archive code", () => {
  const source = readFileSync(cleaner, "utf8");
  for (const pin of [
    "86a66f3dc74b724c89b333e281f2346b599bd41e174f3144e4f2f88212674b2e",
    "29183117768c8c5bbdd13545c4482f62aa7980852ae6848a27a95d68b1ab3d60",
    "ebfcfe6450e21784b5be8b195dde5e79ff01ac13832ef0bd17e2b6b498e19e6e",
  ]) assert.ok(source.includes(pin));
  assert.doesNotMatch(source, /\.extract(?:all)?\s*\(|\b(?:exec|eval)\s*\(|\bsubprocess\b/);
});
