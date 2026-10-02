/**
 * Line breaks (<br/>) in the book html. The words on both sides of a break are separate words and are
 * separated by ONE space in the reading text; the chapter, paragraph and word numbers do not change; a
 * stored example whose words were glued at a break by an older reader still finds its place.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAppModules } from "./lib/app-modules.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JSZip = createRequire(join(ROOT, "package.json"))("jszip");
const { epub, format, help, edition, flow } = await loadAppModules();

const POEM =
  "<p>The tide came in to the real<br/>and the sea went out the<br/>window of the sealskin<br/>clothing that she wore.</p>";
const PLAIN = "<p>She smiled at the lantern and walked the long road home before dark.</p>";
const COPYRIGHT =
  "<p>Text copyright by Mary Pope Osborne with love<br/>Magic Tree House is a registered mark of Mary Pope<br />Osborne and Salvatore Murdocca.</p>";

async function build(body) {
  const date = new Date("2026-01-01T00:00:00Z");
  const zip = new JSZip();
  const add = (name, data) => zip.file(name, data, { date, createFolders: false, compression: "DEFLATE" });
  add("mimetype", "application/epub+zip");
  add(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  add(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:uuid:br-test</dc:identifier><dc:title>Break Test</dc:title><dc:creator>Test Author</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="ch1" href="ch1.html" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/></spine></package>`,
  );
  add(
    "OEBPS/ch1.html",
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body>${body}</body></html>`,
  );
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  return epub.parseEpub(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { cover: false });
}

const parse = (html) => new DOMParser().parseFromString(html, "text/html");

test("a line break is one space in the paragraph text the reader stores", async () => {
  const book = await build(`${PLAIN}${POEM}${COPYRIGHT}`);
  const paragraphs = book.chapters[0].paragraphs;
  assert.equal(paragraphs.length, 3);
  assert.match(paragraphs[1], /to the real and the sea went out the window of the sealskin clothing that she wore\./);
  assert.doesNotMatch(paragraphs[1], /realand|outthe|sealskinclothing/);
  assert.match(paragraphs[2], /with love Magic Tree House is a registered mark of Mary Pope Osborne and Salvatore/);
  assert.doesNotMatch(paragraphs[2], /loveMagic|PopeOsborne/);
});

test("spaces and a break together still make one space", async () => {
  const book = await build(`<p>Alpha beta gamma <br/> delta epsilon zeta<br/>\n  eta theta iota.</p>`);
  assert.equal(book.chapters[0].paragraphs[0], "Alpha beta gamma delta epsilon zeta eta theta iota.");
});

test("a break does not change the word numbers or the paragraph numbers", async () => {
  const withBreaks = await build(`${PLAIN}${POEM}${PLAIN}`);
  const spaced = await build(`${PLAIN}${POEM.replaceAll("<br/>", " ")}${PLAIN}`);
  const a = format.indexChapterHtml(withBreaks.chapters[0].html, parse);
  const b = format.indexChapterHtml(spaced.chapters[0].html, parse);
  assert.deepEqual(a.tokens, b.tokens);
  assert.deepEqual(a.blocks, b.blocks);
  assert.equal(a.blocks.length, withBreaks.chapters[0].paragraphs.length);
  const words = a.tokens.filter((t) => t.b === 1).map((t) => t.w);
  const at = words.indexOf("real");
  assert.deepEqual(words.slice(at, at + 4), ["real", "and", "the", "sea"]);
  const root = parse(`<div>${withBreaks.chapters[0].html}</div>`).body;
  assert.equal(help.paragraphBlocks(root).length, withBreaks.chapters[0].paragraphs.length);
});

test("the paragraph of a block, and the text before a word, use the same spacing", async () => {
  const book = await build(`${POEM}`);
  const doc = parse(`<div>${book.chapters[0].html}</div>`);
  const block = doc.querySelector("p");
  const text = format.indexChapterHtml(book.chapters[0].html, parse).blocks[0];
  assert.equal(text, "The tide came in to the real and the sea went out the window of the sealskin clothing that she wore.");
  const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) if (node.data.startsWith("and the sea")) break;
  const before = flow.flowTextBefore(block, node, 0);
  assert.equal(before, "The tide came in to the real ");
  assert.equal(text.startsWith(before), true);
});

/** Underlined places of a senseOnly word, read back from the html the reader makes. */
function hits(html, word, anchors) {
  const list = { [word]: { senseOnly: true, senses: [{ meaning: "x", anchors }] } };
  const ready = new Set([word]);
  const sparse = new Map(Object.entries(list));
  const out = format.readingHtml(html, ready, (s) => s.toLowerCase(), 0, sparse);
  return [...parse(`<div>${out}</div>`).querySelectorAll("button.book-hard")].map((b) => Number(b.dataset.n));
}

test("an example stored with glued words ('realand') still finds its place", async () => {
  const book = await build(`${PLAIN}${POEM}`);
  const html = book.chapters[0].html;
  const glued = "came in to the realand the sea went out";
  const spaced = "came in to the real and the sea went out";
  assert.equal(hits(html, "sea", [{ context: spaced }]).length, 1);
  assert.equal(hits(html, "sea", [{ context: glued }]).length, 1);
  assert.equal(hits(html, "sea", [{ chapter: 0, occurrence: 1, context: glued }]).length, 1);
  // a glued example does not make the word match somewhere else
  assert.equal(hits(html, "sea", [{ context: "sea went out the windowof the sealskin" }]).length, 1);
  assert.equal(hits(html, "tide", [{ context: glued }]).length, 0);
  assert.equal(hits(html, "sea", [{ context: "totally different words sea here" }]).length, 0);
});

test("a glued example only counts around the word that was tapped", async () => {
  const body = `<p>The sea was calm and the real<br/>and the sea was wide and blue that day.</p>`;
  const book = await build(body);
  const html = book.chapters[0].html;
  const first = hits(html, "sea", [{ context: "calm and the realand the sea was wide" }]);
  assert.deepEqual(first, [2]);
});

test("paragraph and sentence help written with glued words still match", () => {
  const text = "The tide came in to the real and the sea went out the window of the sealskin clothing that she wore.";
  const glued = "came in to the realand the sea went out the window";
  assert.equal(help.containsContext(text, glued), true);
  const paragraph = { chapter: 0, paragraph: 3, context: glued, title: "t" };
  assert.equal(help.pickParagraphHelp([paragraph], 0, 1, text), paragraph);
  const sentence = { chapter: 0, context: "the window of the sealskinclothing that she wore" };
  assert.equal(help.pickSentenceHelp([sentence], 0, text), sentence);
  assert.equal(help.containsContext(text, "an unrelated line of words"), false);
  assert.equal(help.containsContext(text, "tide"), true);
  assert.equal(help.containsContext("realand", "real and"), false, "short snippets must match whole words");
});

test("a book with glued examples is still found by the edition check", async () => {
  const book = await build(`${PLAIN}${POEM}`);
  const result = edition.editionMatch(
    { paragraphs: [{ chapter: 0, paragraph: 1, context: "came in to the realand the sea went out" }], sentences: [] },
    book.chapters[0].paragraphs,
  );
  assert.equal(result.found, 1);
});

test("the checker finds a glued example in the book", async () => {
  const book = await build(`${PLAIN}${POEM}`);
  const chapters = [format.indexChapterHtml(book.chapters[0].html, parse)];
  const file = {
    glossary: {
      sea: { senses: [{ meaning: "x", anchors: [{ chapter: 0, occurrence: 1, context: "the realand the sea went out the" }] }] },
    },
  };
  const result = format.checkAgainstBook(file, chapters, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.missing, 0);
});
