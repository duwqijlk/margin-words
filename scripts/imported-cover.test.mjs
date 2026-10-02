/**
 * An imported EPUB with no OPF cover tag: use a word-list catalog cover when the
 * book matches one, otherwise a portrait image at the start of the first spine
 * document, otherwise the generated cover. A tagged cover stays the tagged cover.
 */
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { test } from "node:test";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAppModules } from "./lib/app-modules.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));
const JSZip = require("jszip");
const { epub, meta } = await loadAppModules();

function crc32(bytes) {
  let c = ~0;
  for (const byte of bytes) {
    c ^= byte;
    for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const body = Buffer.concat([name, data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  name.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

/** A real PNG of the given size. Black pixels. Big enough for the cover size check. */
function png(width, height) {
  const raw = Buffer.alloc((1 + width * 3) * height);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const PORTRAIT = png(40, 70);
const LANDSCAPE = png(70, 40);
const SQUARE = png(48, 48);
const TAGGED = png(30, 80);

function page(title, body) {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body>
${body}
</body></html>`;
}

const STORY =
  "<p>She smiled at the lantern and walked the long road home before dark, telling the whole story to her friend by the river.</p>";

/**
 * @param {"portrait" | "landscape" | "square" | "after-text" | "tagged" | "guide"} kind
 */
async function build(kind) {
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
  const manifest = [
    `<item id="ch1" href="untitled.html" media-type="application/xhtml+xml"/>`,
  ];
  let guide = "";
  let metaCover = "";
  if (kind === "tagged") {
    manifest.push(`<item id="coverimg" href="cover.png" media-type="image/png"/>`);
    metaCover = `<meta name="cover" content="coverimg"/>`;
    add("OEBPS/cover.png", TAGGED);
  }
  if (kind === "guide") {
    manifest.push(`<item id="gimg" href="images/guide.png" media-type="image/png"/>`);
    guide = `<guide><reference type="cover" title="Cover" href="images/guide.png"/></guide>`;
    add("OEBPS/images/guide.png", TAGGED);
  }
  const picture =
    kind === "landscape" ? LANDSCAPE : kind === "square" ? SQUARE : PORTRAIT;
  manifest.push(`<item id="pic" href="image.001.png" media-type="image/png"/>`);
  add("OEBPS/image.001.png", picture);
  add(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:cover-fallback</dc:identifier>
    <dc:title>Ghost Town</dc:title>
    <dc:creator>Mary Pope Osborne</dc:creator>
    <dc:language>en</dc:language>
    ${metaCover}
  </metadata>
  <manifest>
    ${manifest.join("\n")}
  </manifest>
  <spine><itemref idref="ch1"/></spine>
  ${guide}
</package>`,
  );
  const img = `<img src="image.001.png" alt=""/>`;
  const body =
    kind === "after-text"
      ? `<p>She smiled at the lantern and walked the long road home before dark, telling the whole story to her friend.</p>${img}`
      : `${img}${STORY}`;
  add("OEBPS/untitled.html", page("Ghost Town", body));
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  return epub.parseEpub(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

function pngSize(dataUrl) {
  assert.equal(typeof dataUrl, "string");
  const bytes = Uint8Array.from(Buffer.from(String(dataUrl).split(",")[1], "base64"));
  return epub.imagePixelSize(bytes);
}

test("a portrait image before the text becomes the cover", async () => {
  const book = await build("portrait");
  assert.equal(book.coverTagged, false);
  assert.deepEqual(pngSize(book.cover), { width: 40, height: 70 });
});

test("a landscape image, a square image, and an image after the paragraph stay untagged", async () => {
  for (const kind of ["landscape", "square", "after-text"]) {
    const book = await build(kind);
    assert.equal(book.cover, null, kind);
    assert.equal(book.coverTagged, false, kind);
  }
});

test("an OPF cover tag and a guide cover win over the spine image", async () => {
  for (const kind of ["tagged", "guide"]) {
    const book = await build(kind);
    assert.equal(book.coverTagged, true, kind);
    assert.deepEqual(pngSize(book.cover), { width: 30, height: 80 }, kind);
  }
});

test("catalog cover, then the spine image, then nothing", () => {
  assert.equal(epub.importedCoverChoice("tagged", "catalog", "spine"), "tagged");
  assert.equal(epub.importedCoverChoice("", "catalog", "spine"), "catalog");
  assert.equal(epub.importedCoverChoice("", "", "spine"), "spine");
  assert.equal(epub.importedCoverChoice("", "", ""), "");
});

test("a word-list entry matches by ISBN, then by title and author", () => {
  const lists = [
    { title: "Ghost Town", author: "Mary Pope Osborne", isbn: "9780141960616", cover: "catalog" },
    { title: "Other Town", author: "Someone Else", isbn: "9780000000002", cover: "other" },
  ];
  assert.equal(meta.matchWordListPack(lists, { title: "Wrong", author: "No", isbn: "978-0-141-96061-6" })?.cover, "catalog");
  assert.equal(
    meta.matchWordListPack(lists, { title: "Ghost Town!", author: "Mary Pope Osborne", isbn: "" })?.cover,
    "catalog",
  );
  assert.equal(meta.matchWordListPack(lists, { title: "Ghost Town", author: "Someone Else", isbn: "" }), null);
  assert.equal(meta.matchWordListPack(lists, { title: "Missing", author: "", isbn: "" }), null);
});
