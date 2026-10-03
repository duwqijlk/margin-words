/**
 * Spine continuations, drop caps, and accented words.
 * Chapter and paragraph text for books whose contents list already matches the spine
 * must stay byte-for-byte the same (the hashes below were taken before these fixes).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAppModules, readBook } from "./lib/app-modules.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));
const JSZip = require("jszip");
const { epub, format, help, flow } = await loadAppModules();

const LONG = "This sentence is long enough to stand alone as its own paragraph in the reader.";

function page(title, body, ids = {}) {
  const htmlId = ids.htmlId ? ` id="${ids.htmlId}"` : "";
  const bodyId = ids.bodyId ? ` id="${ids.bodyId}"` : "";
  const bodyClass = ids.bodyClass ? ` class="${ids.bodyClass}"` : "";
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"${htmlId}><head><title>${title}</title></head><body${bodyId}${bodyClass}>
${body}
</body></html>`;
}

/**
 * @param {{ title: string, files: Record<string, string>, spine: { id: string, href: string, linear?: "yes" | "no" }[], toc: { title: string, href: string }[], ncx?: { title: string, href: string }[] | null, encryption?: string }} spec
 * ncx: omitted means no NCX. null means an empty navMap. An array is the nav points.
 * toc is the EPUB 3 nav. Pass [] to omit the nav document.
 * encryption: optional META-INF/encryption.xml text.
 */
async function buildEpub(spec) {
  const date = new Date("2026-01-01T00:00:00Z");
  const zip = new JSZip();
  const add = (name, data) => zip.file(name, data, { date, createFolders: false, compression: "DEFLATE" });
  add("mimetype", "application/epub+zip");
  add(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  );
  const manifest = [];
  if (spec.toc.length > 0) {
    manifest.push(`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`);
  }
  if (spec.ncx !== undefined) {
    manifest.push(`<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`);
  }
  for (const item of spec.spine) {
    manifest.push(`<item id="${item.id}" href="${item.href}" media-type="application/xhtml+xml"/>`);
  }
  const spine = spec.spine
    .map((item) => `<itemref idref="${item.id}"${item.linear === "no" ? ' linear="no"' : ""}/>`)
    .join("");
  add(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:extract-test</dc:identifier>
    <dc:title>${spec.title}</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    ${manifest.join("\n")}
  </manifest>
  <spine>${spine}</spine>
</package>`,
  );
  if (spec.toc.length > 0) {
    const items = spec.toc.map((item) => `<li><a href="${item.href}">${item.title}</a></li>`).join("");
    add(
      "OEBPS/nav.xhtml",
      `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><ol>${items}</ol></nav></body></html>`,
    );
  }
  if (spec.ncx !== undefined) {
    const point = (item, index) => {
      const id = item.id ?? `n${index}`;
      const order = item.playOrder ? ` playOrder="${item.playOrder}"` : "";
      const children = (item.children ?? []).map((child, at) => point(child, `${index}-${at}`)).join("");
      return `<navPoint id="${id}"${order}><navLabel><text>${item.title}</text></navLabel><content src="${item.href}"/>${children}</navPoint>`;
    };
    const points = (spec.ncx ?? []).map((item, index) => point(item, index)).join("");
    const depth = spec.ncxDepth
      ? `<head><meta name="dtb:uid" content="urn:uuid:extract-test"/><meta name="dtb:depth" content="${spec.ncxDepth}"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>`
      : "";
    add(
      "OEBPS/toc.ncx",
      `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">${depth}<navMap>${points}</navMap></ncx>`,
    );
  }
  if (spec.encryption) add("META-INF/encryption.xml", spec.encryption);
  for (const [href, body] of Object.entries(spec.files)) {
    if (typeof body === "string") add(`OEBPS/${href}`, page(href, body));
    else add(`OEBPS/${href}`, page(href, body.html, body));
  }
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  if (spec.writeTo) writeFileSync(spec.writeTo, bytes);
  return epub.parseEpub(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
    cover: false,
    ...(spec.segmentation === 2 ? { segmentation: 2 } : {}),
  });
}

function paragraphs(book) {
  return book.chapters.map((chapter) => chapter.paragraphs);
}

function encryptionXml(entries) {
  const rows = entries
    .map(
      (entry) => `<enc:EncryptedData><enc:EncryptionMethod Algorithm="${entry.algorithm}"/><enc:CipherData><enc:CipherReference URI="${entry.uri}"/></enc:CipherData></enc:EncryptedData>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">${rows}</encryption>`;
}

const TWO_CHAPTERS = {
  title: "Font Book",
  toc: [
    { title: "One", href: "c01.xhtml" },
    { title: "Two", href: "c02.xhtml" },
  ],
  spine: [
    { id: "c01", href: "c01.xhtml" },
    { id: "c02", href: "c02.xhtml" },
  ],
  files: {
    "c01.xhtml": `<h1>One</h1><p>The first chapter is readable even when a font file is mangled. ${LONG}</p>`,
    "c02.xhtml": `<h1>Two</h1><p>The second chapter is readable too. ${LONG}</p>`,
  },
};

test("an obfuscated font is not treated as a lock", async () => {
  const opened = await buildEpub({
    ...TWO_CHAPTERS,
    encryption: encryptionXml([
      { algorithm: "http://www.idpf.org/2008/embedding", uri: "OEBPS/Fonts/CharisSIL-R.ttf" },
      { algorithm: "http://ns.adobe.com/pdf/enc#RC", uri: "OEBPS/Fonts/MinionPro.otf" },
    ]),
  });
  assert.deepEqual(
    opened.chapters.map((chapter) => chapter.title),
    ["One", "Two"],
  );
  await assert.rejects(
    () =>
      buildEpub({
        ...TWO_CHAPTERS,
        encryption: encryptionXml([
          { algorithm: "http://www.idpf.org/2008/embedding", uri: "OEBPS/Fonts/CharisSIL-R.ttf" },
          { algorithm: "http://www.idpf.org/2008/embedding", uri: "OEBPS/chapter.xhtml" },
        ]),
      }),
    (error) => error.code === "drm",
  );
  await assert.rejects(
    () =>
      buildEpub({
        ...TWO_CHAPTERS,
        encryption: encryptionXml([
          { algorithm: "http://www.w3.org/2001/04/xmlenc#aes128-cbc", uri: "OEBPS/Fonts/MinionPro.otf" },
        ]),
      }),
    (error) => error.code === "drm",
  );
  await assert.rejects(
    () =>
      buildEpub({
        ...TWO_CHAPTERS,
        encryption: encryptionXml([
          { algorithm: "http://ns.adobe.com/pdf/enc#RC", uri: "OEBPS/images/cover.jpg" },
        ]),
      }),
    (error) => error.code === "drm",
  );
});

test("listed split_000 keeps unlisted split_001 and split_002 at the end", async () => {
  const book = await buildEpub({
    title: "Split Story",
    toc: [
      { title: "Chapter One", href: "story_c01_r1_split_000.xhtml" },
      { title: "Chapter Two", href: "c02.xhtml" },
      { title: "Chapter Three", href: "story_c03_r1_split_000.xhtml" },
      { title: "Back Matter", href: "bm1.xhtml" },
      { title: "Scene One", href: "scene.xhtml" },
      { title: "Scene Two", href: "scene.xhtml#scene-b" },
    ],
    spine: [
      { id: "c01", href: "story_c01_r1_split_000.xhtml" },
      { id: "skip", href: "blank.xhtml", linear: "no" },
      { id: "s1", href: "story_c01_r1_split_001.xhtml" },
      { id: "s2", href: "story_c01_r1_split_002.xhtml" },
      { id: "ad", href: "index_split_004.xhtml" },
      { id: "preview", href: "c12.xhtml" },
      { id: "c02", href: "c02.xhtml" },
      { id: "c02s", href: "c02_split_001.xhtml" },
      { id: "c03", href: "story_c03_r1_split_000.xhtml" },
      { id: "c03s1", href: "story_c03_r1_split_001.xhtml" },
      { id: "c03s2", href: "story_c03_r1_split_002.xhtml" },
      { id: "bm", href: "bm1.xhtml" },
      { id: "bms", href: "bm1_split_001.xhtml" },
      { id: "sc", href: "scene.xhtml" },
      { id: "scs", href: "scene_split_001.xhtml" },
    ],
    files: {
      "story_c01_r1_split_000.xhtml": `<h1>Chapter One</h1><p>Alpha paragraph stays first in this chapter of the long story. ${LONG}</p>`,
      "blank.xhtml": `<p>A non linear page that must not stop the following split. ${LONG}</p>`,
      "story_c01_r1_split_001.xhtml": `<p>Beta paragraph continues chapter one after the first split file. ${LONG}</p>`,
      "story_c01_r1_split_002.xhtml": `<p>Gamma paragraph is still chapter one and keeps the next index. ${LONG}</p>`,
      "index_split_004.xhtml": `<p>Advertisement for a different book that must stay out of chapter one. ${LONG}</p>`,
      "c12.xhtml": `<p>Preview chapter of the next book that must not become part of this one. ${LONG}</p>`,
      "c02.xhtml": `<h1>Chapter Two</h1><p>The second chapter starts here and must not include the advertisement. ${LONG}</p>`,
      "c02_split_001.xhtml": `<p>The plain filename continues in its matching split file today. ${LONG}</p>`,
      "story_c03_r1_split_000.xhtml": `<h1>Chapter Three</h1><p>The third chapter uses a revised filename and still starts cleanly. ${LONG}</p>`,
      "story_c03_r1_split_001.xhtml": `<p>The revised chapter continues in the first unlisted split file. ${LONG}</p>`,
      "story_c03_r1_split_002.xhtml": `<p>The revised chapter also keeps the second unlisted split file. ${LONG}</p>`,
      "bm1.xhtml": `<h1>Back Matter</h1><p>The back matter opens with this paragraph about the author life. ${LONG}</p>`,
      "bm1_split_001.xhtml": `<p>The back matter continues in its own split file after the first page. ${LONG}</p>`,
      "scene.xhtml": `<h1 id="scene-a">Scene One</h1><p>The first scene of this file stays its own chapter in the book. ${LONG}</p><h2 id="scene-b">Scene Two</h2><p>The second scene starts at this anchor and stays its own chapter. ${LONG}</p>`,
      "scene_split_001.xhtml": `<p>Two contents entries share this prefix so the split stays out. ${LONG}</p>`,
    },
  });
  const text = paragraphs(book);
  assert.equal(book.chapters.length, 6);
  assert.deepEqual(text[0], [
    "Chapter One",
    `Alpha paragraph stays first in this chapter of the long story. ${LONG}`,
    `Beta paragraph continues chapter one after the first split file. ${LONG}`,
    `Gamma paragraph is still chapter one and keeps the next index. ${LONG}`,
  ]);
  assert.deepEqual(text[1], [
    "Chapter Two",
    `The second chapter starts here and must not include the advertisement. ${LONG}`,
    `The plain filename continues in its matching split file today. ${LONG}`,
  ]);
  assert.deepEqual(text[2], [
    "Chapter Three",
    `The third chapter uses a revised filename and still starts cleanly. ${LONG}`,
    `The revised chapter continues in the first unlisted split file. ${LONG}`,
    `The revised chapter also keeps the second unlisted split file. ${LONG}`,
  ]);
  assert.deepEqual(text[3].slice(0, 2), [
    "Back Matter",
    `The back matter opens with this paragraph about the author life. ${LONG}`,
  ]);
  assert.equal(text[3][2].startsWith("The back matter continues"), true);
  assert.deepEqual(text[4], [
    "Scene One",
    `The first scene of this file stays its own chapter in the book. ${LONG}`,
  ]);
  assert.deepEqual(text[5], [
    "Scene Two",
    `The second scene starts at this anchor and stays its own chapter. ${LONG}`,
  ]);
  const joined = text.flat().join("\n");
  assert.equal(joined.includes("Advertisement"), false);
  assert.equal(joined.includes("Preview chapter"), false);
  assert.equal(joined.includes("non linear"), false);
  assert.equal(joined.includes("share this prefix"), false);
  const extraText = book.extras.map((item) => item.paragraphs.join("\n")).join("\n");
  assert.match(extraText, /Advertisement/);
  assert.match(extraText, /Preview chapter/);
  assert.match(extraText, /non linear/);
  assert.match(extraText, /share this prefix/);
  assert.deepEqual(
    book.extras.map((item) => item.id),
    ["x0", "x1", "x2", "x3"],
  );
});

test("a dropped heading does not gain a chapter from its split body", async () => {
  const book = await buildEpub({
    title: "Dropped Heading",
    toc: [
      { title: "Chapter One", href: "c01.xhtml" },
      { title: "Prologue", href: "prologue_split_000.xhtml" },
      { title: "Chapter Two", href: "c02.xhtml" },
    ],
    spine: [
      { id: "c01", href: "c01.xhtml" },
      { id: "pro", href: "prologue_split_000.xhtml" },
      { id: "prob", href: "prologue_split_001.xhtml" },
      { id: "c02", href: "c02.xhtml" },
    ],
    files: {
      "c01.xhtml": `<h1>Chapter One</h1><p>The first real chapter stays chapter zero. ${LONG}</p>`,
      "prologue_split_000.xhtml": `<h1>Prologue</h1>`,
      "prologue_split_001.xhtml": `<p>The prologue body must not become a chapter or move the next one. ${LONG}</p>`,
      "c02.xhtml": `<h1>Chapter Two</h1><p>The second real chapter stays chapter one. ${LONG}</p>`,
    },
  });
  assert.deepEqual(
    book.chapters.map((chapter) => chapter.title),
    ["Chapter One", "Chapter Two"],
  );
  assert.deepEqual(book.chapters[0].paragraphs, [
    "Chapter One",
    `The first real chapter stays chapter zero. ${LONG}`,
  ]);
  assert.deepEqual(book.chapters[1].paragraphs, [
    "Chapter Two",
    `The second real chapter stays chapter one. ${LONG}`,
  ]);
  const joined = paragraphs(book).flat().join("\n");
  assert.equal(joined.includes("Prologue"), false);
  assert.equal(joined.includes("prologue body"), false);
  assert.equal(book.extras.length, 1);
  assert.match(book.extras[0].paragraphs.join(" "), /prologue body/);
  assert.equal(book.extras[0].id, "x0");
  assert.equal(book.extras[0].fromToc, undefined);
  assert.notEqual(book.extras[0].title, "Prologue");
});

test("an empty contents file is an extra and does not renumber later chapters", async () => {
  const book = await buildEpub({
    title: "Empty Contents File",
    toc: [
      { title: "Chapter One", href: "c01.xhtml" },
      { title: "Chapter Three", href: "c03.xhtml" },
      { title: "Chapter Four", href: "c04.xhtml" },
      { title: "Chapter Seven", href: "c07.xhtml" },
      { title: "Chapter Eight", href: "c08.xhtml" },
    ],
    spine: [
      { id: "ad", href: "ad.xhtml" },
      { id: "c01", href: "c01.xhtml" },
      { id: "c03", href: "c03.xhtml" },
      { id: "c03b", href: "c03-body.xhtml" },
      { id: "c04", href: "c04.xhtml" },
      { id: "c07", href: "c07.xhtml" },
      { id: "c07a", href: "c07-a.xhtml" },
      { id: "note", href: "note.xhtml", linear: "no" },
      { id: "c07b", href: "c07-b.xhtml" },
      { id: "c08", href: "c08.xhtml" },
    ],
    files: {
      "ad.xhtml": `<p>An advertisement sits before the story and stays its own extra. ${LONG}</p>`,
      "c01.xhtml": `<h1>Chapter One</h1><p>The first real chapter stays chapter zero. ${LONG}</p>`,
      "c03.xhtml": "",
      "c03-body.xhtml": `<p>Lucy looked into the wardrobe and found a lamp post. ${LONG}</p>`,
      "c04.xhtml": `<h1>Chapter Four</h1><p>The fourth chapter stays the next numbered chapter. ${LONG}</p>`,
      "c07.xhtml": "<p></p>",
      "c07-a.xhtml": `<p>The first half of chapter seven is in this file. ${LONG}</p>`,
      "c07-b.xhtml": `<p>The second half of chapter seven follows it at once. ${LONG}</p>`,
      "note.xhtml": `<p>A non linear note must not be pulled into chapter seven. ${LONG}</p>`,
      "c08.xhtml": `<h1>Chapter Eight</h1><p>The eighth chapter stays the last numbered chapter. ${LONG}</p>`,
    },
  });
  assert.deepEqual(
    book.chapters.map((chapter) => chapter.title),
    ["Chapter One", "Chapter Four", "Chapter Eight"],
  );
  assert.deepEqual(book.chapters[0].paragraphs, [
    "Chapter One",
    `The first real chapter stays chapter zero. ${LONG}`,
  ]);
  assert.deepEqual(book.chapters[1].paragraphs, [
    "Chapter Four",
    `The fourth chapter stays the next numbered chapter. ${LONG}`,
  ]);
  assert.deepEqual(book.chapters[2].paragraphs, [
    "Chapter Eight",
    `The eighth chapter stays the last numbered chapter. ${LONG}`,
  ]);
  const numbered = paragraphs(book).flat().join("\n");
  assert.equal(numbered.includes("wardrobe"), false);
  assert.equal(numbered.includes("chapter seven"), false);
  assert.deepEqual(
    book.extras.map((item) => item.id),
    ["x0", "x1", "x2", "x3"],
  );
  assert.equal(book.extras[0].fromToc, undefined);
  assert.match(book.extras[0].paragraphs.join(" "), /advertisement/i);
  assert.equal(book.extras[1].fromToc, true);
  assert.equal(book.extras[1].title, "Chapter Three");
  assert.deepEqual(book.extras[1].paragraphs, [
    `Lucy looked into the wardrobe and found a lamp post. ${LONG}`,
  ]);
  assert.equal(book.extras[2].fromToc, true);
  assert.equal(book.extras[2].title, "Chapter Seven");
  assert.deepEqual(book.extras[2].paragraphs, [
    `The first half of chapter seven is in this file. ${LONG}`,
    `The second half of chapter seven follows it at once. ${LONG}`,
  ]);
  assert.equal(book.extras[3].fromToc, undefined);
  assert.match(book.extras[3].paragraphs.join(" "), /non linear/);
  const slots = epub.readingSlots(book);
  assert.deepEqual(
    slots.map((slot) => (slot.kind === "chapter" ? `c${slot.index}` : book.extras[slot.index].id)),
    ["x0", "c0", "x1", "c1", "x2", "x3", "c2"],
  );
});

test("book-wide split filenames are not glued onto a chapter", async () => {
  const book = await buildEpub({
    title: "Numbered Splits",
    toc: [
      { title: "Index Start", href: "index_split_000.xhtml" },
      { title: "Index Middle", href: "index_split_004.xhtml" },
      { title: "Index End", href: "index_split_010.xhtml" },
      { title: "Flipped Start", href: "FLIPPED_split_000.xhtml" },
      { title: "Flipped Later", href: "FLIPPED_split_020.xhtml" },
      { title: "Part A", href: "Magic_Tree_H-on_the_Titanic_split_000.xhtml" },
      { title: "Part B", href: "Magic_Tree_H-on_the_Titanic_split_010.xhtml" },
      { title: "Wings Heading", href: "Wings_of_Fire_1__Dragonet_Proph_split_013.xhtml" },
      { title: "Wings Next", href: "Wings_of_Fire_1__Dragonet_Proph_split_015.xhtml" },
    ],
    spine: [
      { id: "i0", href: "index_split_000.xhtml" },
      { id: "i1", href: "index_split_001.xhtml" },
      { id: "i2", href: "index_split_002.xhtml" },
      { id: "i4", href: "index_split_004.xhtml" },
      { id: "i10", href: "index_split_010.xhtml" },
      { id: "i11", href: "index_split_011.xhtml" },
      { id: "f0", href: "FLIPPED_split_000.xhtml" },
      { id: "f21", href: "FLIPPED_split_021.xhtml" },
      { id: "f20", href: "FLIPPED_split_020.xhtml" },
      { id: "a", href: "Magic_Tree_H-on_the_Titanic_split_000.xhtml" },
      { id: "b", href: "Magic_Tree_H-on_the_Titanic_split_001.xhtml" },
      { id: "c", href: "Magic_Tree_H-on_the_Titanic_split_002.xhtml" },
      { id: "f", href: "Magic_Tree_H-on_the_Titanic_split_010.xhtml" },
      { id: "g", href: "Magic_Tree_H-on_the_Titanic_split_011.xhtml" },
      { id: "w13", href: "Wings_of_Fire_1__Dragonet_Proph_split_013.xhtml" },
      { id: "w14", href: "Wings_of_Fire_1__Dragonet_Proph_split_014.xhtml" },
      { id: "w15", href: "Wings_of_Fire_1__Dragonet_Proph_split_015.xhtml" },
    ],
    files: {
      "index_split_000.xhtml": `<h1>Index Start</h1><p>The first listed index file stays alone in this chapter. ${LONG}</p>`,
      "index_split_001.xhtml": `<p>Unlisted index file must not be glued onto the first chapter. ${LONG}</p>`,
      "index_split_002.xhtml": `<p>Another index file from the same series stays out too. ${LONG}</p>`,
      "index_split_004.xhtml": `<h1>Index Middle</h1><p>The middle listed index file is its own chapter. ${LONG}</p>`,
      "index_split_010.xhtml": `<h1>Index End</h1><p>The last listed index file does not absorb the next one. ${LONG}</p>`,
      "index_split_011.xhtml": `<p>The index file after the last listed chapter stays unread. ${LONG}</p>`,
      "FLIPPED_split_000.xhtml": `<h1>Flipped Start</h1><p>The first flipped file stays its own listed chapter. ${LONG}</p>`,
      "FLIPPED_split_021.xhtml": `<p>A flipped split name is an advertisement and stays out of the book text. ${LONG}</p>`,
      "FLIPPED_split_020.xhtml": `<h1>Flipped Later</h1><p>The later flipped file is listed and stays alone. ${LONG}</p>`,
      "Magic_Tree_H-on_the_Titanic_split_000.xhtml": `<h1>Part A</h1><p>Opening scene of the listed first file stays alone in this chapter. ${LONG}</p>`,
      "Magic_Tree_H-on_the_Titanic_split_001.xhtml": `<p>Unlisted numbered file must not be glued onto the first chapter. ${LONG}</p>`,
      "Magic_Tree_H-on_the_Titanic_split_002.xhtml": `<p>Another numbered file from the same converter stays out too. ${LONG}</p>`,
      "Magic_Tree_H-on_the_Titanic_split_010.xhtml": `<h1>Part B</h1><p>Second listed file is its own chapter and does not absorb neighbors. ${LONG}</p>`,
      "Magic_Tree_H-on_the_Titanic_split_011.xhtml": `<p>The file after the second listed chapter stays unlisted and unread. ${LONG}</p>`,
      "Wings_of_Fire_1__Dragonet_Proph_split_013.xhtml": `<h1>Wings Heading</h1><p>The listed wings heading stays alone in this chapter. ${LONG}</p>`,
      "Wings_of_Fire_1__Dragonet_Proph_split_014.xhtml": `<p>The unlisted wings body stays out because many contents entries share it. ${LONG}</p>`,
      "Wings_of_Fire_1__Dragonet_Proph_split_015.xhtml": `<h1>Wings Next</h1><p>The next listed wings file is its own chapter. ${LONG}</p>`,
    },
  });
  assert.equal(book.chapters.length, 9);
  const joined = paragraphs(book).flat().join("\n");
  assert.match(joined, /first listed index file stays alone/);
  assert.match(joined, /middle listed index file/);
  assert.match(joined, /last listed index file/);
  assert.match(joined, /first flipped file stays/);
  assert.match(joined, /later flipped file is listed/);
  assert.match(joined, /Opening scene of the listed first file/);
  assert.match(joined, /Second listed file is its own chapter/);
  assert.match(joined, /listed wings heading stays alone/);
  assert.match(joined, /next listed wings file/);
  for (const absent of [
    "Unlisted index file",
    "Another index file",
    "index file after the last",
    "flipped split name",
    "Unlisted numbered file",
    "Another numbered file",
    "stays unlisted and unread",
    "unlisted wings body",
  ]) {
    assert.equal(joined.includes(absent), false, absent);
  }
});

test("a 1-entry NCX keeps one chapter per spine file", async () => {
  const files = {
    "main.xhtml": `<h1>Main</h1><p>File main holds the first spine chapter and must stay chapter zero. ${LONG}</p>`,
    "main_split_001.xhtml": `<h1>Main Next</h1><p>The split after main stays its own chapter in the one entry fallback. ${LONG}</p>`,
    "index_split_000.xhtml": `<h1>Zero</h1><p>Index split zero is its own chapter in the spine fallback. ${LONG}</p>`,
    "index_split_001.xhtml": `<h1>One</h1><p>Index split one is its own chapter and is not glued on. ${LONG}</p>`,
    "index_split_002.xhtml": `<h1>Two</h1><p>Index split two is its own chapter and is not glued on. ${LONG}</p>`,
    "index_split_003.xhtml": `<h1>Three</h1><p>Index split three is its own chapter and is not glued on. ${LONG}</p>`,
  };
  const spine = Object.keys(files).map((href, index) => ({ id: `f${index}`, href }));
  const book = await buildEpub({
    title: "One Entry",
    toc: [],
    ncx: [{ title: "Main", href: "main.xhtml" }],
    spine,
    files,
  });
  assert.equal(book.chapters.length, 6);
  assert.equal(book.extras.length, 0);
  assert.deepEqual(
    book.chapters.map((chapter) => chapter.paragraphs[1]),
    [
      `File main holds the first spine chapter and must stay chapter zero. ${LONG}`,
      `The split after main stays its own chapter in the one entry fallback. ${LONG}`,
      `Index split zero is its own chapter in the spine fallback. ${LONG}`,
      `Index split one is its own chapter and is not glued on. ${LONG}`,
      `Index split two is its own chapter and is not glued on. ${LONG}`,
      `Index split three is its own chapter and is not glued on. ${LONG}`,
    ],
  );
});

test("an empty NCX keeps one chapter per spine file", async () => {
  const files = {
    "a.xhtml": `<h1>File A</h1><p>The first big file is chapter zero when the contents list is empty. ${LONG}</p>`,
    "b.xhtml": `<h1>File B</h1><p>The second big file is chapter one and is not merged away. ${LONG}</p>`,
    "c.xhtml": `<h1>File C</h1><p>The third big file is chapter two and stays separate. ${LONG}</p>`,
  };
  const book = await buildEpub({
    title: "Empty Contents",
    toc: [],
    ncx: null,
    spine: [
      { id: "a", href: "a.xhtml" },
      { id: "b", href: "b.xhtml" },
      { id: "c", href: "c.xhtml" },
    ],
    files,
  });
  assert.equal(book.chapters.length, 3);
  assert.equal(book.extras.length, 0);
  assert.deepEqual(book.chapters.map((chapter) => chapter.title), ["File A", "File B", "File C"]);
});

test("a near-empty contents list stays one chapter per spine file", async () => {
  async function sparse(count, listed) {
    const files = {};
    const spine = [];
    for (let i = 1; i <= count; i += 1) {
      const href = `f${String(i).padStart(2, "0")}.xhtml`;
      files[href] = `<h1>File ${i}</h1><p>Spine file ${i} stays chapter ${i - 1} in the fallback. ${LONG}</p>`;
      spine.push({ id: `f${i}`, href });
    }
    return buildEpub({
      title: "Sparse Contents",
      toc: [],
      ncx: [{ title: "File 1", href: listed }],
      spine,
      files,
    });
  }
  const wide = await sparse(27, "f01.xhtml");
  assert.equal(wide.chapters.length, 27);
  assert.equal(wide.extras.length, 0);
  assert.equal(wide.chapters[0].title, "File 1");
  assert.match(wide.chapters[0].paragraphs[1], /Spine file 1 stays chapter 0/);
  assert.equal(wide.chapters[26].title, "File 27");
  assert.match(wide.chapters[26].paragraphs[1], /Spine file 27 stays chapter 26/);
  const short = await sparse(5, "f01.xhtml");
  assert.equal(short.chapters.length, 5);
  assert.equal(short.extras.length, 0);
  assert.deepEqual(
    short.chapters.map((chapter) => chapter.title),
    ["File 1", "File 2", "File 3", "File 4", "File 5"],
  );
});

test("a drop cap joins into one tappable word without moving paragraphs", async () => {
  const plain = `<h1>The Opening</h1><p>Jack and Jill went up the hill to fetch a pail of water today.</p><p>The second paragraph stays at the same index in this chapter.</p><p>Say hello world after a real space between the words.</p>`;
  const marked = `<h1>The Opening</h1><p><span class="big">J</span>ack and Jill went up the hill to fetch a pail of water today.</p><p>The second paragraph stays at the same index in this chapter.</p><p>Say <span>hello</span> <span>world</span> after a real space between the words.</p><p>A <span>blue</span><br/><span>bird</span> stays two words across the break in this line.</p>`;
  const second = `<h1>The Road</h1><p><span class="dropcap">W</span>estward the wagons rolled over the open prairie before dark.</p>`;
  const filesFor = (first) => ({
    "c01.xhtml": first,
    "c02.xhtml": second,
  });
  const spine = [
    { id: "c01", href: "c01.xhtml" },
    { id: "c02", href: "c02.xhtml" },
  ];
  const toc = [
    { title: "The Opening", href: "c01.xhtml" },
    { title: "The Road", href: "c02.xhtml" },
  ];
  const withCap = await buildEpub({ title: "Drop Cap", toc, spine, files: filesFor(marked) });
  const without = await buildEpub({ title: "Drop Cap", toc, spine, files: filesFor(plain) });
  assert.deepEqual(withCap.chapters[0].paragraphs.slice(0, 4), without.chapters[0].paragraphs);
  assert.deepEqual(withCap.chapters[1].paragraphs, without.chapters[1].paragraphs);
  assert.equal(withCap.chapters[0].paragraphs[1].startsWith("Jack and Jill"), true);
  assert.equal(withCap.chapters[0].paragraphs[1].includes("J ack"), false);
  assert.equal(withCap.chapters[1].paragraphs[1].startsWith("Westward"), true);
  assert.match(withCap.chapters[0].html, /class="dropcap"/);
  assert.match(withCap.chapters[1].html, /class="dropcap"/);
  const parse = (html) => new DOMParser().parseFromString(html, "text/html");
  const tokens = format.indexChapterHtml(withCap.chapters[0].html, parse).tokens.map((token) => token.w);
  assert.equal(tokens.filter((word) => word === "jack").length, 1);
  assert.equal(tokens.includes("ack"), false);
  assert.ok(tokens.includes("hello") && tokens.includes("world"));
  assert.equal(tokens.includes("helloworld"), false);
  assert.ok(tokens.includes("blue") && tokens.includes("bird"));
  assert.equal(tokens.includes("bluebird"), false);
  const shown = format.readingHtml(
    withCap.chapters[0].html,
    new Set(["jack"]),
    (surface) => surface.toLowerCase(),
    0,
    new Map(),
  );
  const doc = new DOMParser().parseFromString(`<div>${shown}</div>`, "text/html");
  const jack = [...doc.querySelectorAll("button")].find((button) => button.textContent === "Jack");
  assert.ok(jack, "Jack is one button");
  assert.equal(jack.className, "book-hard");
  assert.ok(doc.querySelector("p.dropcap"));
});

test("accented letters and combining marks are one tappable word", () => {
  const parse = (html) => new DOMParser().parseFromString(html, "text/html");
  const cafe = `cafe\u0301`;
  const html = `<p>She ordered a café in Yucatán before the naïve waltz.</p><p>The ${cafe} menu listed crêpes and did not move this paragraph.</p>`;
  const indexed = format.indexChapterHtml(html, parse);
  const tokens = indexed.tokens.map((token) => token.w);
  assert.ok(tokens.includes("café"));
  assert.ok(tokens.includes("yucatán"));
  assert.ok(tokens.includes("naïve"));
  assert.ok(tokens.includes("crêpes"));
  assert.ok(tokens.includes(cafe));
  assert.equal(tokens.includes("caf"), false);
  assert.equal(tokens.includes("yucat"), false);
  assert.equal(tokens.includes("naive"), false);
  assert.deepEqual(
    indexed.blocks,
    [
      "She ordered a café in Yucatán before the naïve waltz.",
      `The ${cafe} menu listed crêpes and did not move this paragraph.`,
    ],
  );
  const shown = format.readingHtml(html, new Set(["café", "yucatán"]), (surface) => surface.toLowerCase(), 0, new Map());
  const doc = new DOMParser().parseFromString(`<div>${shown}</div>`, "text/html");
  const words = [...doc.querySelectorAll("button")].map((button) => button.textContent);
  assert.ok(words.includes("café"));
  assert.ok(words.includes("Yucatán"));
  assert.ok(words.includes(cafe));
  assert.equal(words.includes("caf"), false);
  assert.equal(words.includes("Yucat"), false);
  assert.equal(format.splitWords("well-known don't café").filter((_, index) => index % 2 === 1).join(","), "well,known,don't,café");
});

test("a contents fragment on body or html starts at the beginning of that file", async () => {
  const book = await buildEpub({
    title: "Body Anchor",
    toc: [
      { title: "Chapter One", href: "c01.xhtml" },
      { title: "Epilogue", href: "epilogue.xhtml#181NK0-epilogue" },
      { title: "A Note", href: "epilogue.xhtml#inner-note" },
      { title: "Afterword", href: "afterword.xhtml#html-after" },
      { title: "Ghost", href: "c01.xhtml#no-such-id" },
    ],
    spine: [
      { id: "c01", href: "c01.xhtml" },
      { id: "epi", href: "epilogue.xhtml" },
      { id: "aft", href: "afterword.xhtml" },
    ],
    files: {
      "c01.xhtml": `<h1>Chapter One</h1><p>The opening chapter is a normal file with no fragment. ${LONG}</p>`,
      "epilogue.xhtml": {
        bodyId: "181NK0-epilogue",
        html: `<h1>Epilogue</h1><p>The epilogue opens at the body anchor and this paragraph comes first. ${LONG}</p><h2 id="inner-note">A Note</h2><p>This later note starts at an inner anchor and is its own chapter. ${LONG}</p>`,
      },
      "afterword.xhtml": {
        htmlId: "html-after",
        html: `<h1>Afterword</h1><p>The afterword id sits on the html element and the whole file is kept. ${LONG}</p>`,
      },
    },
  });
  assert.deepEqual(
    book.chapters.map((chapter) => chapter.title),
    ["Chapter One", "Epilogue", "A Note", "Afterword"],
  );
  assert.deepEqual(paragraphs(book), [
    ["Chapter One", `The opening chapter is a normal file with no fragment. ${LONG}`],
    ["Epilogue", `The epilogue opens at the body anchor and this paragraph comes first. ${LONG}`],
    ["A Note", `This later note starts at an inner anchor and is its own chapter. ${LONG}`],
    ["Afterword", `The afterword id sits on the html element and the whole file is kept. ${LONG}`],
  ]);
  assert.equal(
    book.chapters[0].paragraphs.some((paragraph) => paragraph.includes("epilogue opens")),
    false,
  );
});

test("duplicate playOrder entries that point at different files stay separate chapters", async () => {
  const book = await buildEpub({
    title: "Play Order",
    toc: [],
    ncx: [
      {
        title: "The Chapters",
        href: "c21.xhtml#ch21",
        playOrder: "1",
        id: "part",
        children: [
          { title: "Chapter 21", href: "c21.xhtml#ch21", playOrder: "40", id: "num_40" },
        ],
      },
      { title: "Epilogue", href: "epilogue.xhtml", playOrder: "40", id: "num_40" },
      { title: "Afterword", href: "after.xhtml", playOrder: "5", id: "after" },
    ],
    spine: [
      { id: "c21", href: "c21.xhtml" },
      { id: "epi", href: "epilogue.xhtml" },
      { id: "aft", href: "after.xhtml" },
    ],
    files: {
      "c21.xhtml": `<h1 id="ch21">Chapter 21</h1><p>Chapter twenty one stays its own chapter beside the epilogue. ${LONG}</p>`,
      "epilogue.xhtml": `<h1>Epilogue</h1><p>The epilogue repeats play order forty and points at its own file. ${LONG}</p>`,
      "after.xhtml": `<h1>Afterword</h1><p>The afterword has a lower play order and still stays last. ${LONG}</p>`,
    },
  });
  assert.deepEqual(
    book.chapters.map((chapter) => chapter.title),
    ["Chapter 21", "Epilogue", "Afterword"],
  );
});

test("duplicate playOrder entries that point at the same file keep today's chapters", async () => {
  const front = `<h1>Front</h1><p>The opening file holds the dedication and the contents together. ${LONG}</p>`;
  const book = await buildEpub({
    title: "Same File Order",
    toc: [],
    ncx: [
      { title: "DEDICATION", href: "book_split_000.xhtml", playOrder: "1", id: "dedication" },
      { title: "CONTENTS", href: "book_split_000.xhtml", playOrder: "1", id: "contents" },
      { title: "Chapter One", href: "c01.xhtml", playOrder: "2", id: "c01" },
    ],
    spine: [
      { id: "front", href: "book_split_000.xhtml" },
      { id: "more", href: "book_split_001.xhtml" },
      { id: "c01", href: "c01.xhtml" },
    ],
    files: {
      "book_split_000.xhtml": front,
      "book_split_001.xhtml": `<p>This split continuation must stay out while two contents entries share the file. ${LONG}</p>`,
      "c01.xhtml": `<h1>Chapter One</h1><p>The first real chapter keeps its place after the shared file. ${LONG}</p>`,
    },
  });
  assert.deepEqual(
    book.chapters.map((chapter) => chapter.title),
    ["DEDICATION", "CONTENTS", "Chapter One"],
  );
  assert.deepEqual(book.chapters[0].paragraphs, book.chapters[1].paragraphs);
  assert.equal(
    book.chapters.some((chapter) =>
      chapter.paragraphs.some((paragraph) => paragraph.includes("split continuation")),
    ),
    false,
  );
  assert.deepEqual(book.chapters[2].paragraphs, [
    "Chapter One",
    `The first real chapter keeps its place after the shared file. ${LONG}`,
  ]);
});

test("duplicate playOrder entries titled title page and dedication stay on the shared file", async () => {
  const front = `<h1>Front</h1><p>The opening file holds the title page and the dedication together. ${LONG}</p>`;
  const book = await buildEpub({
    title: "Title And Dedication",
    toc: [],
    ncx: [
      { title: "TITLE PAGE", href: "book_split_000.xhtml", playOrder: "1", id: "title" },
      { title: "DEDICATION", href: "book_split_000.xhtml", playOrder: "1", id: "dedication" },
      { title: "Chapter One", href: "c01.xhtml", playOrder: "2", id: "c01" },
    ],
    spine: [
      { id: "front", href: "book_split_000.xhtml" },
      { id: "more", href: "book_split_001.xhtml" },
      { id: "c01", href: "c01.xhtml" },
    ],
    files: {
      "book_split_000.xhtml": front,
      "book_split_001.xhtml": `<p>This split continuation must stay out while two contents entries share the file. ${LONG}</p>`,
      "c01.xhtml": `<h1>Chapter One</h1><p>The first real chapter keeps its place after the shared file. ${LONG}</p>`,
    },
  });
  assert.deepEqual(
    book.chapters.map((chapter) => chapter.title),
    ["TITLE PAGE", "DEDICATION", "Chapter One"],
  );
  assert.deepEqual(book.chapters[0].paragraphs, book.chapters[1].paragraphs);
  assert.equal(
    book.chapters.some((chapter) =>
      chapter.paragraphs.some((paragraph) => paragraph.includes("split continuation")),
    ),
    false,
  );
  assert.deepEqual(book.chapters[2].paragraphs, [
    "Chapter One",
    `The first real chapter keeps its place after the shared file. ${LONG}`,
  ]);
});

// Mirrors the Wings of Fire 8 tail. Chapters 20 and 21 name whole files. The epilogue
// is the only fragment, and that id sits on body, so a search inside body misses it.
// Without the body-id recovery the chapters are CHAPTER 20, CHAPTER 21, ABOUT THE AUTHOR,
// COPYRIGHT. SNEAK PEEK is one short paragraph (under 20 letters) and is dropped. Its
// prose is in the next spine file, which is not a `_split_` continuation, so it stays out.
// ALSO AVAILABLE is the same short-page drop. Neither is merged into a neighbor.
test("a calibre epilogue fragment on body stays a chapter when other entries have no fragment", async () => {
  const paras = (count, sentence) =>
    Array.from({ length: count }, (_, index) => `<p class="para">${sentence} ${index + 1}. ${LONG}</p>`).join("");
  const bodyId = "181NK0-dd0be4216edd45af83082f2da318fd7a";
  const book = await buildEpub({
    title: "Calibre Tail",
    toc: [],
    ncxDepth: "3",
    ncx: [
      {
        title: "Part",
        href: "text/part0040.html",
        playOrder: "1",
        id: "num_1",
        children: [
          { title: "CHAPTER 20", href: "text/part0040.html", playOrder: "39", id: "num_39" },
          { title: "CHAPTER 21", href: "text/part0041.html", playOrder: "40", id: "num_40" },
        ],
      },
      {
        title: "EPILOGUE",
        href: `text/part0042.html#${bodyId}`,
        playOrder: "40",
        id: "num_41",
      },
      { title: "SNEAK PEEK", href: "text/part0043.html", playOrder: "41", id: "num_42" },
      { title: "ABOUT THE AUTHOR", href: "text/part0045.html", playOrder: "42", id: "num_43" },
      { title: "ALSO AVAILABLE", href: "text/part0046.html", playOrder: "43", id: "num_44" },
      { title: "COPYRIGHT", href: "text/part0049.html", playOrder: "44", id: "num_45" },
    ],
    spine: [
      "part0040",
      "part0041",
      "part0042",
      "part0043",
      "part0044",
      "part0045",
      "part0046",
      "part0047",
      "part0048",
      "part0049",
    ].map((id) => ({ id, href: `text/${id}.html` })),
    files: {
      "text/part0040.html": `<h1>CHAPTER 20</h1>${paras(3, "Chapter twenty stays its own file.")}`,
      "text/part0041.html": paras(125, "Chapter twenty one stays inside its own file."),
      "text/part0042.html": {
        bodyId,
        bodyClass: "calibre",
        html: `<div class="frontmatterpage" id="ch26"><div class="frontmatterpage"><p class="centerimage2"><img src="../images/epilogue.jpg" alt=""/></p></div><p class="paranoindent1">Starflight was working late in the library under the mountain. ${LONG}</p>${paras(40, "The epilogue keeps going after that opening line.")}</div>`,
      },
      "text/part0043.html": `<p class="para">Soon.</p>`,
      "text/part0044.html": paras(34, "The sneak peek story lives in the next spine file."),
      "text/part0045.html": `<h1>ABOUT THE AUTHOR</h1><p>The author note is long enough to stay its own chapter. ${LONG}</p>`,
      "text/part0046.html": `<p class="centerimage2"><img src="../images/also.jpg" alt=""/></p><p>Also.</p>`,
      "text/part0047.html": `<p>This unlisted page must stay out of every chapter. ${LONG}</p>`,
      "text/part0048.html": `<p>This second unlisted page must stay out of every chapter. ${LONG}</p>`,
      "text/part0049.html": `<h1>COPYRIGHT</h1><p>The copyright page is long enough to stay its own chapter. ${LONG}</p>`,
    },
  });
  assert.deepEqual(
    book.chapters.map((chapter) => chapter.title),
    ["CHAPTER 20", "CHAPTER 21", "EPILOGUE", "ABOUT THE AUTHOR", "COPYRIGHT"],
  );
  assert.equal(book.chapters[1].paragraphs.length, 125);
  assert.equal(
    book.chapters[1].paragraphs.some((paragraph) => paragraph.includes("Starflight")),
    false,
  );
  assert.equal(book.chapters[2].paragraphs[0].startsWith("Starflight was working late"), true);
  assert.equal(book.chapters[2].paragraphs.length, 41);
  const all = book.chapters.flatMap((chapter) => chapter.paragraphs).join("\n");
  assert.equal(all.includes("sneak peek story"), false);
  assert.equal(all.includes("unlisted page"), false);
  assert.equal(all.includes("Soon."), false);
});

test("every fragment on body keeps the spine fallback, including its titles", async () => {
  const book = await buildEpub({
    title: "All On Body",
    toc: [
      { title: "Contents Label One", href: "c01.xhtml#body-one" },
      { title: "Contents Label Two", href: "c02.xhtml#body-two" },
    ],
    spine: [
      { id: "c01", href: "c01.xhtml" },
      { id: "c02", href: "c02.xhtml" },
    ],
    files: {
      "c01.xhtml": {
        bodyId: "body-one",
        html: `<h1>Opened From The File</h1><p>The first file is a whole chapter from the spine. ${LONG}</p>`,
      },
      "c02.xhtml": {
        bodyId: "body-two",
        html: `<h1>Second File Heading</h1><p>The second file is also taken from the spine. ${LONG}</p>`,
      },
    },
  });
  assert.deepEqual(
    book.chapters.map((chapter) => chapter.title),
    ["Opened From The File", "Second File Heading"],
  );
  assert.deepEqual(paragraphs(book), [
    ["Opened From The File", `The first file is a whole chapter from the spine. ${LONG}`],
    ["Second File Heading", `The second file is also taken from the spine. ${LONG}`],
  ]);
});


test("a book with no p elements splits innermost text divs into paragraphs", async () => {
  const book = await buildEpub({
    title: "Div Chapters",
    toc: [
      { title: "Chapter One", href: "c01.xhtml" },
      { title: "Chapter Two", href: "c02.xhtml" },
    ],
    spine: [
      { id: "c01", href: "c01.xhtml" },
      { id: "c02", href: "c02.xhtml" },
    ],
    files: {
      "c01.xhtml": `<div class="chapter">
  <h1>The First Chapter Title</h1>
  <div class="calibre1"><span>The morning was cold and bright today.</span></div>
  <div class="shell">
    <div class="calibre1"><span>Inside the nested div sits the real paragraph.</span></div>
  </div>
  <div></div>
  <div><img src="pic.jpg" alt="a lantern"/></div>
  <div><span><img src="icon.jpg" alt="a small icon"/></span></div>
  <div class="calibre1"><i>The last line of the chapter stands alone.</i></div>
  <div><span>X</span></div>
  <div>
    <span>This outer line should not be its own paragraph.</span>
    <div><span>The inner line is the one that counts.</span></div>
  </div>
  <blockquote>A quoted line that is already a paragraph block.</blockquote>
  <ul><li>A list item that stays a paragraph too.</li></ul>
</div>`,
      "c02.xhtml": `<div><span>Before the heading comes this paragraph.</span></div>
<h2>A Middle Heading</h2>
<div>Direct text in the div is a paragraph too.</div>
<div><em>A second paragraph uses emphasis.</em></div>`,
    },
  });
  assert.deepEqual(
    book.chapters.map((chapter) => chapter.title),
    ["Chapter One", "Chapter Two"],
  );
  assert.deepEqual(paragraphs(book), [
    [
      "The First Chapter Title",
      "The morning was cold and bright today.",
      "Inside the nested div sits the real paragraph.",
      "The last line of the chapter stands alone.",
      "The inner line is the one that counts.",
      "A quoted line that is already a paragraph block.",
      "A list item that stays a paragraph too.",
    ],
    [
      "Before the heading comes this paragraph.",
      "A Middle Heading",
      "Direct text in the div is a paragraph too.",
      "A second paragraph uses emphasis.",
    ],
  ]);
  const chapter = book.chapters[0];
  assert.equal(chapter.html.includes("data-para"), true);
  assert.equal(chapter.html.includes(">X<"), true);
  const root = new DOMParser().parseFromString(`<div>${chapter.html}</div>`, "text/html").body
    .firstElementChild;
  const blocks = help.paragraphBlocks(root);
  assert.deepEqual(
    blocks.map((block) => flow.flowText(block)),
    chapter.paragraphs,
  );
  const shown = format.readingHtml(chapter.html, new Set(), (surface) => surface.toLowerCase(), 0, new Map());
  const shownRoot = new DOMParser().parseFromString(`<div>${shown}</div>`, "text/html").body
    .firstElementChild;
  assert.equal(shownRoot.querySelectorAll("div[data-para]").length, 4);
  assert.deepEqual(
    help.paragraphBlocks(shownRoot).map((block) => flow.flowText(block)),
    chapter.paragraphs,
  );
  const indexed = format.indexChapterHtml(chapter.html, (html) =>
    new DOMParser().parseFromString(html, "text/html"),
  );
  assert.deepEqual(indexed.blocks, chapter.paragraphs);

  const fallback = await buildEpub({
    title: "One Entry",
    toc: [],
    ncx: [{ title: "Only", href: "c01.xhtml" }],
    spine: [
      { id: "c01", href: "c01.xhtml" },
      { id: "c02", href: "c02.xhtml" },
    ],
    files: {
      "c01.xhtml": `<div><span>The first spine file is its own chapter of div paragraphs.</span></div>`,
      "c02.xhtml": `<div><span>The second spine file is still its own chapter.</span></div>
<div><span>Its second div is a paragraph, not a new chapter.</span></div>`,
    },
  });
  assert.equal(fallback.chapters.length, 2);
  assert.deepEqual(paragraphs(fallback), [
    ["The first spine file is its own chapter of div paragraphs."],
    [
      "The second spine file is still its own chapter.",
      "Its second div is a paragraph, not a new chapter.",
    ],
  ]);
});

test("a book that already has a p element ignores text divs", async () => {
  const book = await buildEpub({
    title: "Has Paragraphs",
    toc: [
      { title: "Kept Chapter", href: "c01.xhtml" },
      { title: "Div Only File", href: "c02.xhtml" },
    ],
    spine: [
      { id: "c01", href: "c01.xhtml" },
      { id: "c02", href: "c02.xhtml" },
    ],
    files: {
      "c01.xhtml": `<h1>Kept Chapter</h1>
<p>The real paragraph stays exactly as it is today.</p>
<div><span>This div must not become a paragraph of its own.</span></div>
<div class="shell"><div><span>A nested div is ignored too.</span></div></div>
<div><img src="pic.jpg" alt="a lantern"/></div>`,
      "c02.xhtml": `<div><span>First div sentence of the second chapter.</span></div>
<div><span>Second div sentence of the second chapter.</span></div>`,
    },
  });
  assert.deepEqual(
    book.chapters.map((chapter) => chapter.title),
    ["Kept Chapter", "Div Only File"],
  );
  assert.deepEqual(paragraphs(book), [
    ["Kept Chapter", "The real paragraph stays exactly as it is today."],
    ["First div sentence of the second chapter. Second div sentence of the second chapter."],
  ]);
  for (const chapter of book.chapters) assert.equal(chapter.html.includes("data-para"), false);
});

/** Paragraph text of the bundled classics, hashed before the extraction fixes. */
const PUBLIC_PARAGRAPHS = {
  alice: "cd825eeade04fa79884ae333bb2434e498cbe3949ff4404b510a9b18693200c4",
  anne: "9c4fb6f47ea90b5a9b628a1f3873658abf2e4d305f38f3d1ad9e0ef272a41884",
  "black-beauty": "f547c8cda4a9a19ba89778beb15d5a5c226f3c46bf3cefd8ccad337797537bde",
  "jungle-book": "7a941531fd5b38806b7f078e19e2816b41f850b2a5c4919d20d19e3435b3d122",
  "little-women": "c79f997652b8af4e657cce87a6f3bb5729592f7d674e7cfc42563f39f06e5fcb",
  "looking-glass": "b50553f1f4809fe61f53c6a121f6f5883955290d0c2bb4fe41089bc2461d6cf2",
  "peter-pan": "3f6403d6e44a6bb3c11e713f0ec9ad4cebe5bc4d0ffa852d8245dd08bc00ed94",
  "secret-garden": "07d7825fcb1a7c3a7d9ad1f180d5acd7902c5fc46413248ba9aa5cdfe6db60ec",
  "tom-sawyer": "c9f96c3d00dfdf0f4f6fa648cbbb22193dd4e0ecf4533c5da244255ca3bf6cf0",
  "treasure-island": "88df409da5ffe3515f3602d33f46a9b8daf0d9853d5a8c36f7cade4c667d3961",
  "wind-in-the-willows": "31a9e8d4b845d89a1f1ab8b8992aff16770932cbb5d1e2be5bbb168e7abd3d1a",
  "wizard-of-oz": "cd84bd55bdbd6c253f3083e585793fad76c0eb4a42061f9e3d6a14f11a3d1d9a",
};

test("a poem blockquote stays one paragraph", async () => {
  const book = await buildEpub({
    title: "Poems",
    toc: [
      { title: "Chapter One", href: "c01.xhtml" },
      { title: "Chapter Two", href: "c02.xhtml" },
    ],
    spine: [
      { id: "c01", href: "c01.xhtml" },
      { id: "c02", href: "c02.xhtml" },
    ],
    files: {
      "c01.xhtml": `<h1>Chapter One</h1><p>The story paragraph stays before the poem in this chapter. ${LONG}</p><blockquote><p>The first line of the poem sits inside the quote.</p><p>The second line stays in that same paragraph.</p></blockquote>`,
      "c02.xhtml": `<h1>Chapter Two</h1><p>The next chapter is unchanged by the poem before it. ${LONG}</p>`,
    },
  });
  assert.deepEqual(paragraphs(book), [
    [
      "Chapter One",
      `The story paragraph stays before the poem in this chapter. ${LONG}`,
      "The first line of the poem sits inside the quote. The second line stays in that same paragraph.",
    ],
    ["Chapter Two", `The next chapter is unchanged by the poem before it. ${LONG}`],
  ]);
});

test("a blockquote that holds a heading stays one paragraph unless segmentation is 2", async () => {
  const prologue = `<blockquote><h1>Prologue</h1><p>The first line of the prologue tells how the spell began. ${LONG}</p><p>The second line of the prologue stays in that same opening.</p></blockquote>`;
  const spec = {
    title: "Prologue Book",
    toc: [
      { title: "Prologue", href: "c02.xhtml" },
      { title: "Chapter One", href: "c03.xhtml" },
    ],
    spine: [
      { id: "c02", href: "c02.xhtml" },
      { id: "c03", href: "c03.xhtml" },
    ],
    files: {
      "c02.xhtml": prologue,
      "c03.xhtml": `<h1>Chapter One</h1><p>The next chapter is unchanged by the prologue before it. ${LONG}</p>`,
    },
  };
  const whole = `Prologue The first line of the prologue tells how the spell began. ${LONG} The second line of the prologue stays in that same opening.`;
  const plain = await buildEpub(spec);
  assert.deepEqual(paragraphs(plain)[0], [whole]);
  assert.deepEqual(paragraphs(plain)[1], [
    "Chapter One",
    `The next chapter is unchanged by the prologue before it. ${LONG}`,
  ]);
  const root = new DOMParser().parseFromString(`<div>${plain.chapters[0].html}</div>`, "text/html").body
    .firstElementChild;
  assert.deepEqual(
    help.paragraphBlocks(root).map((block) => flow.flowText(block)),
    [whole],
  );
  const split = await buildEpub({ ...spec, segmentation: 2 });
  assert.deepEqual(paragraphs(split)[0], [
    "Prologue",
    `The first line of the prologue tells how the spell began. ${LONG}`,
    "The second line of the prologue stays in that same opening.",
  ]);
  assert.deepEqual(paragraphs(split)[1], paragraphs(plain)[1]);
  assert.deepEqual(
    help.paragraphBlocks(root, 2).map((block) => flow.flowText(block)),
    paragraphs(split)[0],
  );
  root.setAttribute("data-segmentation", "2");
  assert.deepEqual(
    help.paragraphBlocks(root).map((block) => flow.flowText(block)),
    paragraphs(split)[0],
  );
});

test("a calibre chapter wrapper splits into its paragraphs and keeps contents numbers", async () => {
  const wrap = (heading, body) =>
    `<blockquote class="calibre4"><h1>${heading}</h1><p>${body}</p><p>The second paragraph of ${heading} stays its own paragraph.</p></blockquote>`;
  const calibre = (html) => ({ bodyClass: "calibre", html });
  const book = await buildEpub({
    segmentation: 2,
    title: "Wrapped",
    toc: [
      { title: "A Book of Magic", href: "Book_split_008.xhtml" },
      { title: "Carnival", href: "Book_split_010.xhtml" },
    ],
    spine: [
      { id: "front", href: "Book_split_001.xhtml" },
      { id: "c1", href: "Book_split_008.xhtml" },
      { id: "mid", href: "Book_split_009.xhtml" },
      { id: "c2", href: "Book_split_010.xhtml" },
      { id: "back", href: "Book_split_020.xhtml" },
    ],
    files: {
      "Book_split_001.xhtml": calibre(
        `<blockquote><span>x</span></blockquote><h1>Dear Reader</h1><p>The front matter is its own page and does not become a chapter. ${LONG}</p>`,
      ),
      "Book_split_008.xhtml": calibre(wrap("A Book of Magic", `Dawn was breaking in the woods and Jack ran toward the light. ${LONG}`)),
      "Book_split_009.xhtml": calibre(
        `<blockquote><span>x</span></blockquote><h2>A Visit</h2><p>The unlisted split stays an extra until a word list merges it. ${LONG}</p>`,
      ),
      "Book_split_010.xhtml": calibre(wrap("Carnival", `Annie laughed and opened her eyes in the garden. ${LONG}`)),
      "Book_split_020.xhtml": calibre(
        `<blockquote><span>x</span></blockquote><h1>About the Illustrator</h1><p>The back matter stays an extra after the contents chapters. ${LONG}</p>`,
      ),
    },
  });
  assert.deepEqual(
    book.chapters.map((chapter) => chapter.title),
    ["A Book of Magic", "Carnival"],
  );
  assert.deepEqual(paragraphs(book)[0], [
    "A Book of Magic",
    `Dawn was breaking in the woods and Jack ran toward the light. ${LONG}`,
    "The second paragraph of A Book of Magic stays its own paragraph.",
  ]);
  assert.deepEqual(paragraphs(book)[1], [
    "Carnival",
    `Annie laughed and opened her eyes in the garden. ${LONG}`,
    "The second paragraph of Carnival stays its own paragraph.",
  ]);
  assert.deepEqual(
    book.extras.map((item) => item.href.split("/").pop()),
    ["Book_split_001.xhtml", "Book_split_009.xhtml", "Book_split_020.xhtml"],
  );
  assert.deepEqual(
    book.extras.map((item) => item.id),
    ["x0", "x1", "x2"],
  );
  const root = new DOMParser().parseFromString(`<div>${book.chapters[0].html}</div>`, "text/html").body
    .firstElementChild;
  assert.deepEqual(
    help.paragraphBlocks(root, 2).map((block) => flow.flowText(block)),
    book.chapters[0].paragraphs,
  );
  const before = paragraphs(book).map((rows) => [...rows]);
  const merged = epub.applySpineMerge(book, {
    "Book_split_009.xhtml": "Book_split_008.xhtml",
    "missing.html": "Book_split_008.xhtml",
    "Book_split_020.xhtml": "no-such-chapter.xhtml",
  });
  assert.equal(paragraphs(book)[0].length, before[0].length);
  assert.deepEqual(paragraphs(merged)[0].slice(0, before[0].length), before[0]);
  assert.match(paragraphs(merged)[0].at(-1), /unlisted split stays an extra/);
  assert.equal(merged.chapters[0].html.includes("data-merge-title"), false);
  assert.deepEqual(paragraphs(merged)[1], before[1]);
  assert.deepEqual(
    merged.extras.map((item) => item.id),
    ["x0", "x2"],
  );
  const slots = epub.readingSlots(book);
  assert.deepEqual(
    slots.map((slot) => slot.kind),
    ["extra", "chapter", "extra", "chapter", "extra"],
  );
  assert.deepEqual(
    epub.readingSlots({ chapters: book.chapters, extras: [] }).map((slot) => slot.index),
    [0, 1],
  );
});

test("a merged empty-contents file shows its title without a new paragraph", async () => {
  const book = await buildEpub({
    title: "NightWings",
    toc: [
      { title: "NightWings", href: "night.xhtml" },
      { title: "The Dragonet Prophecy", href: "prophecy.xhtml" },
      { title: "Prologue", href: "prologue.xhtml" },
      { title: "Chapter One", href: "c01.xhtml" },
    ],
    spine: [
      { id: "night", href: "night.xhtml" },
      { id: "prophecy", href: "prophecy.xhtml" },
      { id: "prophecyb", href: "prophecy-body.xhtml" },
      { id: "prologue", href: "prologue.xhtml" },
      { id: "prologueb", href: "prologue-body.xhtml" },
      { id: "c01", href: "c01.xhtml" },
    ],
    files: {
      "night.xhtml": `<h1>NightWings</h1><p>The island was dark and the tribe was waiting. ${LONG}</p>`,
      "prophecy.xhtml": "",
      "prophecy-body.xhtml": `<p>A prophecy was whispered across the sea. ${LONG}</p>`,
      "prologue.xhtml": "",
      "prologue-body.xhtml": `<h1>Prologue</h1><p>The night was cold before the war began. ${LONG}</p>`,
      "c01.xhtml": `<h1>Chapter One</h1><p>Clay opened his eyes in the cave. ${LONG}</p>`,
    },
  });
  assert.deepEqual(
    book.extras.map((item) => [item.id, item.title, item.fromToc]),
    [
      ["x0", "The Dragonet Prophecy", true],
      ["x1", "Prologue", true],
    ],
  );
  const before = paragraphs(book).map((rows) => [...rows]);
  const merged = epub.applySpineMerge(book, {
    "prophecy.xhtml": "night.xhtml",
    "prologue.xhtml": "night.xhtml",
  });
  assert.deepEqual(paragraphs(book), before);
  assert.deepEqual(paragraphs(merged)[0], [
    ...before[0],
    `A prophecy was whispered across the sea. ${LONG}`,
    "Prologue",
    `The night was cold before the war began. ${LONG}`,
  ]);
  assert.equal(paragraphs(merged)[0].includes("The Dragonet Prophecy"), false);
  assert.deepEqual(paragraphs(merged)[1], before[1]);
  assert.deepEqual(merged.extras, []);
  const html = merged.chapters[0].html;
  assert.equal(html.match(/data-merge-title/g)?.length, 1);
  assert.match(html, /<h2 data-merge-title="1">The Dragonet Prophecy<\/h2><p>A prophecy was whispered/);
  assert.equal(html.includes('data-merge-title="1">Prologue'), false);
  const parse = (value) => new DOMParser().parseFromString(value, "text/html");
  const root = parse(`<div>${html}</div>`).body.firstElementChild;
  assert.deepEqual(
    help.paragraphBlocks(root).map((block) => flow.flowText(block)),
    paragraphs(merged)[0],
  );
  const indexed = format.indexChapterHtml(html, parse);
  const stripped = html.replace(/<h2 data-merge-title="1">[\s\S]*?<\/h2>/, "");
  assert.deepEqual(indexed.tokens, format.indexChapterHtml(stripped, parse).tokens);
  assert.equal(indexed.tokens.some((token) => token.w === "dragonet"), false);
  assert.equal(indexed.tokens.filter((token) => token.w === "prophecy").length, 1);
  const shown = format.readingHtml(html, new Set(), (surface) => surface.toLowerCase(), 0, new Map());
  const heading = shown.match(/<h2 data-merge-title="1">[\s\S]*?<\/h2>/)?.[0] ?? "";
  assert.match(heading, /The Dragonet Prophecy/);
  assert.equal(heading.includes("data-n"), false);
  const shownRoot = parse(`<div>${shown}</div>`).body.firstElementChild;
  assert.deepEqual(
    help.paragraphBlocks(shownRoot).map((block) => flow.flowText(block)),
    paragraphs(merged)[0],
  );
});

test("a merge heading is skipped when the file already has that title", () => {
  const chapter = {
    title: "NightWings",
    paragraphs: ["NightWings"],
    html: "<h1>NightWings</h1>",
    href: "night.xhtml",
    itemId: "night",
  };
  const extra = (id, spineAt, title, paragraphs, html, href) => ({
    id,
    href,
    opfHref: href,
    itemId: id,
    spineAt,
    title,
    paragraphs,
    html,
  });
  const book = {
    chapters: [chapter],
    extras: [
      extra("x0", 1, "Tom & Jerry", ["A short note about names."], "<p>A short note about names.</p>", "names.xhtml"),
      extra(
        "x1",
        2,
        "Dedication",
        ["Dedication", "For my sister."],
        "<p>Dedication</p><p>For my sister.</p>",
        "ded.xhtml",
      ),
      extra(
        "x2",
        3,
        "The Dragonet Prophecy",
        ["A short lead.", "The Dragonet Prophecy", "The rest of the page."],
        "<p>A short lead.</p><h2><span>The Dragonet Prophecy</span></h2><p>The rest of the page.</p>",
        "later.xhtml",
      ),
      extra("x3", 4, "   ", ["Nothing to title here at all."], "<p>Nothing to title here at all.</p>", "blank.xhtml"),
    ],
  };
  const merged = epub.applySpineMerge(book, {
    "names.xhtml": "night.xhtml",
    "ded.xhtml": "night.xhtml",
    "later.xhtml": "night.xhtml",
    "blank.xhtml": "night.xhtml",
  });
  assert.deepEqual(merged.chapters[0].paragraphs, [
    "NightWings",
    "A short note about names.",
    "Dedication",
    "For my sister.",
    "A short lead.",
    "The Dragonet Prophecy",
    "The rest of the page.",
    "Nothing to title here at all.",
  ]);
  assert.equal(book.chapters[0].paragraphs.length, 1);
  const html = merged.chapters[0].html;
  assert.equal(html.match(/data-merge-title/g)?.length, 1);
  assert.match(html, /<h2 data-merge-title="1">Tom &amp; Jerry<\/h2><p>A short note/);
  assert.equal(html.includes(">Dedication</h2>"), false);
  assert.equal(html.includes("data-merge-title=\"1\">The Dragonet Prophecy"), false);
});

test("wof03 merge keys match the content file and the empty contents file", async () => {
  const prophecy = `The dragonets are coming and the sea is rising. ${LONG}`;
  const prologue = `The night was cold before the war began. ${LONG}`;
  const intro = `The island was dark and the tribe was waiting. ${LONG}`;
  const book = await buildEpub({
    title: "NightWings",
    toc: [
      { title: "NightWings", href: "part0004.xhtml" },
      { title: "The Dragonet Prophecy", href: "part0005_split_000.xhtml" },
      { title: "Prologue", href: "part0006_split_000.xhtml" },
      { title: "Chapter One", href: "part0007.xhtml" },
    ],
    spine: [
      { id: "intro", href: "part0004.xhtml" },
      { id: "prophecy", href: "part0005_split_000.xhtml" },
      { id: "prophecyb", href: "part0005_split_001.xhtml" },
      { id: "prologue", href: "part0006_split_000.xhtml" },
      { id: "prologueb", href: "part0006_split_001.xhtml" },
      { id: "c01", href: "part0007.xhtml" },
    ],
    files: {
      "part0004.xhtml": `<h1>NightWings</h1><p>${intro}</p>`,
      "part0005_split_000.xhtml": "",
      "part0005_split_001.xhtml": `<p>${prophecy}</p>`,
      "part0006_split_000.xhtml": "",
      "part0006_split_001.xhtml": `<h1>Prologue</h1><p>${prologue}</p>`,
      "part0007.xhtml": `<h1>Chapter One</h1><p>Clay opened his eyes in the cave. ${LONG}</p>`,
    },
  });
  assert.deepEqual(
    book.chapters.map((chapter) => chapter.title),
    ["NightWings", "Chapter One"],
  );
  assert.deepEqual(book.chapters[1].paragraphs, [
    "Chapter One",
    `Clay opened his eyes in the cave. ${LONG}`,
  ]);
  assert.deepEqual(
    book.extras.map((item) => [item.id, item.title, item.fromToc]),
    [
      ["x0", "The Dragonet Prophecy", true],
      ["x1", "Prologue", true],
    ],
  );
  assert.deepEqual(
    book.extras[0].absorbed.map((file) => file.opfHref),
    ["part0005_split_001.xhtml"],
  );
  assert.deepEqual(
    book.extras[1].absorbed.map((file) => file.itemId),
    ["prologueb"],
  );
  const expected = [
    "NightWings",
    intro,
    prophecy,
    "Prologue",
    prologue,
  ];
  const byContent = {
    "part0005_split_001.xhtml": "part0004.xhtml",
    "part0006_split_001.xhtml": "part0004.xhtml",
  };
  const byToc = {
    "part0005_split_000.xhtml": "part0004.xhtml",
    "part0006_split_000.xhtml": "part0004.xhtml",
  };
  const byBoth = { ...byContent, ...byToc };
  const merged = [byContent, byToc, byBoth].map((merge) => epub.applySpineMerge(book, merge));
  for (const result of merged) {
    assert.deepEqual(result.chapters[0].paragraphs, expected);
    assert.deepEqual(result.chapters[1].paragraphs, book.chapters[1].paragraphs);
    assert.deepEqual(result.extras, []);
  }
  assert.equal(merged[0].chapters[0].html, merged[1].chapters[0].html);
  assert.equal(merged[0].chapters[0].html, merged[2].chapters[0].html);
  assert.equal(merged[0].chapters[0].paragraphs.filter((row) => row === prophecy).length, 1);
  assert.match(merged[0].chapters[0].html, /data-merge-title="1">The Dragonet Prophecy/);
  assert.equal(merged[0].chapters[0].html.includes('data-merge-title="1">Prologue'), false);
  assert.deepEqual(paragraphs(book)[0], ["NightWings", intro]);
  const warnings = epub.spineFileWarnings(
    {
      "part0005_split_001.xhtml": "part0004.xhtml",
      "part0006_split_099.xhtml": "no-such-chapter.xhtml",
    },
    book,
  );
  assert.deepEqual(warnings, [
    'spine.merge key "part0006_split_099.xhtml" does not match a spine item in this book.',
    'spine.merge target "no-such-chapter.xhtml" does not match a spine item in this book.',
  ]);
});

test("an imported list warns about a spine.merge name that is not in the book", async () => {
  const intro = `The island was dark and the tribe was waiting. ${LONG}`;
  const book = await buildEpub({
    title: "NightWings",
    toc: [
      { title: "NightWings", href: "part0004.xhtml" },
      { title: "Chapter One", href: "part0007.xhtml" },
    ],
    spine: [
      { id: "intro", href: "part0004.xhtml" },
      { id: "c01", href: "part0007.xhtml" },
    ],
    files: {
      "part0004.xhtml": `<h1>NightWings</h1><p>${intro}</p>`,
      "part0007.xhtml": `<h1>Chapter One</h1><p>Clay opened his eyes in the cave. ${LONG}</p>`,
    },
  });
  const before = JSON.stringify({
    chapters: book.chapters.map((chapter) => ({
      title: chapter.title,
      paragraphs: chapter.paragraphs,
    })),
    extras: book.extras.map((extra) => ({
      id: extra.id,
      title: extra.title,
      paragraphs: extra.paragraphs,
    })),
  });
  const merge = {
    "part0004.xhtml": "part0007.xhtml",
    "part0006_split_099.xhtml": "no-such-chapter.xhtml",
  };
  assert.deepEqual(epub.importSpineWarnings(merge, book), [
    { kind: "idle", name: "part0004.xhtml" },
    { kind: "key", name: "part0006_split_099.xhtml" },
    { kind: "target", name: "no-such-chapter.xhtml" },
  ]);
  assert.deepEqual(epub.importSpineWarnings({ "part0004.xhtml": "part0007.xhtml" }, book), [
    { kind: "idle", name: "part0004.xhtml" },
  ]);
  assert.deepEqual(epub.spineFileWarnings({ "part0004.xhtml": "part0007.xhtml" }, book), [
    'spine.merge key "part0004.xhtml" matches a spine item but nothing is merged into or from it.',
  ]);
  const merged = epub.applySpineMerge(book, merge);
  assert.equal(
    JSON.stringify({
      chapters: book.chapters.map((chapter) => ({
        title: chapter.title,
        paragraphs: chapter.paragraphs,
      })),
      extras: book.extras.map((extra) => ({
        id: extra.id,
        title: extra.title,
        paragraphs: extra.paragraphs,
      })),
    }),
    before,
  );
  assert.deepEqual(
    merged.chapters.map((chapter) => chapter.paragraphs),
    book.chapters.map((chapter) => chapter.paragraphs),
  );
  assert.deepEqual(
    merged.extras.map((extra) => extra.paragraphs),
    book.extras.map((extra) => extra.paragraphs),
  );
});

test("the glossary check applies spine.merge before notes on a merged chapter", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mw-merge-"));
  const epubPath = join(dir, "book.epub");
  const prophecy = `The dragonets are coming and the sea is rising. ${LONG}`;
  const prologue = `The night was cold before the war began. ${LONG}`;
  const intro = `The island was dark and the tribe was waiting. ${LONG}`;
  const parsed = await buildEpub({
    title: "NightWings",
    writeTo: epubPath,
    toc: [
      { title: "NightWings", href: "part0004.xhtml" },
      { title: "The Dragonet Prophecy", href: "part0005_split_000.xhtml" },
      { title: "Prologue", href: "part0006_split_000.xhtml" },
      { title: "Chapter One", href: "part0007.xhtml" },
    ],
    spine: [
      { id: "intro", href: "part0004.xhtml" },
      { id: "prophecy", href: "part0005_split_000.xhtml" },
      { id: "prophecyb", href: "part0005_split_001.xhtml" },
      { id: "prologue", href: "part0006_split_000.xhtml" },
      { id: "prologueb", href: "part0006_split_001.xhtml" },
      { id: "c01", href: "part0007.xhtml" },
    ],
    files: {
      "part0004.xhtml": `<h1>NightWings</h1><p>${intro}</p>`,
      "part0005_split_000.xhtml": "",
      "part0005_split_001.xhtml": `<p>${prophecy}</p>`,
      "part0006_split_000.xhtml": "",
      "part0006_split_001.xhtml": `<h1>Prologue</h1><p>${prologue}</p>`,
      "part0007.xhtml": `<h1>Chapter One</h1><p>Clay opened his eyes in the cave. ${LONG}</p>`,
    },
  });
  const byContent = {
    "part0005_split_001.xhtml": "part0004.xhtml",
    "part0006_split_001.xhtml": "part0004.xhtml",
  };
  const byBoth = {
    ...byContent,
    "part0005_split_000.xhtml": "part0004.xhtml",
    "part0006_split_000.xhtml": "part0004.xhtml",
  };
  const app = epub.applySpineMerge(parsed, byContent);
  const plain = await readBook(epubPath);
  const fromContent = await readBook(epubPath, { merge: byContent });
  const fromBoth = await readBook(epubPath, { merge: byBoth });
  const paragraphsOf = (book) => book.chapters.map((chapter) => chapter.paragraphs);
  assert.equal(plain.chapters[0].paragraphs.some((row) => row.includes("dragonets")), false);
  assert.deepEqual(paragraphsOf(fromContent), paragraphsOf(app));
  assert.deepEqual(paragraphsOf(fromBoth), paragraphsOf(app));
  assert.deepEqual(
    fromContent.extras.map((extra) => extra.paragraphs),
    app.extras.map((extra) => extra.paragraphs),
  );
  assert.equal(fromContent.chapters[0].paragraphs[2].includes("dragonets"), true);
  const listFor = (merge) => ({
    version: 2,
    title: "NightWings",
    chapters: 2,
    spine: { merge },
    glossary: {
      dragonets: {
        meaning: "Young dragons.",
        senses: [
          {
            meaning: "Young dragons.",
            anchors: [
              {
                chapter: 0,
                occurrence: 1,
                context: "The dragonets are coming and the sea is rising",
              },
            ],
          },
        ],
      },
    },
    paragraphs: [
      {
        chapter: 0,
        paragraph: 2,
        context: "The dragonets are coming and the sea is rising",
        mainIdea: "The young dragons are coming.",
        simple: "The young dragons are coming.",
      },
    ],
    sentences: [
      {
        chapter: 0,
        context: "The dragonets are coming and the sea is rising",
        simple: "The young dragons are coming.",
        grammar: "This sentence has one idea.",
      },
    ],
  });
  try {
    for (const merge of [byContent, byBoth]) {
      const listPath = join(dir, "glossary.json");
      writeFileSync(listPath, JSON.stringify(listFor(merge)));
      const run = spawnSync(
        process.execPath,
        ["scripts/validate-glossary.mjs", "--json", epubPath, listPath],
        { cwd: ROOT, encoding: "utf8" },
      );
      const report = JSON.parse(run.stdout || "{}");
      assert.equal(run.status, 0, `${run.stderr}\n${JSON.stringify(report.errors)}`);
      assert.equal(report.ok, true);
      assert.deepEqual(report.errors, []);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a spine.merge key that matches a chapter but merges nothing warns once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mw-idle-"));
  const epubPath = join(dir, "book.epub");
  const prophecy = `The dragonets are coming and the sea is rising. ${LONG}`;
  const prologue = `The night was cold before the war began. ${LONG}`;
  const intro = `The island was dark and the tribe was waiting. ${LONG}`;
  const chapterThree = `The third chapter stays a numbered chapter. ${LONG}`;
  const book = await buildEpub({
    title: "NightWings",
    writeTo: epubPath,
    toc: [
      { title: "NightWings", href: "part0004.xhtml" },
      { title: "The Dragonet Prophecy", href: "part0005_split_000.xhtml" },
      { title: "Prologue", href: "part0006_split_000.xhtml" },
      { title: "Chapter One", href: "part0007.xhtml" },
      { title: "Chapter Three", href: "part0007_split_003.html" },
    ],
    spine: [
      { id: "intro", href: "part0004.xhtml" },
      { id: "prophecy", href: "part0005_split_000.xhtml" },
      { id: "prophecyb", href: "part0005_split_001.xhtml" },
      { id: "prologue", href: "part0006_split_000.xhtml" },
      { id: "prologueb", href: "part0006_split_001.xhtml" },
      { id: "c01", href: "part0007.xhtml" },
      { id: "c03", href: "part0007_split_003.html" },
    ],
    files: {
      "part0004.xhtml": `<h1>NightWings</h1><p>${intro}</p>`,
      "part0005_split_000.xhtml": "",
      "part0005_split_001.xhtml": `<p>${prophecy}</p>`,
      "part0006_split_000.xhtml": "",
      "part0006_split_001.xhtml": `<h1>Prologue</h1><p>${prologue}</p>`,
      "part0007.xhtml": `<h1>Chapter One</h1><p>Clay opened his eyes in the cave. ${LONG}</p>`,
      "part0007_split_003.html": `<h1>Chapter Three</h1><p>${chapterThree}</p>`,
    },
  });
  const dual = {
    "part0005_split_000.xhtml": "part0004.xhtml",
    "part0005_split_001.xhtml": "part0004.xhtml",
    "part0006_split_000.xhtml": "part0004.xhtml",
    "part0006_split_001.xhtml": "part0004.xhtml",
  };
  const idleKey = "part0007_split_003.html";
  const missingKey = "part9999_split_000.html";
  const withIdle = { ...dual, [idleKey]: "part0004.xhtml" };
  const withMissing = { ...dual, [missingKey]: "part0004.xhtml" };
  const idleText = `spine.merge key "${idleKey}" matches a spine item but nothing is merged into or from it.`;
  const missingText = `spine.merge key "${missingKey}" does not match a spine item in this book.`;
  assert.deepEqual(epub.importSpineWarnings(dual, book), []);
  assert.deepEqual(epub.spineFileWarnings(dual, book), []);
  assert.deepEqual(epub.importSpineWarnings(withIdle, book), [{ kind: "idle", name: idleKey }]);
  assert.deepEqual(epub.spineFileWarnings(withIdle, book), [idleText]);
  assert.deepEqual(epub.importSpineWarnings(withMissing, book), [{ kind: "key", name: missingKey }]);
  assert.deepEqual(epub.spineFileWarnings(withMissing, book), [missingText]);
  assert.deepEqual(epub.importSpineWarnings({ ...withIdle, [missingKey]: "part0004.xhtml" }, book), [
    { kind: "idle", name: idleKey },
    { kind: "key", name: missingKey },
  ]);
  assert.deepEqual(epub.importSpineWarnings({ ...dual, "part0004.xhtml": "part0004.xhtml" }, book), []);
  const merged = epub.applySpineMerge(book, dual);
  const mergedIdle = epub.applySpineMerge(book, withIdle);
  const paragraphsOf = (item) => item.chapters.map((chapter) => chapter.paragraphs);
  assert.deepEqual(paragraphsOf(mergedIdle), paragraphsOf(merged));
  assert.equal(mergedIdle.chapters[0].html, merged.chapters[0].html);
  assert.deepEqual(mergedIdle.extras, merged.extras);
  assert.equal(merged.chapters[0].paragraphs.some((row) => row.includes("dragonets")), true);
  assert.equal(mergedIdle.chapters.at(-1).paragraphs[1], chapterThree);
  const fromDual = await readBook(epubPath, { merge: dual });
  const fromIdle = await readBook(epubPath, { merge: withIdle });
  const fromMissing = await readBook(epubPath, { merge: withMissing });
  assert.deepEqual(fromDual.spineWarnings, []);
  assert.deepEqual(fromIdle.spineWarnings, [idleText]);
  assert.deepEqual(fromMissing.spineWarnings, [missingText]);
  assert.deepEqual(paragraphsOf(fromIdle), paragraphsOf(fromDual));
  assert.deepEqual(paragraphsOf(fromDual), paragraphsOf(merged));
  const listFor = (merge) => ({
    version: 2,
    title: "NightWings",
    chapters: 3,
    spine: { merge },
    glossary: {
      dragonets: {
        meaning: "Young dragons.",
        senses: [
          {
            meaning: "Young dragons.",
            anchors: [
              {
                chapter: 0,
                occurrence: 1,
                context: "The dragonets are coming and the sea is rising",
              },
            ],
          },
        ],
      },
    },
  });
  const spineLines = (report) => (report.warnings ?? []).filter((line) => String(line).startsWith("spine.merge"));
  try {
    for (const [merge, expected] of [
      [dual, []],
      [withIdle, [idleText]],
      [withMissing, [missingText]],
    ]) {
      const listPath = join(dir, "glossary.json");
      writeFileSync(listPath, JSON.stringify(listFor(merge)));
      const run = spawnSync(
        process.execPath,
        ["scripts/validate-glossary.mjs", "--json", epubPath, listPath],
        { cwd: ROOT, encoding: "utf8" },
      );
      const report = JSON.parse(run.stdout || "{}");
      assert.equal(run.status, 0, `${run.stderr}\n${JSON.stringify(report.errors)}`);
      assert.deepEqual(report.errors, []);
      assert.deepEqual(spineLines(report), expected);
      assert.equal(
        (report.warnings ?? []).some((line) => String(line).includes("context is very short")),
        false,
      );
    }
    const shortOf = (merge) => ({
      version: 2,
      title: "NightWings",
      chapters: 3,
      ...(merge ? { spine: { merge } } : {}),
      glossary: {
        island: {
          meaning: "Land with water all around it.",
          senses: [
            {
              meaning: "Land with water all around it.",
              anchors: [{ chapter: 0, context: "The island" }],
            },
          ],
        },
      },
    });
    const shortLines = async (merge) => {
      const listPath = join(dir, "glossary.json");
      writeFileSync(listPath, JSON.stringify(shortOf(merge)));
      const run = spawnSync(
        process.execPath,
        ["scripts/validate-glossary.mjs", "--json", epubPath, listPath],
        { cwd: ROOT, encoding: "utf8" },
      );
      const report = JSON.parse(run.stdout || "{}");
      assert.equal(run.status, 0, `${run.stderr}\n${JSON.stringify(report.errors)}`);
      return (report.warnings ?? []).filter((line) => String(line).includes("context is very short"));
    };
    const shortWithoutMerge = await shortLines(null);
    const shortWithMerge = await shortLines(dual);
    assert.equal(shortWithoutMerge.length, 1);
    assert.deepEqual(shortWithMerge, shortWithoutMerge);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("front-matter contents entries leave the following files as separate extras", async () => {
  const praise = `Here's what kids have to say about this story and its author. ${LONG}`;
  const more = `More praise from readers who loved the book. ${LONG}`;
  const listed = `The contents page lists every chapter of the story in order. ${LONG}`;
  const prophecy = `The dragonets are coming and the sea is rising. ${LONG}`;
  const book = await buildEpub({
    title: "Praise",
    toc: [
      { title: "Cover", href: "titlepage.xhtml" },
      { title: "Chapter One", href: "c01.xhtml" },
      { title: "Copyright", href: "copyright.xhtml" },
      { title: "Contents", href: "contents-empty.xhtml" },
      { title: "The Dragonet Prophecy", href: "prophecy.xhtml" },
      { title: "Chapter Two", href: "c02.xhtml" },
    ],
    spine: [
      { id: "cover", href: "titlepage.xhtml" },
      { id: "jacket", href: "jacket.xhtml" },
      { id: "fm1", href: "fm1.xhtml" },
      { id: "fm2", href: "fm2.xhtml" },
      { id: "c01", href: "c01.xhtml" },
      { id: "copy", href: "copyright.xhtml" },
      { id: "contentsempty", href: "contents-empty.xhtml" },
      { id: "contents", href: "contents.xhtml" },
      { id: "prophecy", href: "prophecy.xhtml" },
      { id: "prophecyb", href: "prophecy-body.xhtml" },
      { id: "c02", href: "c02.xhtml" },
    ],
    files: {
      "titlepage.xhtml": "",
      "jacket.xhtml": `<p>The jacket blurb sits on its own page. ${LONG}</p>`,
      "fm1.xhtml": `<p>${praise}</p>`,
      "fm2.xhtml": `<p>${more}</p>`,
      "c01.xhtml": `<h1>Chapter One</h1><p>The first chapter stays chapter zero. ${LONG}</p>`,
      "copyright.xhtml": "",
      "contents-empty.xhtml": "",
      "contents.xhtml": `<p>${listed}</p>`,
      "prophecy.xhtml": "",
      "prophecy-body.xhtml": `<p>${prophecy}</p>`,
      "c02.xhtml": `<h1>Chapter Two</h1><p>The second chapter stays chapter one. ${LONG}</p>`,
    },
  });
  assert.deepEqual(
    book.chapters.map((chapter) => chapter.title),
    ["Chapter One", "Chapter Two"],
  );
  assert.deepEqual(book.chapters[0].paragraphs, [
    "Chapter One",
    `The first chapter stays chapter zero. ${LONG}`,
  ]);
  assert.deepEqual(
    book.extras.map((item) => [item.id, item.title, item.fromToc ?? false, item.href.split("/").pop()]),
    [
      ["x0", "", false, "jacket.xhtml"],
      ["x1", "", false, "fm1.xhtml"],
      ["x2", "", false, "fm2.xhtml"],
      ["x3", "", false, "contents.xhtml"],
      ["x4", "The Dragonet Prophecy", true, "prophecy.xhtml"],
    ],
  );
  assert.deepEqual(book.extras[1].paragraphs, [praise]);
  assert.deepEqual(book.extras[2].paragraphs, [more]);
  assert.deepEqual(book.extras[3].paragraphs, [listed]);
  assert.deepEqual(book.extras[4].paragraphs, [prophecy]);
  assert.equal(book.extras.some((item) => item.title === "Cover" || item.title === "Copyright" || item.title === "Contents"), false);
});

test("front matter and a missed later file stay extras and keep contents chapters", async () => {
  const book = await buildEpub({
    title: "Matter",
    toc: [
      { title: "Dedication", href: "ded.xhtml" },
      { title: "Chapter One", href: "c01.xhtml" },
      { title: "A Note", href: "note.xhtml" },
      { title: "Preview", href: "preview.xhtml" },
    ],
    spine: [
      { id: "fm", href: "fm1.xhtml" },
      { id: "ded", href: "ded.xhtml" },
      { id: "epi", href: "epi.xhtml" },
      { id: "c01", href: "c01.xhtml" },
      { id: "ad", href: "ad.xhtml" },
      { id: "note", href: "note.xhtml" },
      { id: "ada", href: "ada.xhtml" },
      { id: "pre", href: "preview.xhtml" },
      { id: "later", href: "c15.xhtml" },
    ],
    files: {
      "fm1.xhtml": `<h1>What Kids Say</h1><p>The front matter is an extra page and does not move the dedication. ${LONG}</p>`,
      "ded.xhtml": `<h1>Dedication</h1><p>For a friend who stays chapter zero in this book. ${LONG}</p>`,
      "epi.xhtml": `<p>The epigraph stays an extra and does not become chapter one. ${LONG}</p>`,
      "c01.xhtml": `<h1>Chapter One</h1><p>The first story chapter keeps its place and its paragraphs. ${LONG}</p>`,
      "ad.xhtml": `<p>This unlisted page must stay out of every chapter. ${LONG}</p>`,
      "note.xhtml": `<h1>A Note</h1><p>The note stays the chapter it was before the extra files. ${LONG}</p>`,
      "ada.xhtml": `<p>The author page stays an extra between the note and the preview. ${LONG}</p>`,
      "preview.xhtml": `<h1>Preview</h1><p>The preview keeps the chapter number it had in the contents. ${LONG}</p>`,
      "c15.xhtml": `<h1>After the Note</h1><p>The file after the last contents entry stays an extra at the end. ${LONG}</p>`,
    },
  });
  assert.deepEqual(
    book.chapters.map((chapter) => chapter.title),
    ["Dedication", "Chapter One", "A Note", "Preview"],
  );
  assert.deepEqual(paragraphs(book)[0], [
    "Dedication",
    `For a friend who stays chapter zero in this book. ${LONG}`,
  ]);
  assert.deepEqual(paragraphs(book)[1], [
    "Chapter One",
    `The first story chapter keeps its place and its paragraphs. ${LONG}`,
  ]);
  assert.deepEqual(paragraphs(book)[2], [
    "A Note",
    `The note stays the chapter it was before the extra files. ${LONG}`,
  ]);
  assert.deepEqual(paragraphs(book)[3], [
    "Preview",
    `The preview keeps the chapter number it had in the contents. ${LONG}`,
  ]);
  assert.deepEqual(
    book.extras.map((item) => item.href.split("/").pop()),
    ["fm1.xhtml", "epi.xhtml", "ad.xhtml", "ada.xhtml", "c15.xhtml"],
  );
  const joined = paragraphs(book).flat().join("\n");
  assert.equal(joined.includes("must stay out"), false);
  assert.equal(joined.includes("epigraph stays"), false);
  const slots = epub.readingSlots(book);
  assert.equal(slots[0].kind, "extra");
  assert.equal(slots[1].kind, "chapter");
  assert.equal(slots[1].index, 0);
});

test("bundled classics keep the same chapter and paragraph text", async () => {
  const ids = readdirSync(join(ROOT, "public-books")).filter((name) => PUBLIC_PARAGRAPHS[name]);
  assert.equal(ids.length, Object.keys(PUBLIC_PARAGRAPHS).length);
  for (const id of ids) {
    const bytes = readFileSync(join(ROOT, "public-books", id, "book.epub"));
    const book = await epub.parseEpub(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
      cover: false,
    });
    const payload = book.chapters.map((chapter) => ({ title: chapter.title, paragraphs: chapter.paragraphs }));
    const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    assert.equal(hash, PUBLIC_PARAGRAPHS[id], id);
  }
});
