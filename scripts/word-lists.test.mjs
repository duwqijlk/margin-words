import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWordLists } from "./lib/word-lists.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OLD_NARNIA = [
  "narnia1-magicians-nephew",
  "narnia2-lion-witch-wardrobe",
  "narnia3-horse-and-his-boy",
  "narnia4-prince-caspian",
  "narnia5-dawn-treader",
  "narnia6-silver-chair",
  "narnia7-last-battle",
];

function jpegSize(buf) {
  let i = 2;
  while (i + 8 < buf.length) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  throw new Error("jpeg has no size marker");
}

test("word lists ship glossaries and card-sized covers, never an epub", () => {
  const { catalog, files } = buildWordLists(join(ROOT, "packs"));
  const glossaryDirs = readdirSync(join(ROOT, "packs")).filter((name) => {
    const dir = join(ROOT, "packs", name);
    return statSync(dir).isDirectory() && existsSync(join(dir, "glossary.json"));
  });
  assert.equal(catalog.lists.length, glossaryDirs.length);
  for (const file of files) {
    assert.equal(file.name.endsWith(".epub"), false, file.name);
    assert.equal(file.name.endsWith(".zip"), false, file.name);
    assert.match(file.name, /^word-lists\/(?:catalog\.json|[a-z0-9][a-z0-9_-]*\/(?:glossary\.json|cover\.jpg))$/);
  }
  const charlie = catalog.lists.find((row) => row.id === "charlie");
  assert.equal(charlie.isbn, "9780141960616");
  assert.equal(charlie.glossary.url, "charlie/glossary.json");
  assert.match(charlie.updated, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  const charlieList = JSON.parse(readFileSync(join(ROOT, "packs/charlie/glossary.json"), "utf8"));
  assert.equal(charlie.paragraphs, Array.isArray(charlieList.paragraphs) ? charlieList.paragraphs.length : 0);
  assert.equal(charlie.sentences, Array.isArray(charlieList.sentences) ? charlieList.sentences.length : 0);
  assert.equal(charlie.phrases, charlieList.phrases && typeof charlieList.phrases === "object" ? Object.keys(charlieList.phrases).length : 0);
  assert.equal(charlie.cover.url, "charlie/cover.jpg");
  assert.equal(charlie.epub, undefined);
  const cover = files.find((file) => file.name === "word-lists/charlie/cover.jpg");
  const size = jpegSize(cover.bytes);
  assert.ok(size.width > 40 && size.width <= 400, `${size.width}px`);
  assert.ok(cover.bytes.length < 80 * 1024, cover.bytes.length);
  const narnia = catalog.lists.find((row) => row.id === "narnia");
  assert.equal(narnia.title, "The Chronicles of Narnia (Complete 7-Book Collection)");
  assert.equal(narnia.author, "C. S. Lewis");
  assert.equal(narnia.series, "Narnia");
  assert.equal(narnia.seriesNumber, undefined);
  assert.equal(narnia.isbn, "9780062245762");
  assert.equal(narnia.lexile, undefined);
  assert.equal(narnia.epub, undefined);
  assert.equal(narnia.cover.url, "narnia/cover.jpg");
  const wonder = catalog.lists.find((row) => row.id === "wonder");
  assert.equal(wonder.cover.url, "wonder/cover.jpg");
  for (const id of ["narnia", "wonder"]) {
    const file = files.find((item) => item.name === `word-lists/${id}/cover.jpg`);
    const sized = jpegSize(file.bytes);
    assert.ok(sized.width > 40 && sized.width <= 400, `${id} ${sized.width}px`);
  }
  for (const id of OLD_NARNIA) assert.equal(catalog.lists.some((row) => row.id === id), false, id);
  const list = JSON.parse(readFileSync(join(ROOT, "packs/narnia/glossary.json"), "utf8"));
  assert.equal(list.version, 2);
  assert.equal(list.isbn, "9780062245762");
  assert.equal(list.series, "Narnia");
  assert.equal(list.seriesNumber, undefined);
  assert.equal(list.lexile, undefined);
  assert.equal(list.sha256, undefined);
  assert.equal(list.chapters, undefined);
  assert.ok(list.count > 1000);
  const twits = catalog.lists.find((row) => row.id === "twits");
  assert.equal(twits.isbn, undefined);
});
