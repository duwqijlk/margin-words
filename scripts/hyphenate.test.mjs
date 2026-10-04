/**
 * Phone lines stay even because a long word may break at a soft hyphen.
 * The stored spelling (data-word) and the sentence text (flowText) do not include it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModules } from "./lib/app-modules.mjs";

const { hyphenate, flow } = await loadAppModules();
const SHY = "\u00AD";

test("a long word breaks at a real ending, and a short word does not", () => {
  assert.equal(hyphenate.hyphenateDisplay("remarkable"), `remark${SHY}able`);
  assert.equal(hyphenate.hyphenateDisplay("something"), `some${SHY}thing`);
  assert.equal(hyphenate.hyphenateDisplay("everything"), `every${SHY}thing`);
  assert.equal(hyphenate.hyphenateDisplay("fortunately"), `fortunate${SHY}ly`);
  assert.equal(hyphenate.hyphenateDisplay("conversation"), `convers${SHY}ation`);
  assert.equal(hyphenate.hyphenateDisplay("hedge"), "hedge");
  assert.equal(hyphenate.hyphenateDisplay("natural"), "natural");
  assert.equal(hyphenate.hyphenateDisplay("don't"), "don't");
  assert.equal(hyphenate.hyphenateDisplay("couldn’t"), "couldn’t");
});

test("the reading html keeps the spelling on the button and the break out of the sentence", () => {
  const shown = hyphenate.hyphenateReadingHtml(
    `<p><button type="button" data-word="There" data-i="0">There</button> <button type="button" data-word="remarkable" data-i="1" class="book-hard">remarkable</button>.</p>`,
  );
  const doc = new DOMParser().parseFromString(`<div>${shown}</div>`, "text/html");
  const hard = doc.querySelector("button.book-hard");
  assert.equal(hard?.getAttribute("data-word"), "remarkable");
  assert.equal(hard?.querySelector(".book-tap")?.textContent, `remark${SHY}able`);
  const paragraph = doc.querySelector("p");
  assert.equal(flow.flowText(paragraph), "There remarkable.");
  assert.equal(flow.flowText(paragraph).includes(SHY), false);
});
