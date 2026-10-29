/** Discover browsing opens the introduction, even when the book is already on the shelf. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const discover = readFileSync(new URL("../src/components/discover.tsx", import.meta.url), "utf8");
const browse = readFileSync(new URL("../src/components/discover-browse.tsx", import.meta.url), "utf8");
// The card and the add button it shares with the rows (renderAdd).
const card = discover.slice(discover.indexOf("  function renderAdd("), discover.indexOf("  const browsing ="));

test("grid covers and titles open details regardless of shelf ownership", () => {
  const cover = card.match(/<button\b[^>]*onClick=\{\(\) => setDetailId\(row\.key\)\}[^]*?data-card-detail[^]*?<\/button>/)?.[0];
  assert.ok(cover, "the cover has the same detail action for every book");
  assert.match(cover, /aria-label=\{t\("browse\.openAria"/);
  assert.match(cover, /<BookCover\b/);
  const title = card.match(/<h3\b[^]*?<\/h3>/)?.[0];
  assert.ok(title);
  assert.match(title, /onClick=\{\(\) => setDetailId\(row\.key\)\}/);
  assert.doesNotMatch(card, /held\s*&&\s*record/, "owned books must not branch into reading");
  assert.doesNotMatch(card, /onClick=\{[^\n]*onOpen\(/);
  assert.match(discover, /group\.rows\.map\(renderCard\)/, "collections use the same cards");
  assert.match(discover, /visible\.map\(renderCard\)/, "the all-books grid uses the same cards");
});

test("the featured book and every rail also open details", () => {
  const entries = discover.match(/<(?:FeaturedBook|BookRail)\b[^]*?\/>/g) ?? [];
  assert.equal(entries.length, 3, "featured, new books, and configured rails");
  for (const entry of entries) {
    assert.match(entry, /onOpen=\{\(row\) => setDetailId\(row\.key\)\}/);
  }
  for (const component of ["BookRail", "FeaturedBook"]) {
    const start = browse.indexOf(`export function ${component}(`);
    const next = browse.indexOf("export function ", start + 1);
    const source = browse.slice(start, next < 0 ? undefined : next);
    assert.match(source, /onClick=\{\(\) => onOpen\(row\)\}/);
    assert.match(source, /aria-label=\{t\("browse\.openAria"/);
  }
});

test("explicit open actions still open the held book", () => {
  const detail = discover.slice(discover.indexOf("  function detailAction("), discover.indexOf("  function renderCard("));
  assert.match(detail, /if \(m\.state === "on"\)[^]*?if \(m\.book\)[^]*?setDetailId\(""\);\s*onOpen\(m\.book\.id\);/);
  assert.match(discover, /onAction=\{\(\) => detailRow && detailAction\(detailRow\)\}/);
  assert.match(browse, /onClick=\{onAction\}[^]*?data-detail-action=\{model\.state\}/);
  assert.match(card, /<AddToShelfButton\b[^]*?onOpen=\{\(\) => book && onOpen\(book\.id\)\}/);
});

test("held copies remain explicitly openable during update, busy and error states", () => {
  const extra = browse.match(/\{model\.held && model\.state !== "on" \? \([^]*?data-detail-open[^]*?<\/button>/)?.[0];
  assert.ok(extra, "an installed copy has a separate action whenever the primary action is not Open");
  assert.match(extra, /onClick=\{onOpen\}/);
  assert.doesNotMatch(extra, /disabled=/);
  const handler = discover.match(/onOpen=\{\(\) => \{\s*if \(!detailRow\)[^]*?onOpen\(m\.book\.id\);\s*\}\}/)?.[0];
  assert.ok(handler);
  assert.match(handler, /if \(!m\.held \|\| !m\.book\) return;/);
  assert.doesNotMatch(handler, /state|updateReady|canAdd/);
});

test("Discover state uses the selected record, including empty installed revisions and holds", () => {
  const start = discover.indexOf("  function cardModel(row: Row)");
  const end = discover.indexOf("  function detailModel(", start);
  assert.ok(end > start);
  const body = ts.transpileModule(discover.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const model = new Function("discoverShelfBook", "shelf", "records", "pendingId", "items", "busyId", "listError", "wordListRev", "updateHolds", "updateFailures", "customPacks", "holdOffersUpdate", "canAdd", "quota", "quotaFor", "placesLeft", "t", "lexileMeasure", "rows", `${body}; return cardModel;`);
  const make = ({ record = { bookId: "chosen", packId: "sample", rev: "", sha256: "same" }, hold, custom = false, needs = false, catalogRev = "new" } = {}) => model(
    () => ({ book: { id: "chosen", needsEpub: needs }, record }), [], [], "", {}, "", {},
    () => "new", { "book:chosen": hold }, {}, new Set(custom ? ["chosen"] : []),
    (why) => why !== "ownList", false, null, () => null, () => Infinity, (key) => key, () => null, [],
  )({ id: "sample", kind: "classic", pack: { rev: catalogRev, epub: { sha256: "same" } } });
  assert.equal(make().state, "update", "an empty installed rev does not suppress a current catalog revision");
  for (const hold of ["bookChanged", "mismatch", "newList"]) {
    const result = make({ hold, record: { bookId: "chosen", packId: "sample", rev: "", sha256: "same" } });
    assert.equal(result.why, hold);
    assert.equal(result.updateReady, true);
    assert.equal(make({ hold, catalogRev: "" }).why, hold, "hold survives an empty catalog revision");
  }
  assert.equal(make({ custom: true, hold: "mismatch" }).why, "ownList");
  assert.equal(make({ needs: true, hold: "newList" }).updateReady, false);
  assert.equal(make({ record: null }).held, true);
  assert.equal(make({ record: { bookId: "chosen", packId: "legacy", rev: "old" } }).updateReady, false);
});

test("Discover updates the exact modeled book and forwards actual saved-word counts", () => {
  const update = discover.slice(discover.indexOf("  function update(row:"), discover.indexOf("  function add(row:"));
  assert.match(update, /updateInstalledBook\(model\.book\.id\)/);
  assert.doesNotMatch(update, /retryWordListUpdate|start\(/);
  assert.doesNotMatch(discover, /byPack|savedWords: 0/);
  assert.match(discover, /bookHasUserWork\(\{[^]*?savedWords,/);
});

test("ambiguous identities disable native card/detail actions and guard Add before any install", () => {
  assert.match(discover, /<fieldset disabled=\{ambiguous\}/);
  assert.match(discover, /if \(cardModel\(row\)\.ambiguous\) return;/);
  assert.match(discover, /if \(m\.ambiguous \|\| m\.state === "busy"\) return;/);
  assert.match(browse, /disabled=\{model\.blocked \|\| model\.state === "busy"\}/);
});
