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

function chapterHtml(shy) {
  const mysteriously = shy ? `mys${SHY}teriously` : "mysteriously";
  const nickname = shy ? `nick<span>&#x00AD;</span>name` : "nickname";
  const pillow = shy ? `pil&#x200B;low` : "pillow";
  const blanket = shy ? `blan&#x2060;ket` : "blanket";
  const goodNight = shy ? `good-&#x00AD;night` : "good-night";
  const doesnt = shy ? `doesn&#x200B;'t` : "doesn't";
  return [
    "<h1>The Fair</h1>",
    `<p>She smiled ${mysteriously} at her ${nickname} on the old ${pillow} and folded the warm ${blanket}.</p>`,
    `<p>The well-known road was a ${goodNight} walk and she ${doesnt} hurry under the stars tonight.</p>`,
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
  const ready = new Set(["mysteriously", "nickname", "pillow", "blanket"]);
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
});

test("a word split by U+00AD is underlined, and a normal hyphen is not joined", () => {
  const marks = underlined(shy.chapters[0].html);
  for (const word of ["mysteriously", "nickname", "pillow", "blanket"]) {
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
  assert.match(html, /well-known/);
  assert.match(html, /good-night/);
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
