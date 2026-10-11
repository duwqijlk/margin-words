import assert from "node:assert/strict";
import test from "node:test";
import { bookKey, matchGlossaryBook } from "../src/lib/glossary-target.ts";

const alice = {
  id: "alice",
  title: "Alice's Adventures in Wonderland",
  author: "Lewis Carroll",
  isbn: "",
  kind: "public",
};
const educated = {
  id: "educated-lite",
  title: "Educated",
  author: "Tara Westover",
  isbn: "9780399590511",
  kind: "lists",
};
const books = [alice, educated];

test("a glossary matches the public book by title when the file name is different", () => {
  const match = matchGlossaryBook(books, {
    fileId: "alice-in-wonderland-lite",
    title: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    isbn: "",
  });
  assert.equal(match && bookKey(match), "public:alice");
});

test("a file name that is already a book id wins over the title", () => {
  const match = matchGlossaryBook(books, {
    fileId: "educated-lite",
    title: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    isbn: "",
  });
  assert.equal(match && match.id, "educated-lite");
});

test("an ISBN matches when the title does not", () => {
  const match = matchGlossaryBook(books, {
    fileId: "westover-notes",
    title: "Educated: A Memoir",
    author: "",
    isbn: "978-0-399-59051-1",
  });
  assert.equal(match && match.id, "educated-lite");
});

test("two books with the same title are not an automatic match", () => {
  const other = { ...alice, id: "alice-copy", kind: "lists" };
  const match = matchGlossaryBook([alice, other], {
    fileId: "notes",
    title: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    isbn: "",
  });
  assert.equal(match, null);
});

test("a file with no title and an unknown name does not match", () => {
  const match = matchGlossaryBook(books, { fileId: "brand-new", title: "", author: "", isbn: "" });
  assert.equal(match, null);
});
