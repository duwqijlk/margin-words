import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { handleRegister, handleRegisterConfirm } from "../functions/lib/handlers.ts";
import { handleWordFeedbackPost } from "../functions/api/feedback/word.ts";
import { handlePassageFeedbackPost } from "../functions/api/feedback/passage.ts";
import { handleAvatarDelete, handleAvatarPut, isWebp } from "../functions/api/auth/avatar.ts";
import { handleContributorsRebuild } from "../functions/api/contributors/rebuild.ts";
import { CONTRIBUTORS_KEY, publishContributors } from "../functions/lib/contributors.ts";
import { parseContributors } from "../src/lib/contributors-file.ts";
import { loadAppModules } from "./lib/app-modules.mjs";

const { format } = await loadAppModules();
const validateGlossary = (text) => format.validateGlossary(text);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = 1_700_000_000_000;

/** Register and finish with the emailed code: the account the tests used to get from one call. */
async function signUpFully(handlerRegister, env, input, now = NOW) {
  let code = "";
  const opts = { now, sendCode: async (message) => { code = message.code; return { sent: true }; } };
  const body = input.body ?? input;
  const started = await handlerRegister(
    new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json", ...(input.ip ? { "cf-connecting-ip": input.ip } : {}) },
      body: JSON.stringify(body),
    }),
    env,
    opts,
  );
  if (started.status !== 202) return started;
  const { ticket } = await started.json();
  return handleRegisterConfirm(
    new Request(`${input.https ? "https" : "http"}://localhost/api/auth/register/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(input.ip ? { "cf-connecting-ip": input.ip } : {}) },
      body: JSON.stringify({ email: body.email, code, ticket }),
    }),
    env,
    { now },
  );
}

function openDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of [
    "0001_init.sql", "0002_nickname.sql", "0003_sponsorship.sql", "0004_roles.sql", "0005_glossary_quota.sql",
    "0006_shelf_grant.sql", "0007_word_taps.sql", "0008_word_feedback.sql", "0009_word_taps_location.sql",
    "0010_word_feedback_location.sql", "0011_word_analytics_rev_status.sql", "0012_email_verification.sql",
    "0013_feedback_suggestion.sql", "0014_contributor_credit.sql", "0015_passage_feedback.sql", "0016_pending_signups.sql", "0017_catalog_locks.sql", "0018_signup_ticket.sql",
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
    async delete(key) {
      files.delete(key);
      meta.delete(key);
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
  const made = await signUpFully(handleRegister, env, { body: { email, password: "correct horse" } });
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

  // Every new account is checked now; an older one may not be. Set it back to test the guard.
  db.raw.prepare("UPDATE users SET email_verified_at = NULL WHERE email = 'pic@example.com'").run();
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
  const rev = (await ok.json()).avatar;
  const key = `avatars/${user.publicId}-${rev}.webp`;
  assert.ok(books.files.has(key), "stored under the public id and its version, not the account id");
  assert.deepEqual(
    books.meta.get(key),
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

  assert.equal((await post({ ...passage, selected: "x".repeat(601) }, cookie)).status, 400, "a page of the book is refused");
  assert.equal((await post({ ...passage, selected: "!" }, cookie)).status, 400);
  assert.equal((await post({ ...passage, reason: "boring" }, cookie)).status, 400);
  assert.equal((await post({ ...passage, reason: "suggested" }, cookie)).status, 400, "suggested needs text");

  assert.deepEqual(await (await post(passage, cookie)).json(), { ok: true, saved: true });
  assert.deepEqual(await (await post(passage, cookie)).json(), { ok: true, duplicate: true });
  const withHelp = await post({ ...passage, suggestion: "He means my face is not nice, as a joke." }, cookie);
  assert.deepEqual(await withHelp.json(), { ok: true, saved: true, joined: true }, "a repeat with an explanation is kept, in the same topic");

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

test("passage reports on one paragraph that overlap are one topic; apart ones are not", async () => {
  const db = openDb();
  const env = { DB: db };
  const a = await signUp(env, "long@example.com");
  const b = await signUp(env, "short@example.com");
  const c = await signUp(env, "other@example.com");
  // One sentence of 10 words: A selects all of it, B selects 3 words inside it.
  const sentence = "The old man smiled as if the lamp knew his name.";
  const base = { ...passage, paragraph: 4, before: "", after: "" };
  const post = (who, body, ip) =>
    handlePassageFeedbackPost(request("/api/feedback/passage", { body: { ...base, ...body }, cookie: who.cookie, ip }), env, { now: NOW });

  const long = await post(a, { selected: sentence, start: 0, end: sentence.length, span: "sentence", reason: "hard",
    suggestion: "He smiled like the lamp was an old friend. 'As if' means it is not true, only a feeling." }, "1.1.1.1");
  assert.deepEqual(await long.json(), { ok: true, saved: true });
  const inside = sentence.indexOf("as if the");
  const short = await post(b, { selected: "as if the", start: inside, end: inside + 9, reason: "phrase" }, "2.2.2.2");
  assert.deepEqual(await short.json(), { ok: true, saved: true, joined: true }, "B's words sit inside A's sentence");
  // Sharing words is enough: "his name." and the next sentence.
  const tail = sentence.indexOf("his name.");
  const shared = await post(c, { selected: "his name. Then he", start: tail, end: tail + 17, reason: "hard" }, "3.3.3.3");
  assert.deepEqual(await shared.json(), { ok: true, saved: true, joined: true });
  // Another part of the same paragraph, and the same words in another paragraph, are their own topics.
  const apart = await post(c, { selected: "came back at dusk", start: 120, end: 137, reason: "hard" }, "4.4.4.4");
  assert.deepEqual(await apart.json(), { ok: true, saved: true });
  const elsewhere = await post(c, { selected: "as if the", start: inside, end: inside + 9, paragraph: 9, reason: "phrase" }, "5.5.5.5");
  assert.deepEqual(await elsewhere.json(), { ok: true, saved: true });

  const rows = db.raw.prepare("SELECT id, topic, selected, span, sel_start, sel_end, suggestion FROM passage_feedback ORDER BY id").all();
  assert.equal(rows[0].topic, rows[0].id, "the first report names its topic");
  assert.equal(rows[1].topic, rows[0].id);
  assert.equal(rows[2].topic, rows[0].id);
  assert.equal(rows[3].topic, rows[3].id);
  assert.equal(rows[4].topic, rows[4].id);
  assert.equal(rows[0].span, "sentence");
  assert.equal(rows[1].sel_start, inside);
  assert.ok(rows[0].suggestion.length > 60, "a sentence explanation may be longer than a word meaning");

  // Once the topic is answered (resolved), a new report there starts a new topic.
  db.raw.prepare("UPDATE passage_feedback SET status = 'resolved' WHERE topic = ?").run(rows[0].id);
  const later = await post(b, { selected: "as if the", start: inside, end: inside + 9, reason: "wrong" }, "6.6.6.6");
  assert.deepEqual(await later.json(), { ok: true, saved: true });

  // An explanation up to 600 characters is kept whole; a longer one is cut there.
  await post(a, { selected: "came back at dusk", start: 120, end: 137, reason: "hard", suggestion: "a".repeat(700) }, "7.7.7.7");
  const kept = db.raw.prepare("SELECT suggestion FROM passage_feedback ORDER BY id DESC LIMIT 1").get();
  assert.equal(kept.suggestion.length, 600);
});

test("phrases, sentence notes and paragraph notes may carry a reader credit", () => {
  const id = "abc123def456";
  const list = {
    version: 2,
    glossary: { dive: { meaning: "To jump in." } },
    phrases: { "as if": { meaning: "In a way that seems true but is not.", credit: id } },
    sentences: [{ chapter: 0, context: "The old man smiled as if the lamp knew", simple: "He smiled like the lamp knew him.", grammar: "'as if' + past: it only seems so.", credit: id }],
    paragraphs: [{ chapter: 0, paragraph: 1, context: "The old man smiled as if the lamp knew", mainIdea: "He loves his lamps.", simple: "He smiled at the lamp like a friend.", credit: id }],
  };
  const ok = validateGlossary(JSON.stringify(list));
  assert.equal(ok.ok, true, ok.errors.join(" "));
  assert.equal(ok.file.phrases["as if"].credit, id);
  assert.equal(ok.file.sentences[0].credit, id);
  assert.equal(ok.file.paragraphs[0].credit, id);
  const bad = validateGlossary(JSON.stringify({ ...list, sentences: [{ ...list.sentences[0], credit: "Ann" }] }));
  assert.equal(bad.ok, false, "a name is not a credit");
});

test("a new picture gets its own file and the old one is deleted; removing deletes the file", async () => {
  const db = openDb();
  const books = bucket();
  const env = { DB: db, BOOKS: books };
  const { cookie, user } = await signUp(env, "pics@example.com");
  const webp = new Uint8Array(64);
  webp.set(new TextEncoder().encode("RIFF"), 0);
  webp.set(new TextEncoder().encode("WEBP"), 8);
  const DAY = 24 * 60 * 60 * 1000;
  const put = (now) => handleAvatarPut(request("/api/auth/avatar", { method: "PUT", cookie, raw: webp }), env, { now });
  const avatars = () => [...books.files.keys()].filter((key) => key.startsWith("avatars/")).sort();

  // A picture made before this change, at the one shared key.
  books.files.set(`avatars/${user.publicId}.webp`, webp);
  const first = (await (await put(NOW)).json()).avatar;
  assert.deepEqual(avatars(), [`avatars/${user.publicId}-${first}.webp`], "the old shared key is deleted too");
  const second = (await (await put(NOW + DAY)).json()).avatar;
  assert.ok(second > first);
  assert.deepEqual(avatars(), [`avatars/${user.publicId}-${second}.webp`], "only the newest picture stays");

  const removed = await handleAvatarDelete(request("/api/auth/avatar", { method: "DELETE", cookie }), env, { now: NOW + DAY });
  assert.equal(removed.status, 200);
  assert.deepEqual(avatars(), [], "a removed picture is gone from the public host");
});

test("the page and the server use one versioned picture path", async () => {
  const { avatarPath } = await import("../src/lib/contributors-file.ts");
  const { avatarKey } = await import("../functions/api/auth/avatar.ts");
  assert.equal(avatarPath("abc123def456", 1792900000), "avatars/abc123def456-1792900000.webp");
  assert.equal(avatarKey("abc123def456", 1792900000), avatarPath("abc123def456", 1792900000));
  assert.equal(avatarPath("abc123def456", 0), "");
  assert.equal(avatarPath("not-an-id", 5), "");
});
