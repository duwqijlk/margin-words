import assert from "node:assert/strict";
import test from "node:test";
import { browseRails, RAIL_SIZE } from "../src/lib/discover-rails.ts";

const book = (title, extra = {}) => ({ kind: "list", title, lexile: "", series: "", seriesNumber: 0, ...extra });

test("browse rows: classics, the largest series in number order, then levels easiest first", () => {
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
  assert.deepEqual(
    rails.map((rail) => rail.id),
    ["classic", "series:Magic Tree House", "band:under800"],
  );
  assert.deepEqual(rails[1].rows.map((b) => b.title), ["MTH 1", "MTH 2", "MTH 3", "MTH 4"]);
  assert.deepEqual(rails[2].rows.map((b) => b.title).slice(0, 3), ["MTH 1", "MTH 2", "MTH 4"]);
  assert.equal(rails.find((rail) => rail.id === "band:mid"), undefined, "two books are too few for a row");
});

test("a strip is capped, and See all keeps every book", () => {
  const many = Array.from({ length: RAIL_SIZE + 5 }, (_, i) => book(`B${i}`, { kind: "classic" }));
  const [classics] = browseRails(many);
  assert.equal(classics.rows.length, RAIL_SIZE);
  assert.equal(classics.all.length, RAIL_SIZE + 5);
});
