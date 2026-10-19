import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isEinkScreen,
  calculatePageStep,
  PAGE_KEEP_LINES_DEFAULT,
  PAGE_KEEP_LINES_EINK,
} from "../src/lib/reader-paging.ts";

test("isEinkScreen detects 3:4 and 4:5 aspect ratio devices under 1024px", () => {
  // 600x800 e-ink (ratio 1.33)
  assert.equal(isEinkScreen(600, 800), true);
  // 758x1024 e-ink (ratio 1.35)
  assert.equal(isEinkScreen(758, 1024), true);
  // 1072x1448 e-ink (ratio 1.35) - desktop class without UA
  assert.equal(isEinkScreen(1072, 1448), false);
  // 1072x1448 with Boox/Kindle UA
  assert.equal(isEinkScreen(1072, 1448, "Mozilla/5.0 (Linux; Android 11; BOOX Note Air)"), true);
  // typical CSS pixels on 6-inch / 7.8-inch e-reader (e.g. 702x936)
  assert.equal(isEinkScreen(702, 936), true);
  // InkPalm 5 (360x640, ratio 1.78)
  assert.equal(isEinkScreen(360, 640), true);

  // Phone (390x844, ratio 2.16)
  assert.equal(isEinkScreen(390, 844), false);
  // Phone (412x915, ratio 2.22)
  assert.equal(isEinkScreen(412, 915), false);

  // Desktop (1280x800, ratio 0.625)
  assert.equal(isEinkScreen(1280, 800), false);
  // Desktop (1920x1080, ratio 0.56)
  assert.equal(isEinkScreen(1920, 1080), false);
});

test("calculatePageStep preserves standard 4 lines on desktop", () => {
  // 1280x800 desktop, 56px top bar, 32px line
  // visible = 800 - 56 = 744px
  // rawLines = floor(744 / 32) = 23
  // lines = 23 - 4 = 19
  // step = 19 * 32 = 608px
  const step = calculatePageStep({
    viewportWidth: 1280,
    viewportHeight: 800,
    topBarHeight: 56,
    lineHeight: 32,
  });
  assert.equal(step, 19 * 32);
});

test("calculatePageStep keeps extra tolerance on e-ink screen to prevent overshooting", () => {
  // 600x800 e-ink, 56px top bar, 36px line
  // visible = 800 - 56 = 744px
  // rawLines = floor(744 / 36) = 20
  // on e-ink: keepLines = max(8, ceil(20 * 0.42 = 8.4) = 9) = 9
  // lines = 20 - 9 = 11
  // step = 11 * 36 = 396px
  const step = calculatePageStep({
    viewportWidth: 600,
    viewportHeight: 800,
    topBarHeight: 56,
    lineHeight: 36,
  });
  assert.equal(step, 11 * 36);
  // Step is always an exact multiple of line height
  assert.equal(step % 36, 0);
  // Ensures at least 9 lines overlap (348px of overlap out of 744px)
  assert.equal(744 - step, 348);
});

test("calculatePageStep moves at least one line on very short viewports", () => {
  const step = calculatePageStep({
    viewportWidth: 600,
    viewportHeight: 180,
    topBarHeight: 56,
    lineHeight: 40,
  });
  assert.equal(step, 40);
});
