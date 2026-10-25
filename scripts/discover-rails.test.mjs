import assert from "node:assert/strict";
import test from "node:test";
import { browseRails, normalizeDiscoverRails, RAIL_SIZE, railsFor } from "../src/lib/discover-rails.ts";

const book = (title, extra = {}) => ({ kind: "list", title, lexile: "", series: "", seriesNumber: 0, ...extra });

test("browse rows: classics, then the largest series in number order; no level rows", () => {
  const books = [
    book("Alice", { kind: "classic", lexile: "880L" }),
    book("Peter Pan", { kind: "classic", lexile: "900L" }),
    book("Treasure Island", { kind: "classic", lexile: "1070L" }),
    book("MTH 3", { series: "Magic Tree House", seriesNumber: 3, lexile: "500L" }),
    book("MTH 1", { series: "Magic Tree House", seriesNumber: 1, lexile: "380L" }),
    book("MTH 2", { series: "Magic Tree House", seriesNumber: 2, lexile: "450L" }),
    book("MTH 4", { series: "Magic Tree House", seriesNumber: 4, lexile: "470L" }),
    book("WoF 2", { series: "Wings of Fire", seriesNumber: 2, lexile: "720L" }),
    book("WoF 1", { series: "Wings of Fire", seriesNumber: 1, lexile: "750L" }),
    book("Narnia", { series: "Narnia" }),
  ];
  const rails = browseRails(books);
  // Five books under 800L used to make a level row too. The Filter menu chooses a level now.
  assert.deepEqual(rails.map((rail) => rail.id), ["classic", "series:Magic Tree House"]);
  assert.deepEqual(rails[1].rows.map((b) => b.title), ["MTH 1", "MTH 2", "MTH 3", "MTH 4"]);
  assert.equal(rails.some((rail) => rail.id.startsWith("band:")), false, "no reading-level rows");
});

test("a strip is capped, and See all keeps every book", () => {
  const many = Array.from({ length: RAIL_SIZE + 5 }, (_, i) => book(`B${i}`, { kind: "classic" }));
  const [classics] = browseRails(many);
  assert.equal(classics.rows.length, RAIL_SIZE);
  assert.equal(classics.all.length, RAIL_SIZE + 5);
});

test("a collection with no number sits where its first book is", async () => {
  const { seriesPlace } = await import("../src/lib/discover-rails.ts");
  const books = [
    book("Magic Tree House 6: Afternoon", { series: "Magic Tree House", seriesNumber: 6 }),
    book("Magic Tree House Books 1-4 Collection", { series: "Magic Tree House" }),
    book("Magic Tree House 5: Night of the Ninjas", { series: "Magic Tree House", seriesNumber: 5 }),
    book("Magic Tree House Guide", { series: "Magic Tree House" }),
  ];
  const [rail] = browseRails(books);
  assert.deepEqual(rail.rows.map((b) => b.title), [
    "Magic Tree House Books 1-4 Collection",
    "Magic Tree House 5: Night of the Ninjas",
    "Magic Tree House 6: Afternoon",
    "Magic Tree House Guide",
  ]);
  assert.equal(seriesPlace({ title: "Books 5 to 8", seriesNumber: 0 }), 4.5);
});

test("a saved list is the series rows, in that order", () => {
  const books = [
    book("MTH 1", { series: "Magic Tree House", seriesNumber: 1, key: "list:mth-1" }),
    book("MTH 2", { series: "Magic Tree House", seriesNumber: 2, key: "list:mth-2" }),
    book("MTH 3", { series: "Magic Tree House", seriesNumber: 3, key: "list:mth-3" }),
    book("James", { key: "list:james" }),
    book("Matilda", { key: "list:matilda" }),
  ];
  const rails = browseRails(books, [
    { source: "series", name: "Magic Tree House" },
    { source: "custom", name: "Roald Dahl", books: ["list:matilda", "list:james", "list:missing"] },
  ]);
  assert.deepEqual(
    rails.map((rail) => rail.id),
    ["series:Magic Tree House", "curated:Roald Dahl"],
  );
  assert.deepEqual(rails[1].rows.map((item) => item.title), ["Matilda", "James"]);
});

test("an empty saved list does not invent a series row", () => {
  const books = [
    book("MTH 1", { series: "Magic Tree House", seriesNumber: 1 }),
    book("MTH 2", { series: "Magic Tree House", seriesNumber: 2 }),
    book("MTH 3", { series: "Magic Tree House", seriesNumber: 3 }),
  ];
  assert.deepEqual(
    browseRails(books, []).map((rail) => rail.id),
    [],
  );
});

test("a saved row list refuses a repeated name or a bad book key", () => {
  assert.equal(normalizeDiscoverRails({ rails: [] }).ok, true);
  assert.equal(
    normalizeDiscoverRails({
      rails: [
        { source: "custom", name: "Roald Dahl", books: ["list:james"] },
        { source: "custom", name: "Roald Dahl", books: ["list:matilda"] },
      ],
    }).ok,
    false,
  );
  assert.equal(normalizeDiscoverRails({ rails: [{ source: "custom", name: "Roald Dahl", books: ["james"] }] }).ok, false);
});

test("each Discover tab keeps its own saved rows; an old file is all Novels", () => {
  const parsed = normalizeDiscoverRails({
    rails: [
      { source: "series", name: "Magic Tree House" },
      { source: "custom", name: "Obama", books: ["classic:back-to-school", "classic:obama-inaugural-2009"], category: "speech" },
      { source: "series", name: "TED", category: "speech" },
      { source: "series", name: "Narnia", category: "novel" },
    ],
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(railsFor(parsed.rails, "novel").map((rail) => rail.name), ["Magic Tree House", "Narnia"]);
  assert.deepEqual(railsFor(parsed.rails, "speech").map((rail) => rail.name), ["Obama", "TED"]);
  assert.equal("category" in parsed.rails[3], false, "a novel row writes no category, like an old file");
  assert.equal(parsed.rails[1].category, "speech");

  // A speech row shows with the speeches, in the saved order, and never on Novels.
  const speeches = [
    book("Back to School", { kind: "classic", key: "classic:back-to-school" }),
    book("Inaugural Address", { kind: "classic", key: "classic:obama-inaugural-2009" }),
  ];
  const rails = browseRails(speeches, railsFor(parsed.rails, "speech"));
  assert.deepEqual(rails.map((rail) => rail.id), ["curated:Obama"]);
  assert.deepEqual(rails[0].rows.map((item) => item.title), ["Back to School", "Inaugural Address"]);
});

test("one name may be used once per tab, but on two tabs; an unknown tab is refused", () => {
  const both = normalizeDiscoverRails({
    rails: [
      { source: "custom", name: "Favourites", books: ["list:james"] },
      { source: "custom", name: "Favourites", books: ["list:ted-talk"], category: "speech" },
    ],
  });
  assert.equal(both.ok, true);
  const twice = normalizeDiscoverRails({
    rails: [
      { source: "series", name: "TED", category: "speech" },
      { source: "series", name: "TED", category: "speech" },
    ],
  });
  assert.equal(twice.ok, false);
  assert.equal(normalizeDiscoverRails({ rails: [{ source: "series", name: "TED", category: "poems" }] }).ok, false);
});
