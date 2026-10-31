// Isolated TOC modal: long-chapter performance, layout, keyboard and scroll containment.
// node scripts/reader-contents-e2e.mjs [baseUrl]
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = (process.argv[2] ?? "http://localhost:8098/").replace(/\/?$/, "/");
const browser = await chromium.launch({
  executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
let failures = 0;
const sentence =
  "The lantern seller counted the windows along the quiet street and watched the rain falling over the garden. Each house had a different door and a small light beside the gate.";
try {
  for (const width of [390, 1280]) {
    for (const locale of ["en", "zh"]) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        hasTouch: true,
      });
      await context.route("**/*", (route) =>
        new URL(route.request().url()).origin === new URL(base).origin
          ? route.continue()
          : route.abort(),
      );
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await page.addInitScript((locale) => {
          for (const key of ["cibian-tutorial-v1", "cibian-feedback-tip-v1", "cibian-quote-tip-v1"])
            localStorage.setItem(key, "seen");
          localStorage.setItem("cibian-locale-v1", locale);
        }, locale);
        await page.goto(base + "shelf");
        await page.waitForSelector("header");
        await page.evaluate(async (sentence) => {
          const paragraphs = Array.from({ length: 800 }, (_, i) => `Passage ${i}. ${sentence}`);
          const chapters = Array.from({ length: 40 }, (_, i) => ({
            title: `Chapter ${i + 1}`,
            paragraphs: i === 0 ? paragraphs : [sentence],
            html: (i === 0 ? paragraphs : [sentence]).map((p) => `<p>${p}</p>`).join(""),
          }));
          const book = {
            id: "contents-test",
            title: "Contents test",
            author: "Test",
            chapters,
            extras: [
              {
                id: "x0",
                title: "Appendix",
                paragraphs: [sentence],
                html: `<p>${sentence}</p>`,
                spineAt: 1,
                href: "appendix",
                opfHref: "appendix",
                itemId: "appendix",
              },
            ],
            glossary: {},
            pending: [],
            totalHard: 0,
          };
          const request = indexedDB.open("cibian-books", 3);
          const db = await new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          await new Promise((resolve, reject) => {
            const tx = db.transaction(["books", "notes"], "readwrite");
            tx.objectStore("books").put(book, book.id);
            tx.objectStore("notes").put({ ...book, chapters: undefined }, `gloss:${book.id}`);
            tx.objectStore("notes").put(
              { paragraphs: [], sentences: [], phrases: {} },
              `extras:${book.id}`,
            );
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
          });
          db.close();
        }, sentence);
        await page.goto(base + "read/contents-test");
        await page.waitForSelector("article p");
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(2800);
        await page.evaluate(() => {
          window.dispatchEvent(new WheelEvent("wheel"));
          window.scrollTo(0, 900);
          // Show the reader bar without changing the reading position.
          document.querySelector("article p").click();
        });
        await page.waitForTimeout(850);
        await page.evaluate(() => {
          window.dispatchEvent(new WheelEvent("wheel"));
          window.scrollTo(0, 820);
        });
        await page.waitForTimeout(850);
        const trigger = page.locator('button[aria-haspopup="dialog"]').first();
        const snapshot = () =>
          page.evaluate(() => {
            const article = document.querySelector("article");
            const p = article.querySelector("p");
            const rect = (el) => {
              const r = el.getBoundingClientRect();
              return [r.x, r.y, r.width, r.height];
            };
            return {
              y: scrollY,
              article: rect(article),
              p: rect(p),
              width: document.documentElement.clientWidth,
              height: document.documentElement.scrollHeight,
              body: document.body.getAttribute("style"),
              lock: document.body.getAttribute("data-scroll-locked"),
            };
          });
        await trigger.focus();
        const before = await snapshot();
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        const start = Date.now();
        await trigger.click();
        const panel = page.locator("[data-reader-contents]");
        await panel.waitFor();
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        const openMs = Date.now() - start;
        assert.ok(openMs < 1200, `opening took ${openMs}ms`);
        assert.deepEqual(await snapshot(), before, "opening must not move or restyle the reader");
        assert.equal(await panel.getAttribute("aria-modal"), "true");
        assert.equal(await page.locator("#root").getAttribute("aria-hidden"), "true");
        assert.ok(
          await panel.evaluate((el) => el.contains(document.activeElement)),
          "focus enters the panel",
        );
        await page.evaluate(() =>
          document.querySelector("article [data-word]").focus({ preventScroll: true }),
        );
        assert.ok(
          await panel.evaluate((el) => el.contains(document.activeElement)),
          "programmatic focus stays in panel",
        );
        const buttons = panel.locator("button");
        await buttons.last().focus();
        await page.keyboard.press("Tab");
        assert.ok(
          await buttons.first().evaluate((el) => el === document.activeElement),
          "Tab wraps",
        );
        await page.keyboard.press("Shift+Tab");
        assert.ok(
          await buttons.last().evaluate((el) => el === document.activeElement),
          "Shift+Tab wraps",
        );
        const list = panel.locator("ol");
        await list.evaluate((el) => {
          el.scrollTop = 0;
        });
        await list.hover();
        await page.mouse.wheel(0, 300);
        await page.waitForTimeout(200);
        assert.ok(await list.evaluate((el) => el.scrollTop > 0), "list scrolls");
        await list.evaluate((el) => { el.scrollTop = 0; });
        const listBox = await list.boundingBox();
        const touchX = listBox.x + listBox.width / 2;
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: touchX, y: 500 }] });
        for (const y of [480, 450, 410, 360]) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: touchX, y }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await page.waitForTimeout(250);
        assert.ok(await list.evaluate((el) => el.scrollTop > 0), "list touch scrolls");
        assert.equal(await page.evaluate(() => scrollY), before.y, "list touch leaves reader still");
        await list.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        await page.mouse.wheel(0, 800);
        await page.waitForTimeout(200);
        assert.equal(
          await page.evaluate(() => scrollY),
          before.y,
          "list edge never scrolls reader",
        );
        const backdrop = page.locator("[data-contents-backdrop]");
        await page.mouse.move(width - 30, 400);
        await page.mouse.wheel(0, 800);
        await page.waitForTimeout(200);
        assert.equal(
          await page.evaluate(() => scrollY),
          before.y,
          "backdrop wheel never scrolls reader",
        );
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x: width - 30, y: 500 }],
        });
        for (const y of [470, 430, 380, 320])
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x: width - 30, y }],
          });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await page.waitForTimeout(200);
        assert.equal(
          await page.evaluate(() => scrollY),
          before.y,
          "backdrop touch never scrolls reader",
        );
        if (width > 1000) {
          await page.mouse.move(width - 3, 45);
          await page.mouse.down();
          await page.mouse.move(width - 3, 400, { steps: 8 });
          await page.mouse.up();
          await page.waitForTimeout(200);
          assert.equal(
            await page.evaluate(() => scrollY),
            before.y,
            "scrollbar drag never moves reader",
          );
        }
        await page.evaluate(() => {
          const node = document.createElement("div");
          node.id = "contents-new-sibling";
          document.body.appendChild(node);
        });
        await page.waitForTimeout(50);
        assert.equal(
          await page.locator("#contents-new-sibling").getAttribute("aria-hidden"),
          "true",
        );
        const search = panel.locator("input");
        await search.fill("not a chapter");
        assert.equal(await list.locator("button").count(), 0);
        await page.keyboard.press("Escape");
        await panel.waitFor({ state: "detached" });
        await page.waitForTimeout(50);
        assert.ok(await trigger.evaluate((el) => el === document.activeElement), "focus returns");
        assert.equal(await page.locator("#root").getAttribute("aria-hidden"), null);
        assert.equal(await page.locator("#contents-new-sibling").getAttribute("aria-hidden"), null);
        await page.locator("#contents-new-sibling").evaluate((el) => el.remove());
        assert.deepEqual(await snapshot(), before, "closing must not move reader");
        await trigger.click();
        await panel.locator("input").fill("Chapter 35");
        await list.locator("button").filter({ hasText: "Chapter 35" }).click();
        await panel.waitFor({ state: "detached" });
        assert.match(await page.locator("header").innerText(), /Chapter 35/);
        await trigger.click();
        await panel.locator("input").fill("Appendix");
        await list.locator("button").click();
        await panel.waitFor({ state: "detached" });
        assert.match(await page.locator("header").innerText(), /Appendix/);
        await trigger.click();
        await panel.locator("input").fill("");
        assert.ok(await list.locator('[aria-current="true"]').evaluate((el) => {
          const row = el.getBoundingClientRect(); const box = el.closest("ol").getBoundingClientRect();
          return row.top >= box.top && row.bottom <= box.bottom;
        }), "current row is visible");
        await list.locator('[aria-current="true"]').click();
        await panel.waitFor({ state: "detached" });
        assert.equal(await page.evaluate(() => scrollY), 0, "same extra starts at top");
        await trigger.click();
        await backdrop.click({ position: { x: width - 30, y: 400 } });
        await panel.waitFor({ state: "detached" });
        assert.equal(
          await page.locator("[data-word-card]").count(),
          0,
          "backdrop does not open a word",
        );
        assert.deepEqual(errors, []);
        console.log(
          `PASS ${width}px ${locale}: open ${openMs}ms; focus, geometry, wheel, touch, search, chapter, extra, dismissal`,
        );
      } catch (error) {
        failures++;
        console.error(`FAIL ${width}px ${locale}: ${error.stack}`);
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
process.exitCode = failures ? 1 : 0;
