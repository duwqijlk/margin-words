/**
 * Which selections count as a whole sentence (holdsSentence in src/lib/passage-pick.ts). The label
 * goes with every passage report, and the patrol reads "sentence" as "write a sentence note". A whole
 * sentence selected without its final full stop used to be filed as a word group.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { appModuleUrl, loadAppModules } from "./lib/app-modules.mjs";

await loadAppModules();
const stub = (code) => `data:text/javascript,${encodeURIComponent(code)}`;
const source = readFileSync(new URL("../src/lib/passage-pick.ts", import.meta.url), "utf8");
const js = ts
  .transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
  .outputText.replace(/from "@\/lib\/([\w-]+)"/g, (_, name) => {
    if (name === "limits") return `from ${JSON.stringify(stub("export const PASSAGE_MAX = 600;"))}`;
    if (name === "reader-anchor") return `from ${JSON.stringify(stub("export const readerParagraphBlocks = () => [];"))}`;
    return `from ${JSON.stringify(appModuleUrl(name))}`;
  });
const { holdsSentence } = await import(stub(js));

const para =
  "But when he passed on a Sunday, that's when it hit me. The old habits were what mattered. Those seconds of pause that added up to minutes more.";
const is = (selected) => holdsSentence(selected, para, para.indexOf(selected));

test("a whole sentence is a sentence with or without its full stop", () => {
  assert.equal(is("The old habits were what mattered."), true);
  assert.equal(is("The old habits were what mattered"), true, "the stop was not selected");
  assert.equal(is("Those seconds of pause that added up to minutes more"), true, "the last sentence of the paragraph");
});

test("part of a sentence stays a word group", () => {
  assert.equal(is("old habits were what mattered"), false, "does not start where the sentence starts");
  assert.equal(is("The old habits were what"), false, "stops before the sentence ends");
  assert.equal(is("what mattered"), false, "too short");
});

test("a selection across a sentence end is a sentence", () => {
  assert.equal(is("what mattered. Those seconds of pause"), true);
});

test("a closing quote may follow the sentence's end", () => {
  const quoted = '"How can I be there for you?" she asked me again.';
  assert.equal(holdsSentence('"How can I be there for you', quoted, 0), true);
});
