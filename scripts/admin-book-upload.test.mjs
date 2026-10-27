import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/admin-book-upload.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const { publishAdminBook } = await import(`data:text/javascript,${encodeURIComponent(js)}`);
function fixture(kind) {
  const form = new FormData();
  form.set("epub", new Blob(["original epub"]), "book.epub");
  form.set("glossary", new Blob(['{"unknown":true}']), "glossary.json");
  return {
    id: "example",
    kind,
    category: "speech",
    isbn: "",
    series: " Talks ",
    seriesNumber: " 2 ",
    glossaryText: '{ "unknown": true }\n',
    form,
  };
}
test("public books publish only one multipart request to their own catalog", async () => {
  const input = fixture("public");
  const calls = [];
  await publishAdminBook(input, {
    raw: async () => assert.fail("public must never publish the private word-list catalog"),
    wordsSaved: () => assert.fail("public must not report a separately saved list"),
    form: async (path, body) => calls.push({ path, body }),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body, input.form);
  const url = new URL(calls[0].path, "https://example.test");
  assert.equal(url.pathname, "/api/admin/books");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    id: "example",
    isbn: "",
    category: "speech",
    series: "Talks",
    seriesNumber: "2",
    kind: "public",
  });
});
test("private books preserve raw list bytes and publish in explicit two-step order", async () => {
  const input = fixture("private");
  const calls = [];
  await publishAdminBook(input, {
    raw: async (path, text) => {
      assert.equal(text, input.glossaryText);
      calls.push(path);
    },
    wordsSaved: () => calls.push("words-saved"),
    form: async (path, body) => {
      assert.equal(body, input.form);
      calls.push(path);
    },
  });
  assert.match(calls[0], /^\/api\/admin\/word-lists\?/);
  assert.equal(calls[1], "words-saved");
  assert.match(calls[2], /^\/api\/admin\/books\?.*kind=private$/);
});
test("a failed private list never uploads its EPUB", async () => {
  await assert.rejects(
    publishAdminBook(fixture("private"), {
      raw: async () => {
        throw new Error("different-book");
      },
      wordsSaved: () => assert.fail("not saved"),
      form: async () => assert.fail("must not upload"),
    }),
    /different-book/,
  );
});
test("private multipart failure is propagated after the partial-success callback", async () => {
  let saved = false;
  await assert.rejects(
    publishAdminBook(fixture("private"), {
      raw: async () => {},
      wordsSaved: () => {
        saved = true;
      },
      form: async () => {
        assert.equal(saved, true);
        throw new Error("offline");
      },
    }),
    /offline/,
  );
  assert.equal(saved, true);
});
test("clearing series also clears its number in the multipart query", async () => {
  await publishAdminBook(
    { ...fixture("public"), series: " ", seriesNumber: "99" },
    {
      raw: async () => assert.fail(),
      wordsSaved: () => assert.fail(),
      form: async (path) => {
        const params = new URL(path, "https://example.test").searchParams;
        assert.equal(params.get("series"), "");
        assert.equal(params.get("seriesNumber"), "");
      },
    },
  );
});
