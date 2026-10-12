import assert from "node:assert/strict";
import test from "node:test";
import { preferredCoverPath } from "../src/lib/cover-choice.ts";

test("a picture named cover is chosen over a larger one", () => {
  const path = preferredCoverPath([
    { path: "OEBPS/images/title_page_online.jpg", bytes: 200_000 },
    { path: "OEBPS/images/9780571376490_cover_epub.jpg", bytes: 80_000 },
    { path: "OEBPS/images/landing_rgb_online.png", bytes: 20_000 },
  ]);
  assert.equal(path, "OEBPS/images/9780571376490_cover_epub.jpg");
});

test("without a cover name, the largest picture is chosen", () => {
  const path = preferredCoverPath([
    { path: "images/a.jpg", bytes: 10 },
    { path: "images/b.png", bytes: 50 },
  ]);
  assert.equal(path, "images/b.png");
});

test("recovered is not treated as a cover name", () => {
  const path = preferredCoverPath([
    { path: "images/recovered.png", bytes: 100 },
    { path: "images/plate.jpg", bytes: 40 },
  ]);
  assert.equal(path, "images/recovered.png");
});

test("no pictures means no selection", () => {
  assert.equal(preferredCoverPath([]), null);
});
