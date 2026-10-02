/**
 * Soft hyphens (U+00AD) and in-word zero-width marks must not split a glossary word,
 * and they must not change chapter or paragraph numbers.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAppModules } from "./lib/app-modules.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));
const JSZip = require("jszip");
const { epub, format, help, edition } = await loadAppModules();

const SHY = "\u00AD";
const ZWSP = "\u200B";
const WJ = "\u2060";

test("stripWordBreaks joins a split word and keeps a normal hyphen", () => {
  assert.equal(format.stripWordBreaks(`mys${SHY}teriously`), "mysteriously");
  assert.equal(format.stripWordBreaks(`nick${ZWSP}name`), "nickname");
  assert.equal(format.stripWordBreaks(`pil${WJ}low`), "pillow");
  assert.equal(format.stripWordBreaks(`don${ZWSP}'t`), "don't");
  assert.equal(format.stripWordBreaks("well-known"), "well-known");
  assert.equal(format.stripWordBreaks("good-\u2014night"), "good-\u2014night");
  assert.equal(format.normText(`She smiled mys${SHY}teriously.`), "she smiled mysteriously.");
  assert.equal(
    help.looseText(`smiled mys${SHY}teriously at her nick${ZWSP}name`),
    "smiled mysteriously at her nickname",
  );
});

/** The real EPUB shape: each half, and the soft hyphen, is its own span. */
const SPAN_SHY =
  '<span style="color:#111">She smiled mys</span><span style="color:#222">&#xad;</span><span style="color:#333">teriously</span>';
/** Nested spans around the halves, which the sibling-span join must also cover. */
const NESTED_SHY =
  '<span style="color:#111">A <span style="color:#222">rattle</span></span><span style="color:#333">&#xad;</span><span style="color:#444"><span style="color:#555">snake</span> slept</span>';

function chapterHtml(shy) {
  const goodNight = shy ? "good-&#x00AD;night" : "good-night";
  const doesnt = shy ? "doesn&#x200B;'t" : "doesn't";
  const first = shy
    ? `<p>${SPAN_SHY} at her <span style="color:#444">nick</span><span style="color:#555">&#xad;</span><span style="color:#666">name</span> on the old <span style="color:#777">pil</span><span style="color:#888">&#x200B;</span><span style="color:#999">low</span> and folded the warm <span style="color:#111"><span style="color:#222">blan</span></span><span style="color:#333">&#x2060;</span><span style="color:#444"><span style="color:#555">ket</span></span>. ${NESTED_SHY}.</p>`
    : "<p>She smiled mysteriously at her nickname on the old pillow and folded the warm blanket. A rattlesnake slept.</p>";
  const second = shy
    ? `<p>The <span style="color:#111">well-</span><span style="color:#222">&#xad;</span><span style="color:#333">known</span> road was a ${goodNight} walk and she ${doesnt} hurry under the stars tonight. Say <span style="color:#111">hello</span> <span style="color:#222">world</span>.</p>`
    : "<p>The well-known road was a good-night walk and she doesn't hurry under the stars tonight. Say hello world.</p>";
  return [
    "<h1>The Fair</h1>",
    first,
    second,
    "<p>* * *</p>",
    "<blockquote><p>A quiet line sits inside this quote and it stays one paragraph.</p></blockquote>",
  ].join("\n");
}

const CHAPTER_TWO =
  "<h1>The Road</h1>\n<p>She walked the long road home and told the whole story to her friend by the river before dark.</p>";

async function buildEpub(shy) {
  const date = new Date("2026-01-01T00:00:00Z");
  const zip = new JSZip();
  const add = (name, data) =>
    zip.file(name, data, { date, createFolders: false, compression: "DEFLATE" });
  add("mimetype", "application/epub+zip");
  add(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );
  add(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:soft-hyphen-test</dc:identifier>
    <dc:title>Soft Hyphen Story</dc:title>
    <dc:creator>A. Sample Writer</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`,
  );
  const nav = (title, href) => `<li><a href="${href}">${title}</a></li>`;
  add(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><ol>
${nav("The Fair", "chapter1.xhtml")}
${nav("The Road", "chapter2.xhtml")}
</ol></nav></body></html>`,
  );
  const page = (title, body) =>
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body>
${body}
</body></html>`;
  add("OEBPS/chapter1.xhtml", page("The Fair", chapterHtml(shy)));
  add("OEBPS/chapter2.xhtml", page("The Road", CHAPTER_TWO));
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  return epub.parseEpub(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
    cover: false,
  });
}

function shape(book) {
  const parse = (html) => new DOMParser().parseFromString(html, "text/html");
  return {
    titles: book.chapters.map((c) => c.title),
    paragraphs: book.chapters.map((c) => c.paragraphs),
    tokens: book.chapters.map((c) => format.indexChapterHtml(c.html, parse).tokens),
  };
}

function underlined(html) {
  const ready = new Set(["mysteriously", "nickname", "pillow", "blanket", "rattlesnake"]);
  const out = format.readingHtml(html, ready, (surface) => surface.toLowerCase(), 0, new Map());
  const doc = new DOMParser().parseFromString(`<div>${out}</div>`, "text/html");
  return [...doc.querySelectorAll("button.book-hard")].map((b) => ({
    word: b.textContent,
    nth: Number(b.dataset.n),
  }));
}

const plain = await buildEpub(false);
const shy = await buildEpub(true);

test("chapter and paragraph numbers match with and without soft hyphens", () => {
  const a = shape(plain);
  const b = shape(shy);
  assert.deepEqual(b.titles, a.titles);
  assert.deepEqual(b.paragraphs, a.paragraphs);
  assert.deepEqual(b.tokens, a.tokens);
  assert.equal(a.paragraphs.length, 2);
  assert.deepEqual(
    a.paragraphs[0].map((p) => p.split(" ").slice(0, 4).join(" ")),
    ["The Fair", "She smiled mysteriously at", "The well-known road was", "A quiet line sits"],
  );
  const text = a.paragraphs[0].join("\n");
  assert.match(text, /well-known/);
  assert.match(text, /good-night/);
  assert.equal(text.includes(SHY), false);
  assert.equal(text.includes(ZWSP), false);
  assert.equal(text.includes(WJ), false);
  const forms = a.tokens[0].map((t) => t.w);
  assert.equal(forms.filter((w) => w === "mysteriously").length, 1);
  assert.equal(forms.includes("mys"), false);
  assert.equal(forms.includes("teriously"), false);
  assert.ok(forms.includes("well") && forms.includes("known"));
  assert.equal(forms.includes("wellknown"), false);
  assert.ok(forms.includes("good") && forms.includes("night"));
  assert.equal(forms.filter((w) => w === "doesn't").length, 1);
  assert.equal(forms.filter((w) => w === "rattlesnake").length, 1);
  assert.equal(forms.includes("rattle"), false);
  assert.equal(forms.includes("snake"), false);
  assert.ok(forms.includes("hello") && forms.includes("world"));
  assert.equal(forms.includes("helloworld"), false);
});

test("separate spans around &#xad; become one word button", () => {
  const parse = (html) => new DOMParser().parseFromString(html, "text/html");
  const raw = `<div>${SPAN_SHY}. ${NESTED_SHY}.</div>`;
  const tokens = format.indexChapterHtml(raw, parse).tokens.map((t) => t.w);
  assert.deepEqual(
    tokens.filter((w) => ["mysteriously", "mys", "teriously", "rattlesnake", "rattle", "snake"].includes(w)),
    ["mysteriously", "rattlesnake"],
  );
  const shown = format.readingHtml(raw, new Set(["mysteriously", "rattlesnake"]), (s) => s.toLowerCase(), 0, new Map());
  const doc = new DOMParser().parseFromString(`<div>${shown}</div>`, "text/html");
  const buttons = [...doc.querySelectorAll("button")].map((b) => b.textContent);
  assert.deepEqual(
    buttons.filter((w) => w === "mysteriously"),
    ["mysteriously"],
  );
  assert.deepEqual(
    buttons.filter((w) => w === "rattlesnake"),
    ["rattlesnake"],
  );
  assert.equal(buttons.includes("mys"), false);
  assert.equal(buttons.includes("teriously"), false);
  // The same markup, after the EPUB reader stores the chapter, is one token too.
  const stored = format.indexChapterHtml(shy.chapters[0].html, parse).tokens.map((t) => t.w);
  assert.equal(stored.filter((w) => w === "mysteriously").length, 1);
  assert.equal(stored.includes("mys"), false);
});

test("a line break between the soft-hyphen spans is still one word", () => {
  const parse = (html) => new DOMParser().parseFromString(html, "text/html");
  // Pretty-printed chapters put a newline between the three spans. The checker that
  // verified the book joins across that newline; a space in the sentence stays apart.
  const pretty = [
    '<p><span style="color:#111">She smiled mys</span>',
    '<span style="color:#222">&shy;</span>',
    '<span style="color:#333">teriously</span> at her <span>nick</span>',
    '<span>&#173;</span>',
    '<span>name</span> on the <span>pil</span>',
    '<span>&#xad;</span>',
    '<span>low</span>. A <span>rattle</span>',
    '<span>&#xad;</span>',
    '<span>snake</span> slept.</p>',
  ].join("\n");
  const tokens = format.indexChapterHtml(pretty, parse).tokens.map((t) => t.w);
  for (const word of ["mysteriously", "nickname", "pillow", "rattlesnake"]) {
    assert.equal(tokens.filter((w) => w === word).length, 1, word);
  }
  for (const half of ["mys", "teriously", "nick", "name", "pil", "low", "rattle", "snake"]) {
    assert.equal(tokens.includes(half), false, half);
  }
  const shown = format.readingHtml(
    pretty,
    new Set(["mysteriously", "nickname", "pillow", "rattlesnake"]),
    (s) => s.toLowerCase(),
    0,
    new Map(),
  );
  const doc = new DOMParser().parseFromString(`<div>${shown}</div>`, "text/html");
  const buttons = [...doc.querySelectorAll("button")].map((b) => b.textContent);
  assert.deepEqual(
    buttons.filter((w) => w === "mysteriously" || w === "rattlesnake" || w === "nickname" || w === "pillow"),
    ["mysteriously", "nickname", "pillow", "rattlesnake"],
  );
  const spaced = "<p><span>hello</span>\n<span>world</span>. Say <span>cat</span> <span>dog</span>.</p>";
  const spacedWords = format.indexChapterHtml(spaced, parse).tokens.map((t) => t.w);
  assert.ok(spacedWords.includes("hello") && spacedWords.includes("world"));
  assert.equal(spacedWords.includes("helloworld"), false);
  assert.ok(spacedWords.includes("cat") && spacedWords.includes("dog"));
  assert.equal(spacedWords.includes("catdog"), false);
  // The hyphen stays, and the line break around the soft hyphen does not become a space.
  const hyphen = "<p>The <span>well-</span>\n<span>&#xad;</span>\n<span>known</span> road.</p>";
  const hyphenWords = format.indexChapterHtml(hyphen, parse).tokens.map((t) => t.w);
  assert.ok(hyphenWords.includes("well") && hyphenWords.includes("known"));
  assert.equal(hyphenWords.includes("wellknown"), false);
  const hyphenDoc = parse(hyphen);
  format.stripWordBreaksIn(hyphenDoc.body);
  assert.match(hyphenDoc.body.textContent.replace(/\s+/g, " "), /well-known/);
  // A space that lives in its own span is a real space, even beside a soft hyphen.
  const spaceSpan = '<p><span>cat</span><span> </span><span>&#xad;</span><span>dog</span></p>';
  const spaceWords = format.indexChapterHtml(spaceSpan, parse).tokens.map((t) => t.w);
  assert.deepEqual(
    spaceWords.filter((w) => w === "cat" || w === "dog" || w === "catdog"),
    ["cat", "dog"],
  );
});

test("spans with no soft hyphen do not change word positions", () => {
  const parse = (html) => new DOMParser().parseFromString(html, "text/html");
  const plain = "<p>She smiled mysteriously at her nickname.</p><p>Hello world today.</p>";
  const spanned =
    '<p><span style="color:#111">She smiled mysteriously</span> at her nickname.</p><p>Hello <span style="color:#222">world</span> today.</p>';
  const words = (html) => format.indexChapterHtml(html, parse).tokens.map((t) => `${t.b}:${t.w}`);
  assert.deepEqual(words(spanned), words(plain));
});

test("a word split by U+00AD is underlined, and a normal hyphen is not joined", () => {
  const marks = underlined(shy.chapters[0].html);
  for (const word of ["mysteriously", "nickname", "pillow", "blanket", "rattlesnake"]) {
    assert.deepEqual(
      marks.filter((m) => m.word === word),
      [{ word, nth: 1 }],
      word,
    );
  }
  const html = shy.chapters[0].html;
  assert.equal(html.includes(SHY), false);
  assert.equal(html.includes(ZWSP), false);
  assert.equal(html.includes(WJ), false);
  assert.match(html, /well-/);
  assert.match(html, /good-night/);
  assert.match(html, /mysteriously/);
  assert.equal(html.includes("mys<"), false);
  const shown = format.readingHtml(html, new Set(), (s) => s.toLowerCase(), 0, new Map());
  const doc = new DOMParser().parseFromString(`<div>${shown}</div>`, "text/html");
  const words = [...doc.querySelectorAll("button")].map((b) => b.textContent);
  assert.ok(words.includes("well") && words.includes("known"));
  assert.equal(words.includes("well-known"), false);
  assert.equal(words.includes("mys"), false);
});

test("glossary positions and sentence context match the cleaned text", () => {
  const list = format.validateGlossary({
    version: 2,
    glossary: {
      mysteriously: {
        pos: "adverb",
        meaning: "In a way that is hard to explain.",
        senses: [
          {
            meaning: "In a way that is hard to explain.",
            anchors: [
              {
                chapter: 0,
                occurrence: 1,
                context: "She smiled mysteriously at her nickname on the old pillow",
              },
            ],
          },
        ],
      },
    },
  });
  assert.equal(list.ok, true, list.errors.join("\n"));
  const parse = (html) => new DOMParser().parseFromString(html, "text/html");
  const found = format.checkAgainstBook(
    list.file,
    shy.chapters.map((c) => format.indexChapterHtml(c.html, parse)),
    true,
  );
  assert.deepEqual(found.errors, []);
  assert.equal(found.missing, 0);
  const match = edition.editionMatch(
    {
      sentences: [
        {
          context:
            "She smiled mysteriously at her nickname on the old pillow and folded the warm blanket",
        },
      ],
    },
    shy.chapters.flatMap((c) => c.paragraphs),
  );
  assert.equal(match.found, 1);
  assert.equal(match.total, 1);
});
