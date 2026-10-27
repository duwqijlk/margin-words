import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import JSZip from "jszip";
import { buildKit, buildSamplePack, KIT_FILES, KIT_NAME, SAMPLE_PACK_NAME } from "./build-kit.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the tracked kit is byte-identical to the deterministic generator", async () => {
  const generated = await buildKit();
  assert.deepEqual(await buildKit(), generated, "repeated kit builds must produce the same bytes");
  assert.deepEqual(
    readFileSync(join(ROOT, KIT_NAME)),
    generated,
    "rebuild the tracked kit after changing its specification or sample sources",
  );
});

test("the kit preserves its four-file layout and unchanged sample source bytes", async () => {
  const kit = await JSZip.loadAsync(readFileSync(join(ROOT, KIT_NAME)));
  assert.deepEqual(Object.keys(kit.files).sort(), [
    "book-pack-spec.md",
    "the-lantern-seller.epub",
    "the-lantern-seller.glossary.json",
    "the-lantern-seller.pack.zip",
  ]);
  for (const { name, from } of KIT_FILES) {
    assert.deepEqual(await kit.file(name).async("nodebuffer"), readFileSync(join(ROOT, from)), name);
  }
  const sampleBytes = await kit.file(SAMPLE_PACK_NAME).async("nodebuffer");
  assert.deepEqual(sampleBytes, await buildSamplePack());
  const sample = await JSZip.loadAsync(sampleBytes);
  assert.deepEqual(Object.keys(sample.files).sort(), ["book.epub", "glossary.json"]);
  assert.deepEqual(
    await sample.file("book.epub").async("nodebuffer"),
    readFileSync(join(ROOT, "examples/sample-book/the-lantern-seller.epub")),
  );
  assert.deepEqual(
    await sample.file("glossary.json").async("nodebuffer"),
    readFileSync(join(ROOT, "examples/sample-book/glossary.json")),
  );
});
