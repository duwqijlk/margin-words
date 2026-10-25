import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { handleRegister } from "../functions/lib/handlers.ts";
import { handleWordFeedbackPost } from "../functions/api/feedback/word.ts";
import { handlePassageFeedbackPost } from "../functions/api/feedback/passage.ts";
import { handleAvatarPut, isWebp } from "../functions/api/auth/avatar.ts";
import { handleContributorsRebuild } from "../functions/api/contributors/rebuild.ts";
import { CONTRIBUTORS_KEY, publishContributors } from "../functions/lib/contributors.ts";
import { parseContributors } from "../src/lib/contributors-file.ts";
import { loadAppModules } from "./lib/app-modules.mjs";

const { format } = await loadAppModules();
const validateGlossary = (text) => format.validateGlossary(text);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = 1_700_000_000_000;

function openDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of [
    "0001_init.sql", "0002_nickname.sql", "0003_sponsorship.sql", "0004_roles.sql", "0005_glossary_quota.sql",
    "0006_shelf_grant.sql", "0007_word_taps.sql", "0008_word_feedback.sql", "0009_word_taps_location.sql",
    "0010_word_feedback_location.sql", "0011_word_analytics_rev_status.sql", "0012_email_verification.sql",
    "0013_feedback_suggestion.sql", "0014_contributor_credit.sql", "0015_passage_feedback.sql",
  ]) db.exec(readFileSync(join(ROOT, "migrations", name), "utf8"));
  const wrap = (sql) => {
    const stmt = db.prepare(sql);
    let args = [];
    const api = {
      bind(...values) { args = values; return api; },
      async first() { return stmt.get(...args) ?? null; },
      async all() { return { results: stmt.all(...args) }; },
      async run() { const r = stmt.run(...args); return { meta: { changes: r.changes } }; },
    };
    return api;
  };
  return { prepare: wrap, async batch(list) { return Promise.all(list.map((s) => s.run())); }, raw: db };
}

function bucket() {
  const files = new Map();
  const meta = new Map();
  return {
    files,
    meta,
    async get(key) {
      const value = files.get(key);
      if (!value) return null;
      const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
      return { body: new Blob([bytes]).stream(), arrayBuffer: async () => bytes.buffer, size: bytes.byteLength };
    },
    async put(key, value, options) {
      files.set(key, value);
      if (options?.httpMetadata) meta.set(key, options.httpMetadata);
      return {};
    },
  };
}

const request = (path, { method = "POST", cookie, body, ip = "9.9.9.9", raw } = {}) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), "cf-connecting-ip": ip, ...(raw ? {} : { "content-type": "application/json" }) },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });

async function signUp(env, email) {
  const made = await handleRegister(request("/api/auth/register", { body: { email, password: "correct horse" } }), env, {
    now: NOW,
    sendCode: async () => ({ sent: true }),
  });
  const cookie = (made.headers.get("set-cookie") ?? "").split(";")[0];
  const user = (await made.json()).user;
  return { cookie, user };
}

const report = { bookId: "wonder", bookTitle: "Wonder", word: "dive", form: "dive", chapter: 2, occurrence: 1, reason: "missing_meaning" };

test("word feedback needs a signed-in reader", async () => {
  const env = { DB: openDb() };
  const response = await handleWordFeedbackPost(request("/api/feedback/word", { body: report }), env, { now: NOW });
  assert.equal(response.status, 401);
});

test("who sent a report is kept only when it carries their own meaning", async () => {
  const db = openDb();
  const env = { DB: db };
  const { cookie, user } = await signUp(env, "reader@example.com");
  assert.match(user.publicId, /^[a-f0-9]{12}$/, "a new account gets a public id");
  await handleWordFeedbackPost(request("/api/feedback/word", { cookie, body: report }), env, { now: NOW });
  await handleWordFeedbackPost(request("/api/feedback/word", { cookie, body: { ...report, word: "plunge", suggestion: "To jump into water." } }), env, { now: NOW });
  const rows = db.raw.prepare("SELECT word, user_id FROM word_feedback ORDER BY word").all();
  assert.deepEqual(rows.map((r) => [r.word, r.user_id === null ? null : "set"]), [["dive", null], ["plunge", "set"]]);
});

test("contributors.json counts accepted meanings by place, with public ids and nicknames only", async () => {
  const db = openDb();
  const books = bucket();
  const env = { DB: db, BOOKS: books };
  const a = await signUp(env, "a@example.com");
  const b = await signUp(env, "b@example.com");
  db.raw.prepare("UPDATE users SET nickname = 'Ann' WHERE email = 'a@example.com'").run();
  for (const [who, word] of [[a, "dive"], [a, "plunge"], [a, "plunge"], [b, "soar"]]) {
    await handleWordFeedbackPost(request("/api/feedback/word", { cookie: who.cookie, ip: `${word}.1`, body: { ...report, word, suggestion: `Meaning of ${word}.` } }), env, { now: NOW });
  }
  db.raw.prepare("UPDATE word_feedback SET accepted_at = ? WHERE word IN ('dive', 'plunge')").run(NOW);
  assert.equal(await publishContributors(db, books, NOW), 1, "b has nothing accepted yet");
  const file = JSON.parse(books.files.get(CONTRIBUTORS_KEY));
  assert.deepEqual(file.people, [{ id: a.user.publicId, name: "Ann", helped: 2 }], "two places, not three reports");
  assert.doesNotMatch(books.files.get(CONTRIBUTORS_KEY), /@|example\.com/, "no email in the public file");
  assert.deepEqual(parseContributors(file), file.people);
  assert.deepEqual(parseContributors({ people: [{ id: "BAD", name: "x", helped: 1 }, null] }), [], "bad rows are dropped");

  const notAdmin = await handleContributorsRebuild(request("/api/contributors/rebuild", { cookie: a.cookie }), env, { now: NOW });
  assert.equal(notAdmin.status, 403);
});

test("an avatar must be a small WebP from a checked account, and goes to the public host", async () => {
  const db = openDb();
  const books = bucket();
  const env = { DB: db, BOOKS: books };
  const { cookie, user } = await signUp(env, "pic@example.com");
  const webp = new Uint8Array(64);
  webp.set(new TextEncoder().encode("RIFF"), 0);
  webp.set(new TextEncoder().encode("WEBP"), 8);
  assert.equal(isWebp(webp), true);
  assert.equal(isWebp(new TextEncoder().encode("<svg onload=alert(1)>")), false);

  const unchecked = await handleAvatarPut(request("/api/auth/avatar", { method: "PUT", cookie, raw: webp }), env, { now: NOW });
  assert.equal(unchecked.status, 403, "the email must be checked first");
  db.raw.prepare("UPDATE users SET email_verified_at = ? WHERE email = 'pic@example.com'").run(NOW);

  const png = await handleAvatarPut(request("/api/auth/avatar", { method: "PUT", cookie, raw: new Uint8Array(64) }), env, { now: NOW });
  assert.equal(png.status, 415);
  const big = new Uint8Array(70 * 1024);
  big.set(webp.slice(0, 12));
  assert.equal((await handleAvatarPut(request("/api/auth/avatar", { method: "PUT", cookie, raw: big }), env, { now: NOW })).status, 413);

  const ok = await handleAvatarPut(request("/api/auth/avatar", { method: "PUT", cookie, raw: webp }), env, { now: NOW });
  assert.equal(ok.status, 200);
  assert.ok(books.files.has(`avatars/${user.publicId}.webp`), "stored under the public id, not the account id");
  assert.deepEqual(
    books.meta.get(`avatars/${user.publicId}.webp`),
    { contentType: "image/webp", cacheControl: "public, max-age=31536000, immutable" },
    "kept a year by the browser and the CDN: a new picture gets a new ?v= address",
  );
});

test("an avatar changes once a day; a refused file does not use the change", async () => {
  const db = openDb();
  const books = bucket();
  const env = { DB: db, BOOKS: books };
  const { cookie } = await signUp(env, "daily@example.com");
  db.raw.prepare("UPDATE users SET email_verified_at = ? WHERE email = 'daily@example.com'").run(NOW);
  const webp = new Uint8Array(64);
  webp.set(new TextEncoder().encode("RIFF"), 0);
  webp.set(new TextEncoder().encode("WEBP"), 8);
  const put = (raw, now) => handleAvatarPut(request("/api/auth/avatar", { method: "PUT", cookie, raw }), env, { now });
  const DAY = 24 * 60 * 60 * 1000;
  const dayStart = Math.floor(NOW / DAY) * DAY;

  assert.equal((await put(new Uint8Array(64), NOW)).status, 415, "not a WebP");
  assert.equal((await put(webp, NOW)).status, 200, "the refused file did not use today's change");
  const again = await put(webp, NOW + 1000);
  assert.equal(again.status, 429);
  assert.deepEqual(await again.json(), { error: "avatar-daily", nextAt: dayStart + DAY });
  assert.equal((await put(webp, dayStart + DAY)).status, 200, "a new UTC day allows one more");
  assert.equal((await put(webp, dayStart + DAY + 5)).status, 429);
});

test("contributors.json is kept five minutes", async () => {
  const db = openDb();
  const books = bucket();
  await publishContributors(db, books, NOW);
  assert.deepEqual(books.meta.get(CONTRIBUTORS_KEY), { contentType: "application/json", cacheControl: "public, max-age=300" });
});

test("a glossary credit must be a public id", () => {
  const ok = validateGlossary(JSON.stringify({ version: 2, glossary: { dive: { meaning: "To jump in.", credit: "abc123def456", senses: [{ meaning: "To jump in.", credit: "abc123def456" }] } } }));
  assert.equal(ok.ok, true);
  assert.equal(ok.file.glossary.dive.credit, "abc123def456");
  assert.equal(ok.file.glossary.dive.senses[0].credit, "abc123def456");
  const bad = validateGlossary(JSON.stringify({ version: 2, glossary: { dive: { meaning: "To jump in.", credit: "ann@example.com" } } }));
  assert.equal(bad.ok, false);
});

test("a meaning alone is a report of its own; without text it is refused", async () => {
  const db = openDb();
  const env = { DB: db };
  const { cookie } = await signUp(env, "suggest@example.com");
  const empty = await handleWordFeedbackPost(request("/api/feedback/word", { cookie, body: { ...report, word: "lantern", reason: "suggested" } }), env, { now: NOW });
  assert.equal(empty.status, 400, "suggested needs a meaning");
  const ok = await handleWordFeedbackPost(
    request("/api/feedback/word", { cookie, body: { ...report, word: "lantern", reason: "suggested", suggestion: "A light in a box you carry." } }),
    env,
    { now: NOW },
  );
  assert.equal(ok.status, 200);
  const row = db.raw.prepare("SELECT reason, suggestion, user_id FROM word_feedback").get();
  assert.equal(row.reason, "suggested");
  assert.equal(row.suggestion, "A light in a box you carry.");
  assert.ok(row.user_id, "the reader is kept with their meaning");
});

const passage = {
  bookId: "wonder",
  bookTitle: "Wonder",
  chapter: 3,
  paragraph: 12,
  selected: "a face only a mother could love",
  before: "He said I had",
  after: ", and laughed.",
  reason: "hard",
  glossaryRev: "abc123def456",
};

test("passage help: signed in, inside the limits, one report a day unless it brings an explanation", async () => {
  const db = openDb();
  const env = { DB: db };
  const post = (body, cookie, ip = "7.7.7.7") =>
    handlePassageFeedbackPost(request("/api/feedback/passage", { body, cookie, ip }), env, { now: NOW });
  assert.equal((await post(passage, "")).status, 401, "only a signed-in reader reports");
  const { cookie, user } = await signUp(env, "passage@example.com");

  assert.equal((await post({ ...passage, selected: "x".repeat(301) }, cookie)).status, 400, "a page of the book is refused");
  assert.equal((await post({ ...passage, selected: "!" }, cookie)).status, 400);
  assert.equal((await post({ ...passage, reason: "boring" }, cookie)).status, 400);
  assert.equal((await post({ ...passage, reason: "suggested" }, cookie)).status, 400, "suggested needs text");

  assert.deepEqual(await (await post(passage, cookie)).json(), { ok: true, saved: true });
  assert.deepEqual(await (await post(passage, cookie)).json(), { ok: true, duplicate: true });
  const withHelp = await post({ ...passage, suggestion: "He means my face is not nice, as a joke." }, cookie);
  assert.deepEqual(await withHelp.json(), { ok: true, saved: true }, "a repeat with an explanation is kept");

  const rows = db.raw.prepare("SELECT selected, before, after, chapter, paragraph, reason, suggestion, user_id FROM passage_feedback ORDER BY id").all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].selected, "a face only a mother could love");
  assert.equal(rows[0].user_id, null, "no explanation, no reader id");
  assert.equal(rows[1].user_id, user.id, "kept so an accepted explanation can be credited");
  assert.equal(rows[1].chapter, 3);
  assert.equal(rows[1].paragraph, 12);
});

test("an accepted passage explanation counts in the contributor rank", async () => {
  const db = openDb();
  const books = bucket();
  const env = { DB: db, BOOKS: books };
  const a = await signUp(env, "rank@example.com");
  db.raw.prepare("UPDATE users SET nickname = 'Rae' WHERE email = 'rank@example.com'").run();
  await handlePassageFeedbackPost(
    request("/api/feedback/passage", { body: { ...passage, suggestion: "A joke: he means I am not pretty." }, cookie: a.cookie }),
    env,
    { now: NOW },
  );
  await handleWordFeedbackPost(
    request("/api/feedback/word", { body: { ...report, suggestion: "To jump in." }, cookie: a.cookie, ip: "dive.1" }),
    env,
    { now: NOW },
  );
  db.raw.prepare("UPDATE passage_feedback SET accepted_at = ?").run(NOW);
  db.raw.prepare("UPDATE word_feedback SET accepted_at = ?").run(NOW);
  await publishContributors(db, books, NOW);
  const file = JSON.parse(books.files.get(CONTRIBUTORS_KEY));
  assert.deepEqual(file.people, [{ id: a.user.publicId, name: "Rae", helped: 2 }], "one word and one passage");
});
