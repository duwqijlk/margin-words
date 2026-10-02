// The rules of a book pack (docs/book-pack-spec.md, section 3): which files, and does the list belong to the book.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModules } from "./lib/app-modules.mjs";

const { packCheck } = await loadAppModules();
const { findPacks, matchGlossary, PackProblem } = packCheck;

const code = (fn) => {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof PackProblem, String(error));
    return error.code;
  }
  return "ok";
};

test("a pack is exactly book.epub + glossary.json", () => {
  const [pack] = findPacks(["book.epub", "glossary.json"]);
  assert.equal(pack.epub, "book.epub");
  assert.equal(pack.list, "glossary.json");
});

test("kit naming <name>.epub + <name>.glossary.json works; cover and pack.json are picked up", () => {
  const [pack] = findPacks([
    "the-lantern-seller.epub",
    "the-lantern-seller.glossary.json",
    "cover.png",
    "pack.json",
  ]);
  assert.equal(pack.list, "the-lantern-seller.glossary.json");
  assert.equal(pack.cover, "cover.png");
  assert.equal(pack.info, "pack.json");
});

test("one wrapping folder and several folders", () => {
  assert.equal(findPacks(["x/book.epub", "x/glossary.json"]).length, 1);
  assert.equal(
    findPacks([
      "a/book.epub",
      "a/glossary.json",
      "b/book.epub",
      "b/glossary.json",
      "__MACOSX/a/._book.epub",
    ]).length,
    2,
  );
});

test("missing or doubled files are refused", () => {
  assert.equal(
    code(() => findPacks([])),
    "empty",
  );
  assert.equal(
    code(() => findPacks(["readme.txt"])),
    "empty",
  );
  assert.equal(
    code(() => findPacks(["book.epub"])),
    "noList",
  );
  assert.equal(
    code(() => findPacks(["glossary.json"])),
    "noEpub",
  );
  assert.equal(
    code(() => findPacks(["a.epub", "b.epub", "glossary.json"])),
    "manyEpub",
  );
  assert.equal(
    code(() => findPacks(["book.epub", "glossary.json", "x.glossary.json"])),
    "manyList",
  );
  // info.json / catalog.json are not word lists
  assert.equal(
    code(() => findPacks(["book.epub", "info.json", "catalog.json"])),
    "noList",
  );
});

const book = { title: "The Lantern Seller", author: "A. Sample Writer", sha256: "a".repeat(64) };

test("the list must belong to the book: sha256, or title (+ author)", () => {
  assert.equal(
    code(() => matchGlossary({ sha256: "a".repeat(64) }, book)),
    "ok",
  );
  assert.equal(
    code(() => matchGlossary({ sha256: "b".repeat(64), title: "the lantern seller!" }, book)),
    "ok",
  );
  assert.equal(
    code(() => matchGlossary({ title: "The Lantern Seller", author: "a sample writer" }, book)),
    "ok",
  );
  assert.equal(
    code(() => matchGlossary({ title: "The Lantern Seller" }, book)),
    "ok",
  );
  assert.equal(
    code(() => matchGlossary({ title: "Matilda", author: "Roald Dahl" }, book)),
    "mismatch",
  );
  assert.equal(
    code(() => matchGlossary({ title: "The Lantern Seller", author: "Someone Else" }, book)),
    "mismatch",
  );
  assert.equal(
    code(() => matchGlossary({}, book)),
    "noId",
  );
  assert.equal(
    code(() => matchGlossary({ sha256: "b".repeat(64) }, book)),
    "shaMismatch",
  );
});

test("every problem code has a message in both languages", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/lib/pack-check.ts", import.meta.url), "utf8");
  const codes = /type PackProblemCode =([^;]+);/
    .exec(src)[1]
    .match(/"(\w+)"/g)
    .map((c) => c.slice(1, -1));
  for (const lang of ["en", "zh"]) {
    const dict = readFileSync(new URL(`../src/lib/i18n-${lang}.ts`, import.meta.url), "utf8");
    for (const c of codes) assert.ok(dict.includes(`"err.pack.${c}"`), `${lang}: err.pack.${c}`);
  }
});

test("every pack of the catalog passes the rules", async (t) => {
  const { existsSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = new URL("..", import.meta.url).pathname;
  if (!existsSync(join(root, "packs/catalog.json"))) return t.skip("no packs/ folder");
  const JSZip = (await import("jszip")).default;
  const { readBook } = await import("./lib/app-modules.mjs");
  const { createHash } = await import("node:crypto");
  const { format } = await loadAppModules();
  const catalog = JSON.parse(readFileSync(join(root, "packs/catalog.json"), "utf8"));
  for (const entry of catalog.packs) {
    const zip = await JSZip.loadAsync(readFileSync(join(root, "packs", entry.zip.url)));
    const [pack] = findPacks(Object.keys(zip.files));
    const epub = await zip.file(pack.epub).async("nodebuffer");
    const check = format.validateGlossary(await zip.file(pack.list).async("string"));
    assert.ok(check.ok, `${entry.id}: ${check.errors.slice(0, 1)}`);
    const parsed = await readBook(join(root, "packs", entry.epub.url));
    matchGlossary(check.file, {
      title: parsed.title,
      author: parsed.author,
      sha256: createHash("sha256").update(epub).digest("hex"),
    });
  }
});
