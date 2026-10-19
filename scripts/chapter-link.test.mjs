// The one-pass chapter linker matches the old three calls: tap buttons, phrase dots, hyphen hints.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModules } from "./lib/app-modules.mjs";

const { format, help, hyphenate, chapterLink } = await loadAppModules();

function buttons(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  return [...doc.querySelectorAll('[role="button"][data-word]')].map((button) => ({
    word: button.getAttribute("data-word"),
    cls: button.className,
    tap: button.querySelector(".book-tap")?.textContent ?? "",
  }));
}

test("reader controls stay semantic and unnested across imported controls and two linking passes", () => {
  const source = '<p><button>Lantern</button> <span role="button"><em>lantern</em></span> <a href="#old">quietly</a> waited.</p>';
  const link = html => chapterLink.linkChapterHtml(html, new Set(["lantern"]), s => s.toLowerCase(), 0, new Map(), new Map());
  const once = link(source);
  const twice = link(once);
  const metadata = html => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    assert.equal(doc.querySelectorAll('button, a, [role="button"] [role="button"]').length, 0);
    const words = [...doc.querySelectorAll("[data-word]")];
    assert.equal(words.length, 4);
    for (const word of words) {
      assert.equal(word.localName, "span");
      assert.equal(word.getAttribute("role"), "button");
      assert.equal(word.getAttribute("tabindex"), "-1");
      const tap = word.querySelector(":scope > .book-tap");
      assert.ok(tap);
      assert.equal(tap.getAttribute("role"), null);
      assert.equal(tap.getAttribute("tabindex"), null);
    }
    return words.map(el => [el.dataset.word, el.dataset.i, el.dataset.n, el.className]);
  };
  const expected = [["Lantern", "0", "1", "book-hard"], ["lantern", "1", "2", "book-hard"], ["quietly", "2", "1", ""], ["waited", "3", "1", ""]];
  assert.deepEqual(metadata(once), expected);
  assert.deepEqual(metadata(twice), expected);
});

test("joining inline word fragments preserves the following text's formatting", () => {
  for (const tag of ["em", "strong", "sup", "sub"]) {
    const html = `<p><${tag}>un</${tag}>believable weather today.</p>`;
    const linked = chapterLink.linkChapterHtml(html, new Set(), s => s.toLowerCase(), 0, new Map(), new Map());
    const doc = new DOMParser().parseFromString(linked, "text/html");
    assert.deepEqual([...doc.querySelectorAll('[role="button"][data-word]')].map(b => b.dataset.word), ["unbelievable", "weather", "today"]);
    assert.equal(doc.querySelector('[role="button"][data-word="weather"]').closest(tag), null);
    assert.equal(doc.querySelector(tag).textContent.replace(/­/g, ""), "unbelievable");
  }
  for (const html of ["<p><em>un</em>believ<span>able weather</span> today.</p>", "<p><em>don</em>'t leave.</p>"]) {
    const linked = chapterLink.linkChapterHtml(html, new Set(), s => s.toLowerCase(), 0, new Map(), new Map());
    const doc = new DOMParser().parseFromString(linked, "text/html");
    assert.equal(doc.querySelector("em").textContent.replace(/­/g, ""), html.includes("don") ? "don't" : "unbelievable");
  }
});

test("only canonical centered alignment survives chapter styling cleanup", () => {
  const linked = chapterLink.linkChapterHtml('<p style="text-align:center">A dedication.</p><p style="text-align:center;color:red">Publisher styles.</p><p data-reading-centered="1">Forged marker.</p>', new Set(), s => s.toLowerCase(), 0, new Map(), new Map());
  const doc = new DOMParser().parseFromString(linked, "text/html");
  assert.equal(doc.querySelectorAll('[data-reading-centered="1"]').length, 1);
  assert.equal(doc.querySelectorAll("[style]").length, 0);
});

test("leaf reading blocks match all-pairs semantics with linear containment calls", () => {
  const doc = new DOMParser().parseFromString('<blockquote><div><p>First.</p><p>Second.</p></div></blockquote><ul><li>Item.<ul><li>Nested.</li></ul></li></ul><p>Last.</p>', "text/html");
  const blocks = [...doc.querySelectorAll("p, h1, h2, h3, h4, li, blockquote, div[data-para]")];
  const expected = blocks.filter(b => !blocks.some(other => b !== other && b.contains(other)));
  assert.deepEqual(format.leafReadingBlocks(doc.body), expected);
  let calls = 0;
  const many = Array.from({ length: 2000 }, () => ({ contains() { calls++; return false; } }));
  assert.deepEqual(format.leafReadingBlocks({ querySelectorAll: () => many }), many);
  assert.equal(calls, many.length - 1);
});

test("one pass matches reading, phrase marks, and hyphenation", () => {
  const html =
    "<p>I am here with students in Arlington. And we've got students tuning in from all across America, from kindergarten through 12th grade.</p>";
  const phrases = {
    "tune in": { meaning: "To watch or listen from another place.", pos: "idiom" },
  };
  const ready = new Set(["kindergarten"]);
  const resolve = (surface) => surface.toLowerCase();
  const base = format.readingHtml(html, ready, resolve, 1, new Map());
  const marked = format.markWordRanges(base, (paragraph) => help.phraseWordRanges(phrases, paragraph), "book-phrase");
  const separate = hyphenate.hyphenateReadingHtml(marked);
  const once = chapterLink.linkChapterHtml(html, ready, resolve, 1, new Map(), new Map(), phrases);
  assert.deepEqual(buttons(once), buttons(separate));
  assert.ok(buttons(once).some((button) => button.word === "tuning" && button.cls === "book-phrase"));
  assert.ok(buttons(once).some((button) => button.word === "kindergarten" && button.cls === "book-hard"));
});
