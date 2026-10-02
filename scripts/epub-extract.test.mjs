/**
 * Spine continuations, drop caps, and accented words.
 * Chapter and paragraph text for books whose contents list already matches the spine
 * must stay byte-for-byte the same (the hashes below were taken before these fixes).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAppModules } from "./lib/app-modules.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));
const JSZip = require("jszip");
const { epub, format, help, flow } = await loadAppModules();

const LONG = "This sentence is long enough to stand alone as its own paragraph in the reader.";

function page(title, body) {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body>
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
    const points = (spec.ncx ?? [])
      .map(
        (item, index) => `<navPoint id="n${index}"><navLabel><text>${item.title}</text></navLabel><content src="${item.href}"/></navPoint>`,
      )
      .join("");
    add(
      "OEBPS/toc.ncx",
      `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>${points}</navMap></ncx>`,
    );
  }
  if (spec.encryption) add("META-INF/encryption.xml", spec.encryption);
  for (const [href, body] of Object.entries(spec.files)) {
    add(`OEBPS/${href}`, page(href, body));
  }
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  return epub.parseEpub(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
    cover: false,
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
  assert.deepEqual(book.chapters.map((chapter) => chapter.title), ["File A", "File B", "File C"]);
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
