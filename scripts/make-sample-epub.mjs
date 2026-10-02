#!/usr/bin/env node
/**
 * Writes the tiny sample book "The Lantern Seller" as a valid EPUB 3 file (with an old-style NCX too).
 * The story is an original text written for this project and given to the public domain (CC0).
 * The output is always the same bytes (fixed dates), so its sha256 never changes.
 *
 *   node scripts/make-sample-epub.mjs                       writes examples/sample-book/the-lantern-seller.epub
 *   node scripts/make-sample-epub.mjs --out some/file.epub  writes somewhere else
 *   node scripts/make-sample-epub.mjs --check               exit 1 if the file on disk is not what this script makes
 *
 * The EPUB goes into book-pack-kit.zip (scripts/build-kit.mjs).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));
const JSZip = require("jszip");

export const BOOK = {
  id: "urn:uuid:5f0c1d7a-3b0e-4a57-9a4e-6f1c2d3e4b5a",
  title: "The Lantern Seller",
  author: "A. Sample Writer",
  language: "en",
  rights: "CC0 1.0 - public domain dedication. Original text written for the Margin Words project.",
};

export const CHAPTERS = [
  {
    title: "The Fair",
    paragraphs: [
      "Every autumn the town of Marrow Bridge held a fair in the old market square. Stalls filled the square from edge to edge. A baker sold hot buns, a juggler tossed apples into the air, and a band played near the fountain.",
      "At the far corner, where the cobbles were uneven, stood a thin old man called Tobias Reed. He was a lantern seller. His stall was shabby, and the paint on its roof had faded to the colour of dust. But on the shelves hung forty lanterns, each made of glass and thin brass wire, and each one different from the rest.",
      "Mira, a girl of twelve, stopped in front of the stall. She had come to the fair with two coins in her pocket and no plan at all. She had never seen lanterns like these.",
      "\u201CDo they really work?\u201D she asked.",
      "\u201COf course,\u201D said Tobias. \u201CBut a lantern is not made for bright rooms. It is made for dark roads.\u201D He gave a slow smile. \u201CCome back at dusk, and I will show you.\u201D",
    ],
  },
  {
    title: "The Blue Flame",
    paragraphs: [
      "As the sun sank, a fine drizzle began to fall. The jugglers packed up their apples, the baker covered his buns, and the crowd drifted away. By dusk the square was almost empty. Only the lantern stall still glowed, with one small light at its back.",
      "Mira came back with her hood pulled over her head. She was wet, and she was a little afraid of the long lane that led to her house. It ran beside the river, and it had no lamps at all.",
      "Tobias took down a lantern with a plain brass handle. He struck a match and touched it to the wick. For a moment the flame was yellow and began to flicker in the wind. Then it turned a deep, calm blue and stood perfectly still. \u201CA moonwick,\u201D he said. \u201CNo wind can blow it out.\u201D",
      "\u201CHow much is it?\u201D Mira asked. She held out her two coins, but she was sure they were not enough.",
      "\u201CI do not want your coins,\u201D said Tobias. \u201CA fair price for this lantern is one honest answer. Why do you really want it?\u201D",
      "Mira did not hesitate for long. \u201CBecause I am tired of being afraid of the dark,\u201D she said. Tobias nodded and put the lantern in her hands.",
    ],
  },
  {
    title: "The Road Home",
    paragraphs: [
      "Mira set out along the river lane. The drizzle fell on her hood, but the blue light stayed bright and steady, and it lit up the wet stones in front of her feet. She walked slowly at first. The more she walked, the less she feared the dark.",
      "Halfway home, the light fell on a loose stone at the edge of the old bridge. Had she not been carrying the lantern, she would have stepped on it and slipped into the cold water below. She stopped, took a deep breath, and went around it with great care.",
      "At her door, her mother looked at the blue flame and said nothing for a long time. At last she asked, \u201CWhere did you find that?\u201D Mira only smiled.",
      "The next autumn, Mira went back to the fair. She did not come to buy anything. She came to help. She stayed beside the old stall until the last light had gone out, and she looked after the lanterns as if they were her own. And when a frightened child came by in the dusk, she was the one who said, \u201CCome back at dark, and I will show you.\u201D",
    ],
  },
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const xhtml = (title, body) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">\n<head>\n<meta charset="utf-8"/>\n<title>${esc(title)}</title>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;

export async function buildEpub() {
  const date = new Date("2026-01-01T00:00:00Z");
  const zip = new JSZip();
  const add = (name, data, compression = "DEFLATE") => zip.file(name, data, { date, createFolders: false, compression });
  // The mimetype file must be the first file and must not be compressed.
  add("mimetype", "application/epub+zip", "STORE");
  add(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>\n`,
  );
  const items = CHAPTERS.map((_, i) => `    <item id="ch${i + 1}" href="chapter${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join("\n");
  const refs = CHAPTERS.map((_, i) => `    <itemref idref="ch${i + 1}"/>`).join("\n");
  add(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en">\n  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n    <dc:identifier id="bookid">${BOOK.id}</dc:identifier>\n    <dc:title>${esc(BOOK.title)}</dc:title>\n    <dc:creator>${esc(BOOK.author)}</dc:creator>\n    <dc:language>${BOOK.language}</dc:language>\n    <dc:rights>${esc(BOOK.rights)}</dc:rights>\n    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>\n  </metadata>\n  <manifest>\n    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n${items}\n  </manifest>\n  <spine toc="ncx">\n${refs}\n  </spine>\n</package>\n`,
  );
  const navItems = CHAPTERS.map((c, i) => `      <li><a href="chapter${i + 1}.xhtml">${esc(c.title)}</a></li>`).join("\n");
  add(
    "OEBPS/nav.xhtml",
    xhtml("Contents", `<nav epub:type="toc" id="toc">\n    <h1>Contents</h1>\n    <ol>\n${navItems}\n    </ol>\n  </nav>`),
  );
  const points = CHAPTERS.map(
    (c, i) =>
      `    <navPoint id="np${i + 1}" playOrder="${i + 1}">\n      <navLabel><text>${esc(c.title)}</text></navLabel>\n      <content src="chapter${i + 1}.xhtml"/>\n    </navPoint>`,
  ).join("\n");
  add(
    "OEBPS/toc.ncx",
    `<?xml version="1.0" encoding="utf-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n  <head>\n    <meta name="dtb:uid" content="${BOOK.id}"/>\n    <meta name="dtb:depth" content="1"/>\n    <meta name="dtb:totalPageCount" content="0"/>\n    <meta name="dtb:maxPageNumber" content="0"/>\n  </head>\n  <docTitle><text>${esc(BOOK.title)}</text></docTitle>\n  <navMap>\n${points}\n  </navMap>\n</ncx>\n`,
  );
  CHAPTERS.forEach((c, i) => {
    const body = [`<h1>${esc(c.title)}</h1>`, ...c.paragraphs.map((p) => `<p>${esc(p)}</p>`)].join("\n");
    add(`OEBPS/chapter${i + 1}.xhtml`, xhtml(c.title, body));
  });
  return zip.generateAsync({ type: "nodebuffer", platform: "UNIX", compression: "DEFLATE" });
}

export const DEFAULT_OUT = join(ROOT, "examples", "sample-book", "the-lantern-seller.epub");

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const outAt = args.indexOf("--out");
  const out = resolve(outAt >= 0 ? (args[outAt + 1] ?? "") : DEFAULT_OUT);
  const bytes = await buildEpub();
  if (args.includes("--check")) {
    if (!existsSync(out) || Buffer.compare(readFileSync(out), bytes) !== 0) {
      console.error(`${out} is missing or not what this script writes. Run: node scripts/make-sample-epub.mjs`);
      process.exit(1);
    }
    console.log(`OK: ${out} is up to date.`);
  } else {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, bytes);
    const words = CHAPTERS.flatMap((c) => c.paragraphs).join(" ").split(/\s+/).length;
    console.log(`Wrote ${out} (${bytes.length} bytes, about ${words} words, ${CHAPTERS.length} chapters).`);
  }
}
