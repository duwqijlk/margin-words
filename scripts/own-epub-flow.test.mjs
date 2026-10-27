import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { appModuleUrl, loadAppModules } from "./lib/app-modules.mjs";

await loadAppModules();
const source = readFileSync(new URL("../src/lib/own-epub-flow.ts", import.meta.url), "utf8");
const cancelJs = ts.transpileModule(readFileSync(new URL("../src/lib/cancel-work.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const cancelUrl = `data:text/javascript,${encodeURIComponent(cancelJs)}`;
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace('"@/lib/edition-match"', JSON.stringify(appModuleUrl("edition-match"))).replace('"@/lib/cancel-work"', JSON.stringify(cancelUrl));
const { createOwnEpubFlow, needsPairConfirmation } = await import(`data:text/javascript,${encodeURIComponent(js)}`);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(overrides = {}) {
  const events = [];
  const flow = createOwnEpubFlow({
    change: (state) => events.push(["phase", state.phase]),
    hasTarget: () => true,
    targetMissing: () => new Error("Book gone"),
    save: async (preview) => { events.push(["save", preview]); return "saved-book"; },
    register: (result, preview) => events.push(["register", result, preview]),
    saved: (result, preview) => events.push(["saved", result, preview]),
    ...overrides,
  });
  return { flow, events, calls: (name) => events.filter(([event]) => event === name) };
}

const preview = (rate = 0.9, kind = "anchor") => ({
  match: { kind, rate }, percent: Math.round(rate * 100), warnings: ["spine warning"],
});

for (const [kind, rate, confirm] of [
  ["anchor", 0.9, false], ["snippet", 0.8, false], ["anchor", 0.796, true],
  ["none", 1, true], ["snippet", 0.2, true], ["anchor", NaN, true],
]) {
  test(`pair decision uses raw ${kind} rate ${rate}: confirm=${confirm}`, () => {
    assert.equal(needsPairConfirmation({ kind, rate }), confirm);
  });
}

for (const phase of ["checking", "downloading"]) {
  test(`${phase}: a verified file commits automatically, registers, then notifies with its preview`, async () => {
    const { flow, events, calls } = fixture();
    const ready = preview();
    await flow.start(async (work) => { assert.equal(work.current(), true); work.checking(); return ready; }, phase);
    assert.equal(flow.getState().phase, "done");
    assert.deepEqual(events.filter(([name]) => name !== "phase"), [
      ["save", ready], ["register", "saved-book", ready], ["saved", "saved-book", ready],
    ]);
    await flow.confirm();
    await flow.start(async () => ready, "checking");
    assert.equal(calls("save").length, 1);
    assert.equal(calls("saved").length, 1);
  });
}

for (const ready of [preview(0.796), preview(1, "none"), preview(0.1, "snippet")]) {
  test(`${ready.match.kind} ${ready.match.rate}: no storage or callback until explicit confirmation`, async () => {
    const { flow, calls } = fixture();
    await flow.start(async () => ready, "checking");
    assert.equal(flow.getState().phase, "confirm");
    assert.equal(calls("save").length, 0);
    assert.equal(calls("saved").length, 0);
    await flow.confirm();
    assert.equal(calls("save").length, 1);
    assert.equal(calls("saved").length, 1);
  });
}

test("the synchronous lock rejects duplicate file/library starts before a render", async () => {
  const load = deferred();
  const { flow, calls } = fixture();
  let loads = 0;
  const first = flow.start(async () => { loads++; return load.promise; }, "checking");
  await flow.start(async () => { loads++; return preview(); }, "downloading");
  await flow.confirm();
  assert.equal(loads, 1);
  load.resolve(preview());
  await first;
  assert.equal(calls("save").length, 1);
});

test("saving blocks close, duplicate confirmations, and new starts until success", async () => {
  const write = deferred();
  let writes = 0;
  const { flow, calls } = fixture({ save: async () => { writes++; return write.promise; } });
  await flow.start(async () => preview(0.2), "checking");
  const first = flow.confirm();
  assert.equal(flow.getState().phase, "saving");
  assert.equal(flow.cancel(), false);
  await flow.confirm();
  await flow.start(async () => preview(), "downloading");
  assert.equal(writes, 1);
  assert.equal(calls("saved").length, 0);
  write.resolve("saved-book");
  await first;
  assert.equal(calls("saved").length, 1);
});

for (const phase of ["checking", "downloading"]) {
  test(`close aborts ${phase}; a late successful preview cannot save or notify`, async () => {
    const load = deferred();
    const { flow, events, calls } = fixture();
    let work;
    const first = flow.start(async (current) => { work = current; return load.promise; }, phase);
    assert.equal(flow.cancel(), true);
    assert.equal(work.signal.aborted, true);
    assert.equal(work.current(), false);
    assert.throws(() => work.check(), /cancelled/);
    const before = events.length;
    work.checking();
    load.resolve(preview());
    await first;
    assert.equal(events.length, before);
    assert.equal(calls("save").length, 0);
    assert.equal(calls("saved").length, 0);
  });
}

test("a close synchronously rejects queued confirmation and file events before unmount", async () => {
  for (const hasPreview of [false, true]) {
    const { flow, calls } = fixture();
    if (hasPreview) await flow.start(async () => preview(0.1), "checking");
    assert.equal(flow.cancel(), true);
    await flow.confirm();
    await flow.start(async () => preview(), "checking");
    assert.equal(calls("save").length, 0);
  }
});

test("an obsolete rejection cannot replace the state of a newer operation", async () => {
  const load = deferred();
  const { flow } = fixture();
  const old = flow.start(() => load.promise, "checking");
  flow.cancel();
  flow.open();
  const ready = preview(0.2);
  await flow.start(async () => ready, "downloading");
  load.reject(new Error("Old failed download"));
  await old;
  assert.equal(flow.getState().phase, "confirm");
  assert.equal(flow.getState().preview, ready);
  assert.equal(flow.getState().error, null);
});

test("a missing shelf target is checked before automatic or confirmed writes", async () => {
  for (const rate of [0.9, 0.2]) {
    const { flow, calls } = fixture({ hasTarget: () => false });
    await flow.start(async () => preview(rate), "checking");
    if (rate < 0.8) await flow.confirm();
    assert.equal(flow.getState().phase, "error");
    assert.match(flow.getState().error.message, /Book gone/);
    assert.equal(calls("save").length, 0);
    assert.equal(calls("register").length, 0);
    assert.equal(calls("saved").length, 0);
  }
});

test("a shelf target removed during checking is not resurrected by a late match", async () => {
  const load = deferred();
  let present = true;
  const { flow, calls } = fixture({ hasTarget: () => present });
  const first = flow.start(() => load.promise, "checking");
  present = false;
  load.resolve(preview());
  await first;
  assert.equal(flow.getState().phase, "error");
  assert.equal(calls("save").length, 0);
  assert.equal(calls("saved").length, 0);
});

test("save failure retains the exact preview for retry without downloading/checking again", async () => {
  const attempts = [];
  let loads = 0;
  const { flow, calls } = fixture({ save: async (ready) => {
    attempts.push(ready);
    if (attempts.length === 1) throw new Error("Storage full");
    return "saved-book";
  } });
  const ready = preview();
  await flow.start(async () => { loads++; return ready; }, "downloading");
  assert.equal(flow.getState().phase, "error");
  assert.equal(flow.getState().preview, ready);
  assert.equal(calls("register").length, 0);
  assert.equal(calls("saved").length, 0);
  await flow.confirm();
  assert.deepEqual(attempts, [ready, ready]);
  assert.equal(loads, 1);
  assert.equal(calls("register").length, 1);
  assert.equal(calls("saved").length, 1);
});

test("registration retry never repeats a successful storage write", async () => {
  let registrations = 0;
  const { flow, calls } = fixture({ register: () => {
    registrations++;
    if (registrations === 1) throw new Error("Registration failed");
  } });
  await flow.start(async () => preview(), "checking");
  assert.equal(flow.getState().phase, "error");
  assert.equal(calls("saved").length, 0);
  await flow.confirm();
  assert.equal(calls("save").length, 1);
  assert.equal(registrations, 2);
  assert.equal(calls("saved").length, 1);
});

test("unmount or target replacement suppresses callbacks from an already-running write", async () => {
  const write = deferred();
  const { flow, calls } = fixture({ save: () => write.promise });
  const first = flow.start(async () => preview(), "checking");
  // Let the completed preview enter the non-cancellable storage phase.
  await Promise.resolve();
  assert.equal(flow.getState().phase, "saving");
  assert.equal(flow.cancel(true), true);
  write.resolve("old-book");
  await first;
  assert.equal(calls("register").length, 0);
  assert.equal(calls("saved").length, 0);
});

test("missing AbortController does not crash or allow cancelled late completion", async () => {
  const original = globalThis.AbortController;
  globalThis.AbortController = undefined;
  try {
    const load = deferred();
    const { flow, calls } = fixture();
    const running = flow.start(() => load.promise, "checking");
    assert.equal(flow.cancel(), true);
    load.resolve(preview());
    await running;
    assert.equal(calls("saved").length, 0);
    assert.equal(flow.getState().preview, null);
  } finally { globalThis.AbortController = original; }
});

test("a removed target cannot register even after a successful write", async () => {
  let present = true;
  const { flow, calls } = fixture({
    hasTarget: () => present,
    save: async () => { present = false; return "saved-book"; },
  });
  await flow.start(async () => preview(), "checking");
  assert.equal(flow.getState().phase, "error");
  assert.equal(calls("register").length, 0);
  assert.equal(calls("saved").length, 0);
});

test("cover preparation remains cancellable and cannot enter writing after close", async () => {
  const cover = deferred();
  const { flow, calls } = fixture({ prepareSave: true, save: async (_, work) => {
    await cover.promise;
    work.check();
    work.writing();
    return "saved-book";
  } });
  const running = flow.start(async () => preview(), "checking");
  await Promise.resolve();
  assert.equal(flow.getState().phase, "preparing");
  assert.equal(flow.cancel(), true);
  cover.resolve(); await running;
  assert.equal(calls("register").length, 0);
  assert.equal(calls("saved").length, 0);
  assert.equal(flow.getState().preview, null);
});
