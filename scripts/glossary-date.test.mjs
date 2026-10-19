import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { committedOn, normalizeCommitDate } from "./lib/glossary-date.mjs";

test("commit dates keep numeric offsets and canonicalize UTC", () => {
  assert.equal(normalizeCommitDate("2026-10-05T03:05:33Z"), "2026-10-05T03:05:33+00:00");
  for (const offset of ["+00:00", "+08:00", "-05:30"]) {
    const date = `2026-10-05T03:05:33${offset}`;
    assert.equal(normalizeCommitDate(`  ${date}\n`), date);
  }
  for (const value of ["", "not a date", "2026-10-05", "2026-10-05T03:05:33", "2026-10-05T03:05:33Zjunk"]) {
    assert.equal(normalizeCommitDate(value), "");
  }
});

test("missing files and files without repository history have no commit date", () => {
  const dir = mkdtempSync(join(tmpdir(), "margin-date-"));
  try {
    assert.equal(committedOn(join(dir, "missing.json")), "");
    const file = join(dir, "untracked.json");
    writeFileSync(file, "{}");
    assert.equal(committedOn(file), "");
    assert.equal(committedOn(file), "", "empty results are cached too");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
