/** Local shelf-info rendering and interaction wiring; no server or browser needed. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { isbnDigits, readSeries } from "../src/lib/book-meta.ts";
import { en } from "../src/lib/i18n-en.ts";

const require = createRequire(import.meta.url);
const source = (name) => readFileSync(new URL(`../src/components/${name}.tsx`, import.meta.url), "utf8");
const infoSource = source("shelf-book-info");
const shelfSource = source("shelf");
const cardSource = shelfSource.slice(shelfSource.indexOf("function BookCard("), shelfSource.indexOf("export function Shelf("));
const t = (key, params = {}) => {
  assert.ok(key in en, `unknown translation: ${key}`);
  return en[key].replace(/\{(\w+)\}/g, (_, key) => String(params[key]));
};
const fragment = ({ children }) => React.createElement(React.Fragment, null, children);
const element = (tag) => ({ children, ...props }) => React.createElement(tag, props, children);
const dialog = {
  Root: fragment, Portal: fragment, Overlay: () => null,
  Content: ({ onCloseAutoFocus: _focus, ...props }) => React.createElement("section", props),
  Title: element("h2"), Description: element("p"), Close: element("button"),
};
const ui = { btn: { quiet: "quiet" }, cn: (...values) => values.filter(Boolean).join(" "), ProgressBar: () => null };
function loadComponent(text, stubs) {
  const js = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(module, module.exports, (id) => {
    if (id in stubs) return stubs[id];
    if (!id.startsWith("@/") && !id.startsWith("@radix-ui/")) return require(id);
    throw new Error(`Unstubbed app import: ${id}`);
  });
  return module.exports;
}
const shared = {
  "@radix-ui/react-dialog": dialog,
  "@/lib/i18n": { useT: () => ({ t }) },
  "@/components/ui": ui,
};
const { ShelfBookInfo } = loadComponent(infoSource, {
  ...shared, "@/lib/book-meta": { isbnDigits, readSeries },
});
const book = (extra = {}) => ({
  id: "test-book", title: "A Local Book", author: "A Writer", cloth: "cloth",
  source: "epub", createdAt: 1, updatedAt: 1, ...extra,
});
const info = (extra = {}, props = {}) => renderToStaticMarkup(React.createElement(ShelfBookInfo, {
  book: book(extra), classic: false, fileHere: true, due: 0, open: true,
  onOpenChange: () => {}, onReturnFocus: () => {}, ...props,
}));

test("local info renders title, author, Lexile, series and valid canonical ISBN together", () => {
  const html = info({ lexile: "880L", series: "A Series", seriesNumber: 2, isbn: "0-306-40615-2" });
  for (const text of ["A Local Book", "A Writer", "880L", "A Series", "Book 2", "9780306406157"]) assert.ok(html.includes(text), text);
});

test("absent or blank optional facts produce no empty labeled rows", () => {
  const html = info({ author: " ", lexile: " ", isbn: "", series: " ", seriesNumber: 2, matchRate: undefined, source: undefined }, { fileHere: null });
  for (const field of ["author", "series", "lexile", "isbn", "match", "file", "public-domain", "old-fashioned"]) {
    assert.ok(!html.includes(`data-info-${field}=`), field);
  }
  assert.doesNotMatch(html, /Unrated|Copyright|Modern/);
});

for (const isbn of ["1234567890123", "9780306406158", "0-306-40615-3", "not an ISBN"]) {
  test(`invalid ISBN is omitted: ${isbn}`, () => assert.doesNotMatch(info({ isbn }), /data-info-isbn/));
}

for (const n of [0, 79, 80, 100]) {
  test(`${n}% is a present match, not edition verification`, () => {
    const html = info({ matchRate: n });
    assert.ok(html.includes(`data-info-match="${n}"`));
    assert.ok(html.includes(`${n}%`));
    assert.ok(html.includes(en["shelf.infoMatchNote"]));
    assert.ok(html.includes(en["shelf.infoMatch"]));
    assert.equal(html.includes('class="font-medium text-warn"'), n < 80);
  });
}

for (const matchRate of [undefined, NaN, Infinity, -1, 101]) {
  test(`invalid/unknown match has no row: ${String(matchRate)}`, () => assert.doesNotMatch(info({ matchRate }), /data-info-match=/));
}

test("info includes the local due count, including zero; menu remains positive-only", () => {
  for (const due of [0, 3]) {
    const html = info({}, { due });
    assert.ok(html.includes(`data-info-due="${due}"`));
    assert.ok(html.includes(`${due} due`));
  }
  assert.match(cardSource, /due=\{row\.due\}/);
});

test("notes-only cards keep the original sample-notebook footer contract", () => {
  assert.match(card({ source: "notes" }), /data-card-actions/);
  assert.ok(card({ source: "notes" }).includes(en["shelf.sampleNotebook"]));
  assert.match(card({ source: undefined }), /data-card-actions/);
  assert.doesNotMatch(card({ source: "epub" }), /data-card-actions/);
  assert.doesNotMatch(card({ source: "notes", needsEpub: true }), /data-card-actions/);
});

test("file facts distinguish local, missing, waiting, notebook and unknown", () => {
  assert.ok(info().includes(en["shelf.infoFileHere"]));
  assert.ok(info({}, { fileHere: false }).includes(en["shelf.fileMissing"]));
  assert.ok(info({ needsEpub: true }, { fileHere: true }).includes(en["shelf.needsEpub"]));
  assert.ok(!info({ needsEpub: true }, { fileHere: true }).includes(en["shelf.infoFileHere"]));
  assert.ok(info({ source: "notes" }).includes(en["shelf.infoNotesOnly"]));
  assert.doesNotMatch(info({}, { fileHere: null }), /data-info-file=/);
  assert.doesNotMatch(info({ source: undefined }), /data-info-file=/);
});

test("public-domain fact is independent of file presence, not inferred for unrecognized books", () => {
  assert.match(info({}, { classic: true, fileHere: false }), /data-info-public-domain=/);
  assert.doesNotMatch(info({}, { classic: false }), /data-info-public-domain=/);
});

test("old-fashioned note retains its local English reason", () => {
  const html = info({ oldFashioned: true, oldFashionedReason: "Older vocabulary and spelling." });
  assert.ok(html.includes(en["shelf.oldFashioned"]));
  assert.match(html, /lang="en">Older vocabulary and spelling\./);
  assert.doesNotMatch(info(), /data-info-old-fashioned=/);
});

const menu = { Root: fragment, Portal: fragment, Content: fragment, Trigger: element("button"), Item: element("div"), Separator: () => null };
const inert = new Proxy({}, { get: () => () => null });
const { BookCard } = loadComponent(`${shelfSource}\nexport { BookCard };`, {
  ...shared,
  "@radix-ui/react-dropdown-menu": menu,
  "@/lib/book-db": inert, "@/lib/word-list-plan": inert, "@/lib/word-list-update": inert,
  "@/lib/progress-store": inert, "@/lib/srs": inert, "@/lib/vocab-store": inert,
  "@/lib/classics": inert, "@/lib/shelf-work": inert, "@/lib/sync-merge": inert,
  "@/lib/wordbook": inert, "@/lib/shelf-remove": inert, "@/lib/phone-gestures": inert,
  "@/lib/speech-books": { useSpeechBookIds: () => new Set(), isTedBook: () => false }, "@/lib/router": inert,
  "@/lib/lexile": inert, "@/lib/discover-rails": inert, "@/components/lexile-ui": inert,
  "@/components/list-filters": { bookCardShell: "card", cardTitleClass: "title", cardAuthorClass: "author" },
  "@/components/book-cover": { BookCover: () => React.createElement("span", { "data-cover": "" }), talkCoverTone: () => "" },
  "@/lib/cover-tone": { useBookTone: () => ({}) },
  "@/lib/last-read": { lastReadLine: () => "" },
  "@/components/shelf-book-info": { ShelfBookInfo: () => null },
  "@/components/cover-marks": { BookTags: fragment, BookTag: element("span"), OldFashionedTag: () => React.createElement("span", null, "old-warning") },
  "@/lib/reading-stats": {
    asFinishedAt: (value) => (typeof value === "number" && value > 0 ? value : undefined),
    matchesFinished: () => true,
  },
  "@/components/share-button": { LazyShareDialog: () => null },
});
const card = (extra = {}, props = {}) => renderToStaticMarkup(React.createElement(BookCard, {
  row: { book: book(extra), fraction: 0, words: 4, due: 3 }, classic: true, fileHere: true,
  offer: null, updating: false, phoneMenu: false,
  onOpen: () => {}, onNotebook: () => {}, onAddList: () => {}, onRename: () => {}, onUpdate: () => {}, ...props,
}));

test("a finished book shows the badge and the menu offers to take the mark away; the progress bar stays", () => {
  const done = card({ finishedAt: 1_800_000_000_000 });
  assert.match(done, /data-shelf-finished=""/);
  assert.ok(done.includes(en["finished.badge"]));
  assert.match(done, /data-shelf-finish-menu="undo"/);
  assert.match(done, /data-shelf-share-menu=""/, "a finished book can share its card from the menu");
  assert.doesNotMatch(card(), /data-shelf-share-menu=/);
  assert.ok(done.includes(en["finished.unmark"]));
  const open = card();
  assert.doesNotMatch(open, /data-shelf-finished=/);
  assert.match(open, /data-shelf-finish-menu="mark"/);
  assert.equal((done.match(/cover-progress-bar/g) ?? []).length, (open.match(/cover-progress-bar/g) ?? []).length);
});

test("normal card omits metadata, public-domain label and due badge but menu has positive due count", () => {
  const html = card({ lexile: "880L", isbn: "9780306406157", series: "A Series", matchRate: 90 });
  for (const text of ["880L", "9780306406157", "A Series", "90%", en["shelf.classic"]]) assert.ok(!html.includes(text), text);
  assert.doesNotMatch(html, /data-shelf-due=/);
  assert.match(html, /data-shelf-menu-due="">3 due/);
  assert.ok(html.includes(en["shelf.info"]));
  assert.doesNotMatch(card({}, { row: { book: book(), fraction: 0, words: 0, due: 0 } }), /data-shelf-menu-due=/);
});

for (const [rate, warning] of [[0, true], [79, true], [80, false], [100, false], [undefined, false]]) {
  test(`card ${String(rate)}% only warns below 80`, () => assert.equal(/data-shelf-low-match=/.test(card({ matchRate: rate })), warning));
}

test("card keeps waiting, file-missing, old-fashioned and update/hold warnings", () => {
  assert.ok(card({ needsEpub: true }).includes(en["shelf.needsEpub"]));
  assert.ok(card({}, { fileHere: false }).includes(en["shelf.fileMissing"]));
  assert.ok(!card({}, { fileHere: null }).includes(en["shelf.fileMissing"]));
  assert.match(card({ oldFashioned: true }), /old-warning/);
  const html = card({}, { offer: { why: "bookChanged", failure: "" } });
  assert.match(html, /data-list-update="bookChanged"/);
  assert.match(html, /data-list-hold-reason/);
  assert.ok(html.includes(en["lists.keptBook"]));
});

test("focus handoff waits for menu close and restores the retained exact trigger", () => {
  assert.match(cardSource, /<Menu.Trigger\s+ref=\{menuTrigger\}/);
  assert.match(cardSource, /onSelect=\{\(\) => \{ infoPending\.current = true; \}\}/);
  assert.match(cardSource, /onCloseAutoFocus=\{\(event\) => \{\s*if \(!infoPending\.current\) return;[^]*?event.preventDefault\(\);\s*infoPending.current = false;\s*setInfoOpen\(true\);/);
  assert.match(cardSource, /onReturnFocus=\{\(\) => menuTrigger\.current\?\.focus\(\{ preventScroll: true \}\)\}/);
  assert.match(infoSource, /onCloseAutoFocus=\{\(event\) => \{\s*event.preventDefault\(\);\s*onReturnFocus\(\);/);
  assert.match(infoSource, /Dialog.Title/);
  assert.match(infoSource, /Dialog.Description/);
  assert.match(infoSource, /max-h-\[calc\(100vh-2rem\)\].*overflow-y-auto/);
  assert.doesNotMatch(infoSource, /dvh|fetch\(|useBookBlurb|useCatalog|useClassicBookIds|maintainer|BookDetail/);
});

test("cover/title remain open actions and phone second-tap gesture handlers remain wired", () => {
  assert.equal((cardSource.match(/onClick=\{onOpen\}/g) ?? []).length, 2);
  for (const hook of ["shelfPressDown", "shelfPressMove", "shelfPressRelease", "SHELF_MENU_ARM_MS", "setPointerCapture", "onContextMenu", "onPointerCancel"]) assert.ok(cardSource.includes(hook));
  assert.match(cardSource, /if \(!phoneMenu \|\| menuOpen \|\| event.button !== 0\) return;/);
  assert.match(cardSource, /action === "menu"[^]*?setMenuOpen\(true\)/);
});

test("removal confirmation receives the real per-book word count, including words-only work", async () => {
  assert.match(cardSource, /bookHasUserWork\(\{[^]*?savedWords: row\.words,/);
  assert.doesNotMatch(cardSource, /savedWords: 0/);
  const workSource = readFileSync(new URL("../src/lib/shelf-work.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(workSource, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  const { bookHasUserWork } = await import(`data:text/javascript,${encodeURIComponent(js)}`);
  assert.equal(bookHasUserWork({ classic: true, source: "epub", savedWords: 1 }), true);
  assert.equal(bookHasUserWork({ classic: true, source: "epub", savedWords: 0 }), false);
  assert.equal(bookHasUserWork({ classic: false, source: "notes", needsEpub: true, savedWords: 2 }), true);
});
