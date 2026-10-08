import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSponsorUsd,
  isSponsorAdmin,
  parseUsdToCents,
  shanghaiMonthKey,
  sponsorBoards,
} from "../src/lib/sponsor.ts";

const OCT = Date.parse("2026-10-08T05:00:00Z");
const SEP = Date.parse("2026-09-15T04:00:00Z");

test("USD amounts are cents, and only one unit is accepted", () => {
  assert.equal(parseUsdToCents("10"), 1000);
  assert.equal(parseUsdToCents("10.5"), 1050);
  assert.equal(parseUsdToCents("10.50"), 1050);
  assert.equal(parseUsdToCents("0"), null);
  assert.equal(parseUsdToCents("10.555"), null);
  assert.equal(parseUsdToCents("-5"), null);
  assert.equal(parseUsdToCents("1000001"), null);
  assert.equal(formatSponsorUsd(1000), "10");
  assert.equal(formatSponsorUsd(1050), "10.50");
  assert.equal(formatSponsorUsd(123456), "1,234.56");
});

test("this month follows the China calendar", () => {
  assert.equal(shanghaiMonthKey(Date.parse("2026-09-30T15:59:59Z")), "2026-09");
  assert.equal(shanghaiMonthKey(Date.parse("2026-09-30T16:00:00Z")), "2026-10");
});

test("repeat gifts add up into this month and all time", () => {
  const boards = sponsorBoards(
    [
      { userId: "lin", name: "Lin", cents: 1000, listedAt: SEP },
      { userId: "lin", name: "Lin", cents: 500, listedAt: OCT },
      { userId: "mei", name: "Mei", cents: 2000, listedAt: OCT },
    ],
    OCT,
  );
  assert.deepEqual(boards.month, [
    { name: "Mei", cents: 2000 },
    { name: "Lin", cents: 500 },
  ]);
  assert.deepEqual(boards.total, [
    { name: "Mei", cents: 2000 },
    { name: "Lin", cents: 1500 },
  ]);
});

test("the latest display name is the one that shows", () => {
  const boards = sponsorBoards(
    [
      { userId: "lin", name: "Old", cents: 100, listedAt: SEP },
      { userId: "lin", name: "New", cents: 100, listedAt: OCT },
    ],
    OCT,
  );
  assert.equal(boards.total[0]?.name, "New");
  assert.equal(boards.total[0]?.cents, 200);
});

test("only the official address is the admin", () => {
  assert.equal(isSponsorAdmin("xcrunnnn@outlook.com"), true);
  assert.equal(isSponsorAdmin("XCRunnnn@outlook.com"), true);
  assert.equal(isSponsorAdmin("other@outlook.com"), false);
});
