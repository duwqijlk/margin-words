// The one-pass chapter linker matches the old three calls: tap buttons, phrase dots, hyphen hints.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModules } from "./lib/app-modules.mjs";

const { format, help, hyphenate, chapterLink } = await loadAppModules();

function buttons(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  return [...doc.querySelectorAll("button[data-word]")].map((button) => ({
    word: button.getAttribute("data-word"),
    cls: button.className,
    tap: button.querySelector(".book-tap")?.textContent ?? "",
  }));
}

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
