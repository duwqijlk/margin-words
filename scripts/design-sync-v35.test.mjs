// Design system "Keep reading" v34 / v35: the phone tab bar, a word card with no scrollbars on its
// sides, Discover rows that show whole books only, and the contributor ranking's books on a phone.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const css = read("src/styles.css");

test("the phone tab bar: 60px, faint tabs, a 2px accent line on top of the current one", () => {
  const app = read("src/components/margin-app.tsx");
  assert.match(app, /h-\[3\.75rem\] flex-col/);
  assert.match(app, /"font-bold text-accent" : "text-faint/);
  assert.match(app, /absolute -top-px right-\[30%\] left-\[30%\] h-0\.5 bg-accent/);
  assert.match(app, /pb-\[calc\(3\.75rem\+env\(safe-area-inset-bottom\)\)\]/);
  for (const file of ["src/components/review.tsx", "src/components/site-notice.tsx"]) {
    assert.doesNotMatch(read(file), /4\.25rem/, `${file} sits on the 3.75rem tab bar`);
  }
});

test("the word card body scrolls up and down only", () => {
  const rule = css.slice(css.indexOf("[data-word-card] [data-word-body] {"));
  const body = rule.slice(0, rule.indexOf("}"));
  assert.match(body, /overflow-x:\s*hidden/);
  assert.match(body, /overflow-y:\s*auto/);
  assert.match(css, /\[data-word-card\] \[data-word-body\]::-webkit-scrollbar-button\s*\{\s*display:\s*none/);
  assert.doesNotMatch(read("src/components/word-card.tsx"), /data-word-body[^>]*scroll-thin|scroll-thin[^>]*data-word-body/);
});

test("a Discover row shows whole books only, and a page is the row width plus one gap", () => {
  assert.match(css, /\.rail-row > \.rail-item\s*\{\s*width:\s*calc\(\(100% - \(var\(--n\) - 1\) \* 20px\) \/ var\(--n\)\)/);
  for (const n of [4, 5, 6]) assert.match(css, new RegExp(`\\.rail-row\\s*\\{\\s*--n:\\s*${n}`));
  const discover = read("src/components/discover-browse.tsx");
  assert.match(discover, /function railStep\(/);
  assert.match(discover, /target \* railStep\(node\)/);
});

test("the contributor ranking keeps the reader's books on a phone", () => {
  const people = read("src/components/overview-people.tsx");
  assert.match(people, /const MOBILE_COVERS = 3/);
  assert.match(people, /data-rank-books/);
  assert.match(people, /minmax\(0,1fr\)_auto/);
});
