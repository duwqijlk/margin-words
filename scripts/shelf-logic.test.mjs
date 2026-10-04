/**
 * The pure rules behind one-card-per-book, series stacks, cover repair and the page addresses.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModules } from "./lib/app-modules.mjs";

const { identity, stacks, coverPlan, covers, router } = await loadAppModules();
const { sameBook, sameAuthor, planMerges, findOnShelf, titleKeys } = identity;

const entry = (over) => ({
  id: "a",
  title: "Matilda",
  author: "Roald Dahl",
  isbn: "",
  stored: false,
  needsEpub: false,
  work: 0,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

test("the same book under different spellings is one book", () => {
  assert.equal(sameAuthor("Dahl, Roald", "Roald Dahl"), true);
  assert.equal(sameAuthor("Roald Dahl", "Roald Dahl, Quentin Blake"), true);
  assert.equal(sameAuthor("Roald Dahl", "Mary Pope Osborne"), false);
  assert.equal(sameAuthor("", "Anyone"), true);
  assert.equal(sameBook({ title: "The BFG", author: "Roald Dahl" }, { title: "BFG", author: "Dahl, Roald" }), true);
  assert.equal(
    sameBook(
      { title: "Ghost Town at Sundown (Magic Tree House #10)", author: "Mary Pope Osborne" },
      { title: "Ghost Town at Sundown", author: "Mary Pope Osborne" },
    ),
    true,
  );
  assert.equal(sameBook({ title: "Matilda", author: "Roald Dahl" }, { title: "Matilda", author: "Someone Else" }), false);
  assert.equal(sameBook({ title: "Matilda", author: "A" , isbn: "9780141322667" }, { title: "Other", author: "B", isbn: "9780141322667" }), true);
  assert.deepEqual(titleKeys("Wings of Fire 1: The Dragonet Prophecy").length, 2);
  assert.equal(
    sameBook({ title: "Magic Tree House #10: Ghost Town", author: "" }, { title: "Magic Tree House #11: Ship", author: "" }),
    false,
    "two different numbers of one series are two books",
  );
});

test("duplicate cards are grouped, and the card with the e-book is the one kept", () => {
  const imported = entry({ id: "imported", stored: true, work: 3 });
  const placeholder = entry({ id: "placeholder", needsEpub: true, work: 5 });
  const other = entry({ id: "other", title: "The Twits" });
  const plans = planMerges([placeholder, other, imported]);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].keep.id, "imported");
  assert.deepEqual(plans[0].drop.map((d) => d.id), ["placeholder"]);
  assert.deepEqual(planMerges([other, entry({ id: "z", title: "Wonder", author: "R. J. Palacio" })]), []);
});

test("with no e-book on either card, the one with saved words or progress is kept", () => {
  const plans = planMerges([entry({ id: "empty", needsEpub: true }), entry({ id: "worked", needsEpub: true, work: 2 })]);
  assert.equal(plans[0].keep.id, "worked");
});

test("three copies fall into one group", () => {
  const plans = planMerges([entry({ id: "1" }), entry({ id: "2", title: "matilda" }), entry({ id: "3", stored: true })]);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].drop.length, 2);
  assert.equal(plans[0].keep.id, "3");
});

test("findOnShelf prefers the card with the e-book", () => {
  const shelf = [entry({ id: "a" }), entry({ id: "b", stored: true })];
  assert.equal(findOnShelf(shelf, { title: "Matilda", author: "Roald Dahl" }).id, "b");
  assert.equal(findOnShelf(shelf, [{ title: "Nope", author: "" }, { title: "Matilda", author: "" }]).id, "b");
  assert.equal(findOnShelf(shelf, { title: "Wonder", author: "" }), null);
  assert.equal(findOnShelf(shelf, { title: "", author: "" }), null);
});

const row = (id, series, seriesNumber, title = id) => ({ id, book: { series, seriesNumber, title } });

test("a series with two or more books becomes one stack; the rest stay single cards", () => {
  const rows = [row("solo"), row("mth3", "Magic Tree House", 3), row("other", "Narnia", 1), row("mth1", "Magic Tree House", 1), row("mth2", "magic tree  house", 2)];
  const items = stacks.stackShelf(rows);
  assert.deepEqual(items.map((i) => i.kind), ["book", "stack", "book"]);
  const stack = items[1];
  assert.equal(stack.name, "Magic Tree House");
  assert.deepEqual(stack.rows.map((r) => r.id), ["mth1", "mth2", "mth3"], "books inside a stack are in series order");
  assert.equal(items[2].row.id, "other", "a series with a single book is a single card");
});

test("a stack sits where its first book was, and books without a number go last", () => {
  const items = stacks.stackShelf([row("x", "S", 0, "B"), row("y", "S", 2, "A"), row("z", "S", 1, "C")]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].rows.map((r) => r.id), ["z", "y", "x"]);
});

const sha = "a".repeat(64);
const other = "b".repeat(64);
const target = { url: "x/cover.jpg", sha256: sha };

test("cover plan: what to do with the cover that is stored", () => {
  const plan = coverPlan.coverPlan;
  assert.equal(plan({ have: false, info: undefined, stored: false, target }), "fetch", "a card with no cover gets the catalog cover");
  assert.equal(plan({ have: true, info: { source: "catalog", ref: sha }, stored: false, target }), "keep");
  assert.equal(plan({ have: true, info: { source: "catalog", ref: other }, stored: false, target }), "fetch", "the catalog picture changed");
  assert.equal(plan({ have: true, info: { source: "epub", ref: "" }, stored: true, target }), "keep", "the book's own cover stays");
  assert.equal(plan({ have: true, info: { source: "chapter", ref: "" }, stored: true, target }), "fetch", "the catalog cover beats a picture found in the text");
  assert.equal(plan({ have: true, info: undefined, stored: true, target, haveSha: sha }), "tag", "an old cover that is the catalog picture is only labelled");
  assert.equal(plan({ have: true, info: undefined, stored: true, target, haveSha: other }), "fetch");
  assert.equal(plan({ have: false, info: undefined, stored: true, target: null }), "derive", "no catalog cover: look in the stored book");
  assert.equal(plan({ have: false, info: undefined, stored: false, target: null }), "keep", "a card with no e-book and no catalog cover keeps the generated one");
  assert.equal(plan({ have: true, info: undefined, stored: true, target: null }), "keep");
  assert.equal(plan({ have: true, info: { source: "catalog", ref: "" }, stored: false, target: { url: "x", sha256: "" } }), "keep", "no version in the catalog: nothing to compare");
});

test("a catalog cover is fetched under an address that depends on its version", () => {
  assert.equal(covers.coverAddress("https://b.example/x/cover.jpg", sha), `https://b.example/x/cover.jpg?v=${sha.slice(0, 12)}`);
  assert.equal(covers.coverAddress("cover.jpg?a=1", sha), `cover.jpg?a=1&v=${sha.slice(0, 12)}`);
  assert.notEqual(covers.coverAddress("c.jpg", sha), covers.coverAddress("c.jpg", other));
  assert.equal(covers.coverAddress("c.jpg", ""), "c.jpg");
});

test("every top-menu page has its own address, and the address maps back", () => {
  const { parsePath, pathFor, menuOf } = router;
  for (const [path, kind] of [["/shelf", "shelf"], ["/discover", "discover"], ["/guide", "guide"], ["/thanks", "thanks"], ["/words", "words"], ["/review", "review"]]) {
    assert.equal(parsePath(path).kind, kind);
    assert.equal(pathFor(parsePath(path)), path);
  }
  assert.deepEqual(parsePath("/read/abc-123"), { kind: "read", bookId: "abc-123" });
  assert.deepEqual(parsePath("/words/abc"), { kind: "words", bookId: "abc" });
  assert.equal(pathFor({ kind: "read", bookId: "abc-123" }), "/read/abc-123");
  assert.equal(parsePath("/"), null);
  assert.equal(parsePath("/nope"), null);
  assert.equal(parsePath("/read"), null);
  assert.equal(parsePath("/shelf/x"), null);
  assert.equal(parsePath("/read/a/b"), null);
  assert.equal(parsePath("/read/%E0%A4%A"), null, "a broken escape is not a crash");
  assert.equal(parsePath("/read/%3Cscript%3E"), null);
  assert.equal(menuOf(parsePath("/review/x")), "words");
  assert.equal(menuOf(parsePath("/read/x")), "shelf");
  assert.equal(parsePath("/add").kind, "discover", "the old add page now lands on Discover");
  assert.equal(menuOf(parsePath("/add")), "discover");
  assert.equal(parsePath("/about").kind, "guide", "the old About page is the Guide");
  assert.equal(menuOf(parsePath("/about")), "guide");
  assert.equal(pathFor({ kind: "guide" }), "/guide");
  assert.equal(pathFor({ kind: "thanks" }), "/thanks");
  assert.equal(menuOf(parsePath("/thanks")), "thanks");
});
