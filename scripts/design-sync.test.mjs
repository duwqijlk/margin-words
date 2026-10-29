// Design system "Keep reading" v34-v36: the phone tab bar, a word card with no scrollbars on its
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

// v36, English pass: rows wrap as whole blocks, button text never wraps, Lexile is a plain number.
test("Discover tabs and the weekly quota wrap instead of overlapping; the quota has its own line on a phone", () => {
  const discover = read("src/components/discover.tsx");
  assert.match(discover, /flex flex-wrap items-center gap-x-4 gap-y-1\.5 border-b border-line max-sm:gap-0 max-sm:border-b-0" data-discover-tabsrow/);
  assert.match(discover, /"relative flex-none border-b-0 max-sm:basis-full max-sm:border-b"/);
  const quota = read("src/components/weekly-quota.tsx");
  assert.match(quota, /ml-auto flex min-w-0 flex-wrap items-center gap-x-1 text-\[0\.8125rem\] text-faint max-sm:ml-0 max-sm:basis-full max-sm:pt-1\.5/);
  assert.match(quota, /<b className=\{cn\("font-bold tabular-nums"/);
});

test("button text never wraps; the continue button and the detail's main button keep their width", () => {
  assert.match(read("src/components/ui.tsx"), /gap-2 whitespace-nowrap rounded px-4/);
  assert.match(read("src/components/shelf.tsx"), /btn\.primary, "flex-\[1_0_auto\] px-6 sm:flex-none"/);
  const discover = read("src/components/discover-browse.tsx");
  assert.match(discover, /flex flex-wrap items-center gap-2" data-detail-actions/);
  assert.match(discover, /relative flex-\[1_0_auto\] overflow-hidden px-6 sm:flex-none sm:min-w-48/);
});

test("the book detail shows the Lexile measure as a number with a smaller L, not a chip", () => {
  const discover = read("src/components/discover-browse.tsx");
  assert.doesNotMatch(discover, /LexileBadge/);
  assert.match(discover, /function LexileNumber\(/);
  assert.match(discover, /<small className="ml-px text-\[0\.55em\] font-bold">L<\/small>/);
});
