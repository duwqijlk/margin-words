/**
 * The pure rules behind one-card-per-book, cover repair and the page addresses.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModules } from "./lib/app-modules.mjs";

const { identity, coverPlan, covers, router } = await loadAppModules();
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

const sha = "a".repeat(64);
const other = "b".repeat(64);
const target = { url: "x/cover.jpg", sha256: sha };

test("cover plan: what to do with the cover that is stored", () => {
  const plan = coverPlan.coverPlan;
  assert.equal(plan({ have: false, info: undefined, stored: false, target }), "fetch", "a card with no EPUB here (synced, or not paired) gets the catalog cover");
  assert.equal(plan({ have: true, info: { source: "catalog", ref: sha }, stored: false, target }), "keep", "a current catalog cover stays");
  assert.equal(plan({ have: true, info: { source: "catalog", ref: other }, stored: false, target }), "fetch", "a changed catalog cover is fetched again");
  assert.equal(plan({ have: true, info: { source: "epub", ref: "" }, stored: false, target }), "fetch", "an old EPUB cover is replaced by the catalog one while the file is missing");
  assert.equal(plan({ have: true, info: undefined, stored: false, target }), "fetch", "an unknown picture is not trusted while the file is missing");
  assert.equal(plan({ have: true, info: { source: "epub", ref: "" }, stored: true, target }), "keep", "the book's own cover stays");
  assert.equal(plan({ have: true, info: { source: "chapter", ref: "" }, stored: true, target }), "fetch", "a stored chapter cover yields to the catalog");
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
  // A page with no id is written with a trailing slash: the address the host serves (public/_redirects
  // sends /shelf to /shelf/), so a reload takes no extra redirect. The form without a slash still reads.
  for (const [path, kind] of [["/shelf/", "shelf"], ["/discover/", "discover"], ["/dashboard/", "dashboard"], ["/guide/", "guide"], ["/words/", "words"], ["/review/", "review"], ["/admin/", "admin"]]) {
    assert.equal(parsePath(path).kind, kind);
    assert.equal(pathFor(parsePath(path)), path);
    assert.equal(pathFor(parsePath(path.slice(0, -1))), path, `${path.slice(0, -1)} is the same page`);
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
  assert.equal(pathFor({ kind: "guide" }), "/guide/");
  assert.equal(pathFor({ kind: "dashboard" }), "/dashboard/");
  assert.equal(pathFor({ kind: "words", bookId: "abc" }), "/words/abc", "a page with an id has no slash");
  assert.equal(menuOf(parsePath("/dashboard")), "dashboard");
  assert.equal(parsePath("/dashboard/x"), null);
  assert.equal(parsePath("/thanks").kind, "dashboard", "the old thank-you address opens the overview");
  assert.equal(menuOf(parsePath("/thanks")), "dashboard");
  assert.equal(parsePath("/admin").kind, "admin");
  assert.equal(pathFor({ kind: "admin" }), "/admin/");
  assert.equal(parsePath(pathFor({ kind: "admin" })).kind, "admin", "the address still maps back");
  assert.equal(menuOf(parsePath("/admin")), "admin");
  assert.equal(parsePath("/admin/x"), null);
});

test("a shelf cover is the live catalog picture, found by pack id or by title, with its version", async () => {
  const { cloudCover } = await loadAppModules();
  const sha = "efd8384ea5b1".padEnd(64, "0");
  const sources = {
    classics: [{ id: "alice", title: "Alice's Adventures in Wonderland", author: "Lewis Carroll", isbn: "", cover: { url: "https://books.inputread.site/covers/public-alice.jpg", sha256: sha } }],
    lists: [
      { id: "flipped", title: "Flipped", author: "Wendelin Van Draanen", isbn: "9780375825446", cover: { url: "https://books.inputread.site/covers/lists-flipped.jpg", sha256: "a".repeat(64) } },
      { id: "nocover", title: "No Cover", author: "Someone", isbn: "", cover: null },
    ],
  };
  const pick = cloudCover.cloudCover;
  // Installed here: by pack id.
  assert.equal(pick({ title: "anything", author: "" }, "alice", sources), "https://books.inputread.site/covers/public-alice.jpg?v=efd8384ea5b1");
  // Only synced here (no pack record): by title and author, and by ISBN.
  assert.equal(pick({ title: "Alice's Adventures in Wonderland", author: "Lewis Carroll" }, undefined, sources), "https://books.inputread.site/covers/public-alice.jpg?v=efd8384ea5b1");
  assert.equal(pick({ title: "Flipped (paperback)", author: "", isbn: "978-0-375-82544-6" }, undefined, sources), "https://books.inputread.site/covers/lists-flipped.jpg?v=aaaaaaaaaaaa");
  // No catalog picture, or no catalog book: no cover (the card draws its own).
  assert.equal(pick({ title: "No Cover", author: "Someone" }, undefined, sources), "");
  assert.equal(pick({ title: "My Own Book", author: "Me" }, undefined, sources), "");
  // The same match tells the shelf a book is a speech, so its drawn cover is the talk look.
  const talk = { id: "ted-1", title: "1 thing you can do today to be happier", author: "Sonja Lyubomirsky", isbn: "", cover: null, category: "speech" };
  const withTalk = { ...sources, lists: [...sources.lists, talk] };
  assert.equal(cloudCover.catalogRowOf({ title: "anything", author: "" }, "ted-1", withTalk)?.category, "speech");
  assert.equal(cloudCover.catalogRowOf({ title: talk.title, author: talk.author }, undefined, withTalk)?.category, "speech");
  assert.equal(cloudCover.catalogRowOf({ title: "My Own Book", author: "Me" }, undefined, withTalk), undefined);
});
