import assert from "node:assert/strict";
import { test } from "node:test";
import { slipDistance, suggestEmail } from "../src/lib/email-typo.ts";

test("a mistyped mail host gets a suggestion", () => {
  assert.equal(suggestEmail("moxc0688@gamil.com"), "moxc0688@gmail.com");
  assert.equal(suggestEmail("Reader@GMIAL.com"), "reader@gmail.com");
  assert.equal(suggestEmail("a@gmail.con"), "a@gmail.com");
  assert.equal(suggestEmail("a@gmail.co"), "a@gmail.com");
  assert.equal(suggestEmail("a@hotmial.com"), "a@hotmail.com");
  assert.equal(suggestEmail("a@outlok.com"), "a@outlook.com");
  assert.equal(suggestEmail("a@qq.co"), "a@qq.com");
  assert.equal(suggestEmail("a@163.cn"), "a@163.com");
  assert.equal(suggestEmail("a@icluod.com"), "a@icloud.com");
});

test("a right or unknown host gets none", () => {
  for (const address of [
    "a@gmail.com",
    "a@qq.com",
    "a@163.com",
    "a@outlook.com",
    "a@company.com",
    "a@school.edu.cn",
    "a@mail.ru",
    "a@example.org",
    "not-an-email",
    "a@",
  ]) {
    assert.equal(suggestEmail(address), "", address);
  }
});

test("a swap of two letters is one slip", () => {
  assert.equal(slipDistance("gamil.com", "gmail.com"), 1);
  assert.equal(slipDistance("gmail.com", "gmail.com"), 0);
  assert.equal(slipDistance("hotmial.com", "hotmail.com"), 1);
});
