import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const licenseId = "PolyForm-Noncommercial-1.0.0";

test("root license preserves the complete standard PolyForm terms and copyright notice", () => {
  const license = read("LICENSE");
  const notice = "Required Notice: Copyright (c) 2026 XCRUN";
  assert.ok(license.trimEnd().endsWith(notice));
  const terms = license.slice(0, license.lastIndexOf(notice)).replace(/\s+/g, " ").trim();
  // Official PolyForm 1.0.0 and SPDX license-list-data texts agree after whitespace normalization.
  assert.equal(createHash("sha256").update(terms).digest("hex"),
    "5a8c01b594ed382352228ff35852cfd03575600027949beceff63c6c10dd3677");
});

test("root package metadata and both README badges use the noncommercial license", () => {
  assert.equal(JSON.parse(read("package.json")).license, licenseId);
  assert.equal(JSON.parse(read("package-lock.json")).packages[""].license, licenseId);
  for (const path of ["README.md", "README.zh-CN.md"]) {
    const text = read(path);
    assert.ok(text.includes("license-PolyForm_Noncommercial_1.0.0-blue.svg"));
    assert.ok(!text.includes("[MIT License](LICENSE)"));
    assert.ok(text.includes("Required Notice: Copyright (c) 2026 XCRUN"));
  }
});

test("third-party MIT attribution and the CC0 example remain separately licensed", () => {
  for (const path of ["README.md", "README.zh-CN.md"]) {
    const text = read(path);
    assert.ok(text.includes("https://github.com/bitbw/english-read/blob/main/LICENSE"));
    assert.ok(text.includes("https://creativecommons.org/publicdomain/zero/1.0/"));
  }
  assert.match(read("public/sponsor/NOTICE.txt"), /web3icons, MIT License/);
});
