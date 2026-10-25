// Auth and sync handlers against the real migration SQL (node:sqlite standing in for D1).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PBKDF2_ITERATIONS, hashPassword, verifyPassword } from "../functions/lib/password.ts";
import { rateLimitIp, sessionCookie } from "../functions/lib/http.ts";
import {
  handleDelete,
  handleEmailCodeConfirm,
  handleEmailCodeSend,
  handleExport,
  handleLogin,
  handleLogout,
  handleMe,
  handleNickname,
  handlePasswordResetConfirm,
  handlePasswordResetRequest,
  handleRegister,
  handleSyncPull,
  handleSyncPush,
} from "../functions/lib/handlers.ts";
import { handleList, handleSetRole } from "../functions/api/admin/users.ts";
import { handlePublish } from "../functions/api/admin/word-lists.ts";
import { handleGet as handleGlossaryWorkGet, handlePut as handleGlossaryWorkPut } from "../functions/api/admin/glossary-work.ts";
import { handlePut as handleQqGroupsPut } from "../functions/api/admin/qq-groups.ts";
import { handleGet as handleQqGroupsGet } from "../functions/api/qq-groups.ts";
import { handleUpload } from "../functions/api/admin/books.ts";
import { handleGet as handleBlurbGet, handlePut as handleBlurbPut } from "../functions/api/admin/blurb.ts";
import { handleGlossary } from "../functions/api/glossary/[id].ts";
import { GLOSSARY_MAX } from "../functions/lib/glossary-limit.ts";
import { GLOSSARY_WEEK_BOOKS, GLOSSARY_WEEK_MS, GLOSSARY_WEEK_SPEECHES, trustedUntil } from "../functions/lib/trust.ts";
import { handleEpub } from "../functions/api/book/[id]/epub.ts";
import { handleWordTapsPost } from "../functions/api/analytics/word-taps.ts";
import { handleAdminWordTapsGet, handleAdminWordTapsPost } from "../functions/api/admin/word-taps.ts";
import { handleWordFeedbackPost } from "../functions/api/feedback/word.ts";
import { handleAdminWordFeedbackGet, handleAdminWordFeedbackPost } from "../functions/api/admin/word-feedback.ts";
import { DAILY_WRITE_BUDGET } from "../functions/lib/rate-limit.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = 1_700_000_000_000;

function openDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of [
    "0001_init.sql",
    "0002_nickname.sql",
    "0003_sponsorship.sql",
    "0004_roles.sql",
    "0005_glossary_quota.sql",
    "0006_shelf_grant.sql",
    "0007_word_taps.sql",
    "0008_word_feedback.sql",
    "0009_word_taps_location.sql",
    "0010_word_feedback_location.sql",
    "0011_word_analytics_rev_status.sql",
    "0012_email_verification.sql",
    "0013_feedback_suggestion.sql",
    "0014_contributor_credit.sql",
    "0015_passage_feedback.sql",
  ]) {
    db.exec(readFileSync(join(ROOT, "migrations", name), "utf8"));
  }
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      const api = {
        args: [],
        bind(...values) {
          api.args = values;
          return api;
        },
        async first() {
          const row = stmt.get(...api.args);
          api.args = [];
          return row ?? null;
        },
        async all() {
          const results = stmt.all(...api.args);
          api.args = [];
          return { results };
        },
        async run() {
          stmt.run(...api.args);
          api.args = [];
          return { success: true };
        },
      };
      return api;
    },
    async batch(statements) {
      // node:sqlite has no shared transaction handle here; run in order. The
      // handlers only rely on "every statement executed and results returned".
      const results = [];
      for (const stmt of statements) {
        const rows = stmt.all ? await stmt.all() : null;
        results.push(rows ?? { results: [] });
      }
      return results;
    },
    raw: db,
  };
}

function envOf(db, extra = {}) {
  return { DB: db, ...extra };
}

async function call(handler, env, { method = "POST", path = "/", body, cookie, https = false, ip } = {}) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (ip) headers.set("cf-connecting-ip", ip);
  const request = new Request(`${https ? "https" : "http"}://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handler(request, env, { now: NOW });
}

function tokenFrom(response) {
  const raw = response.headers.get("set-cookie") ?? "";
  const match = /mw_session=([^;]*)/.exec(raw);
  return match?.[1] ?? "";
}

function cookieHeader(response) {
  const token = tokenFrom(response);
  return token ? `mw_session=${token}` : "";
}

test("password hashing uses PBKDF2-SHA256 with a per-user salt, at a count the Free plan can pay for", async () => {
  // 100k iterations measured 16.4ms of CPU in V8/BoringSSL, and a Pages Function on the Free
  // plan gets 10ms: every sign-in was cut off with error 1101. 10k measured 1.7ms. The salt is
  // what carries the security here, and an old 100k hash is rewritten on the next sign-in.
  assert.ok(PBKDF2_ITERATIONS >= 10_000, "below that the hash stops resisting offline guessing");
  assert.equal((await hashPassword("correct horse")).iterations, PBKDF2_ITERATIONS);
  const a = await hashPassword("correct horse", undefined, 1_000);
  const b = await hashPassword("correct horse", undefined, 1_000);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
  assert.equal(await verifyPassword("correct horse", a.hash, a.salt, 1_000), true);
  assert.equal(await verifyPassword("wrong horse", a.hash, a.salt, 1_000), false);
});

test("the session cookie is HttpOnly and SameSite=Lax, and Secure only on https", () => {
  const http = sessionCookie("abc", new Request("http://localhost/api/auth/login"));
  const https = sessionCookie("abc", new Request("https://inputread.site/api/auth/login"));
  assert.match(http, /HttpOnly/);
  assert.match(http, /SameSite=Lax/);
  assert.doesNotMatch(http, /Secure/);
  assert.match(https, /Secure/);
  assert.match(http, /Max-Age=2592000/);
});

test("register, login, me, logout, and a wrong password", async () => {
  const db = openDb();
  const env = envOf(db);
  const created = await call(handleRegister, env, {
    body: { email: "Reader@Example.com", password: "correct horse" },
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.user.email, "reader@example.com");
  assert.equal(createdBody.user.password_hash, undefined);
  const cookie = cookieHeader(created);
  assert.ok(cookie.startsWith("mw_session="));
  assert.doesNotMatch(created.headers.get("set-cookie") ?? "", /Secure/);

  const me = await call(handleMe, env, { method: "GET", cookie });
  assert.equal(me.status, 200);
  const meBody = await me.json();
  assert.equal(meBody.user.email, "reader@example.com");
  assert.deepEqual(meBody.glossary, { used: 0, limit: GLOSSARY_WEEK_BOOKS, resetAt: 0, unlimited: false, speech: { used: 0, limit: GLOSSARY_WEEK_SPEECHES, resetAt: 0 } });

  const bad = await call(handleLogin, env, {
    body: { email: "reader@example.com", password: "not the password" },
  });
  assert.equal(bad.status, 401);
  assert.equal((await bad.json()).error, "credentials");

  const missing = await call(handleLogin, env, {
    body: { email: "nobody@example.com", password: "correct horse" },
  });
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).error, "credentials");

  const again = await call(handleLogin, env, {
    https: true,
    body: { email: "reader@example.com", password: "correct horse" },
  });
  assert.equal(again.status, 200);
  assert.match(again.headers.get("set-cookie") ?? "", /Secure/);

  const loggedOut = await call(handleLogout, env, { cookie });
  assert.equal(loggedOut.status, 200);
  const after = await call(handleMe, env, { method: "GET", cookie });
  assert.equal(after.status, 200);
  assert.deepEqual(await after.json(), { user: null, resetEmail: false });

  const anon = await call(handleMe, env, { method: "GET" });
  assert.equal(anon.status, 200);
  assert.deepEqual(await anon.json(), { user: null, resetEmail: false });
});

test("the same email cannot register twice", async () => {
  const db = openDb();
  const env = envOf(db);
  await call(handleRegister, env, { body: { email: "reader@example.com", password: "correct horse" } });
  const second = await call(handleRegister, env, {
    body: { email: "reader@example.com", password: "another horse" },
  });
  assert.equal(second.status, 409);
  assert.equal((await second.json()).error, "email-taken");
});

test("an IPv6 rate-limit key is the /64, and an IPv4 address stays whole", () => {
  const prefix = "2001:0db8:85a3:0001::/64";
  assert.equal(rateLimitIp("2001:db8:85a3:1:1111:2222:3333:4444"), prefix);
  assert.equal(rateLimitIp("2001:0db8:85a3:1::abcd"), prefix);
  assert.notEqual(rateLimitIp("2001:db8:85a3:2::1"), prefix);
  assert.equal(rateLimitIp("203.0.113.5"), "203.0.113.5");
  assert.equal(rateLimitIp("::ffff:203.0.113.9"), "203.0.113.9");
});

test("only failed logins count toward the per-email limit, and one IPv6 /64 shares a bucket", async () => {
  const db = openDb();
  const env = envOf(db);
  await call(handleRegister, env, { body: { email: "reader@example.com", password: "correct horse" } });
  const body = { email: "reader@example.com", password: "correct horse" };
  for (let i = 0; i < 12; i += 1) {
    const ok = await call(handleLogin, env, { ip: "203.0.113.8", body });
    assert.equal(ok.status, 200);
  }
  const emailBefore = db.raw.prepare("SELECT hits FROM rate_limits WHERE bucket = ?").get("login:email:reader@example.com");
  assert.equal(emailBefore, undefined);

  const wrong = { email: "reader@example.com", password: "not the password" };
  const same = "2001:db8:85a3:4:1:2:3:4";
  const alsoSame = "2001:db8:85a3:4::ffff";
  const other = "2001:db8:85a3:5::1";
  assert.equal((await call(handleLogin, env, { ip: same, body: wrong })).status, 401);
  assert.equal((await call(handleLogin, env, { ip: alsoSame, body: wrong })).status, 401);
  assert.equal((await call(handleLogin, env, { ip: other, body: wrong })).status, 401);
  const buckets = db.raw.prepare("SELECT bucket, hits FROM rate_limits WHERE bucket LIKE 'login:ip:%' ORDER BY bucket").all();
  const shared = buckets.find((row) => row.bucket === "login:ip:2001:0db8:85a3:0004::/64");
  const separate = buckets.find((row) => row.bucket === "login:ip:2001:0db8:85a3:0005::/64");
  assert.equal(shared.hits, 2);
  assert.equal(separate.hits, 1);

  for (let i = 0; i < 7; i += 1) {
    assert.equal((await call(handleLogin, env, { ip: "198.51.100.20", body: wrong })).status, 401);
  }
  const blocked = await call(handleLogin, env, { ip: "198.51.100.21", body: wrong });
  assert.equal(blocked.status, 429);
  const locked = await call(handleLogin, env, { ip: "198.51.100.22", body });
  assert.equal(locked.status, 429);
});

test("register is rate-limited per email", async () => {
  const db = openDb();
  const env = envOf(db);
  let last = null;
  for (let i = 0; i < 6; i += 1) {
    last = await call(handleRegister, env, {
      body: { email: "reader@example.com", password: "correct horse" },
    });
  }
  assert.equal(last.status, 429);
  assert.equal((await last.json()).error, "rate");
});

test("turnstile is skipped until the secret is set, then a token is required", async () => {
  const skipped = await call(handleRegister, envOf(openDb()), {
    body: { email: "one@example.com", password: "correct horse" },
  });
  assert.equal(skipped.status, 201);

  const rejected = await handleRegister(
    new Request("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: "two@example.com",
        password: "correct horse",
        turnstileToken: "token-token-token",
      }),
    }),
    envOf(openDb(), { TURNSTILE_SECRET_KEY: "secret" }),
    { now: NOW, fetch: async () => new Response(JSON.stringify({ success: false }), { status: 200 }) },
  );
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).error, "turnstile");

  const ok = await handleRegister(
    new Request("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: "three@example.com",
        password: "correct horse",
        turnstileToken: "token-token-token",
      }),
    }),
    envOf(openDb(), { TURNSTILE_SECRET_KEY: "secret" }),
    {
      now: NOW,
      fetch: async () =>
        new Response(JSON.stringify({ success: true, action: "signup", hostname: "inputread.site" }), { status: 200 }),
    },
  );
  assert.equal(ok.status, 201);

  const wrongHost = await handleRegister(
    new Request("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: "four@example.com",
        password: "correct horse",
        turnstileToken: "token-token-token",
      }),
    }),
    envOf(openDb(), { TURNSTILE_SECRET_KEY: "secret" }),
    {
      now: NOW,
      fetch: async () =>
        new Response(JSON.stringify({ success: true, action: "signup", hostname: "evil.example" }), { status: 200 }),
    },
  );
  assert.equal(wrongHost.status, 403);
  assert.equal((await wrongHost.json()).error, "turnstile");
});

test("login does not ask for a turnstile token, even when the secret is set", async () => {
  const db = openDb();
  const created = await call(handleRegister, envOf(db), {
    body: { email: "reader@example.com", password: "correct horse" },
  });
  assert.equal(created.status, 201);

  // The challenge host does not finish on some networks in mainland China, and a reader who
  // already has an account must still be able to sign in. Registration and the reset request
  // keep the check; login is covered by the per-IP and per-email limits and by failed-login
  // counting instead.
  const env = envOf(db, { TURNSTILE_SECRET_KEY: "secret" });
  const ok = await call(handleLogin, env, {
    body: { email: "reader@example.com", password: "correct horse" },
  });
  assert.equal(ok.status, 200);

  const wrong = await call(handleLogin, env, {
    body: { email: "reader@example.com", password: "wrong horse" },
  });
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).error, "credentials");
});

test("delete removes every row, and export has no password hash", async () => {
  const db = openDb();
  const env = envOf(db);
  const created = await call(handleRegister, env, {
    body: { email: "reader@example.com", password: "correct horse" },
  });
  const cookie = cookieHeader(created);
  await call(handleSyncPush, env, {
    cookie,
    body: {
      items: [
        {
          kind: "settings",
          itemId: "main",
          updatedAt: NOW,
          deleted: false,
          data: {
            theme: "dark",
            font: "literata",
            size: 20,
            leading: 1.8,
            width: "medium",
            column: 39,
            focus: false,
            locale: "en",
            reviewLog: {},
          },
        },
      ],
    },
  });
  const exported = await call(handleExport, env, { method: "GET", cookie });
  const payload = await exported.json();
  assert.equal(payload.account.email, "reader@example.com");
  assert.equal(JSON.stringify(payload).includes("password"), false);
  assert.equal(payload.items.length, 1);

  const removed = await call(handleDelete, env, { cookie, body: { password: "correct horse" } });
  assert.equal(removed.status, 200);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM users").get().n, 0);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 0);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM sync_items").get().n, 0);
  const after = await call(handleExport, env, { method: "GET", cookie });
  assert.equal(after.status, 401);
});

test("password reset stores a token for the hook and then replaces the password", async () => {
  const db = openDb();
  const env = envOf(db);
  const created = await call(handleRegister, env, {
    body: { email: "reader@example.com", password: "correct horse" },
  });
  const cookie = cookieHeader(created);
  let captured = null;
  const requested = await handlePasswordResetRequest(
    new Request("http://localhost/api/auth/password-reset/request", {
      method: "POST",
      body: JSON.stringify({ email: "reader@example.com" }),
    }),
    env,
    {
      now: NOW,
      sendReset: async (message) => {
        captured = message;
        return { sent: false };
      },
    },
  );
  assert.equal(requested.status, 200);
  assert.equal((await requested.json()).ok, true);
  assert.equal(captured.email, "reader@example.com");
  assert.match(captured.resetUrl, /reset=/);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM password_resets").get().n, 1);

  const confirmed = await call(handlePasswordResetConfirm, env, {
    body: { token: captured.token, password: "a newer horse" },
  });
  assert.equal(confirmed.status, 200);
  const oldSession = await call(handleMe, env, { method: "GET", cookie });
  assert.equal(oldSession.status, 200);
  assert.deepEqual(await oldSession.json(), { user: null, resetEmail: false });
  const loggedIn = await call(handleLogin, env, {
    body: { email: "reader@example.com", password: "a newer horse" },
  });
  assert.equal(loggedIn.status, 200);
});

test("password reset request requires a turnstile token when the secret is set", async () => {
  const db = openDb();
  const created = await call(handleRegister, envOf(db), {
    body: { email: "reader@example.com", password: "correct horse" },
  });
  assert.equal(created.status, 201);
  const env = envOf(db, { TURNSTILE_SECRET_KEY: "secret" });
  const missing = await call(handlePasswordResetRequest, env, {
    body: { email: "reader@example.com" },
  });
  assert.equal(missing.status, 403);
  assert.equal((await missing.json()).error, "turnstile");

  const ok = await handlePasswordResetRequest(
    new Request("http://localhost/api/auth/password-reset/request", {
      method: "POST",
      body: JSON.stringify({ email: "reader@example.com", turnstileToken: "token-token-token" }),
    }),
    env,
    {
      now: NOW,
      fetch: async () =>
        new Response(JSON.stringify({ success: true, action: "reset", hostname: "inputread.site" }), { status: 200 }),
      sendReset: async () => ({ sent: false }),
    },
  );
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).ok, true);

  const wrongAction = await handlePasswordResetRequest(
    new Request("http://localhost/api/auth/password-reset/request", {
      method: "POST",
      body: JSON.stringify({ email: "reader@example.com", turnstileToken: "token-token-token" }),
    }),
    env,
    {
      now: NOW,
      fetch: async () =>
        new Response(JSON.stringify({ success: true, action: "login", hostname: "inputread.site" }), { status: 200 }),
    },
  );
  assert.equal(wrongAction.status, 403);
  assert.equal((await wrongAction.json()).error, "turnstile");
});

test("sync merges word blobs and keeps the newer shelf card", async () => {
  const db = openDb();
  const env = envOf(db);
  const created = await call(handleRegister, env, {
    body: { email: "reader@example.com", password: "correct horse" },
  });
  const cookie = cookieHeader(created);
  const key = "book:treasureisland|stevenson";
  const word = (lemma, updatedAt) => ({
    id: `id-${lemma}`,
    surface: lemma,
    lemma,
    pos: "noun",
    meaning: lemma,
    whyHard: "",
    recommend: false,
    sentence: lemma,
    stage: 0,
    dueAt: updatedAt,
    createdAt: updatedAt,
    reps: 0,
    lapses: 0,
    updatedAt,
  });
  const first = await call(handleSyncPush, env, {
    cookie,
    body: {
      items: [
        {
          kind: "words",
          itemId: key,
          updatedAt: 10,
          deleted: false,
          data: { words: [word("shore", 10)], removed: [] },
        },
        {
          kind: "shelf",
          itemId: key,
          updatedAt: 10,
          deleted: false,
          data: {
            id: "card-a",
            title: "Treasure Island",
            author: "Stevenson",
            cloth: "cloth",
            createdAt: 1,
            updatedAt: 10,
          },
        },
      ],
    },
  });
  assert.equal(first.status, 200);
  const second = await call(handleSyncPush, env, {
    cookie,
    body: {
      items: [
        {
          kind: "words",
          itemId: key,
          updatedAt: 12,
          deleted: false,
          data: { words: [word("map", 12)], removed: [] },
        },
        {
          kind: "shelf",
          itemId: key,
          updatedAt: 4,
          deleted: false,
          data: {
            id: "card-b",
            title: "Treasure Island",
            author: "Stevenson",
            cloth: "ink",
            createdAt: 1,
            updatedAt: 4,
          },
        },
      ],
    },
  });
  const saved = await second.json();
  const words = saved.items.find((item) => item.kind === "words");
  assert.deepEqual(
    words.data.words.map((item) => item.lemma).sort(),
    ["map", "shore"],
  );
  const card = saved.items.find((item) => item.kind === "shelf");
  assert.equal(card.data.id, "card-a");
  assert.equal(card.updatedAt, 10);

  const pulled = await call(handleSyncPull, env, { method: "GET", path: "/api/sync", cookie });
  assert.equal(pulled.status, 200);
  assert.equal((await pulled.json()).items.length, 2);

  const anon = await call(handleSyncPull, env, { method: "GET", path: "/api/sync" });
  assert.equal(anon.status, 401);
});

test("a nickname is optional, can be shared by two accounts, and is not a password", async () => {
  const db = openDb();
  const env = envOf(db);
  const first = await call(handleRegister, env, {
    body: { email: "one@example.com", password: "correct horse" },
  });
  const second = await call(handleRegister, env, {
    body: { email: "two@example.com", password: "correct horse" },
  });
  assert.equal((await first.json()).user.nickname, null);
  const cookieA = cookieHeader(first);
  const cookieB = cookieHeader(second);

  const missing = await call(handleNickname, env, { cookie: cookieA, body: { nickname: "   " } });
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).error, "nickname");

  const tooLong = await call(handleNickname, env, {
    cookie: cookieA,
    body: { nickname: "abcdefghijklmnopq" },
  });
  assert.equal(tooLong.status, 400);

  const savedA = await call(handleNickname, env, { cookie: cookieA, body: { nickname: "  Mina  " } });
  assert.equal(savedA.status, 200);
  assert.equal((await savedA.json()).user.nickname, "Mina");
  const savedB = await call(handleNickname, env, { cookie: cookieB, body: { nickname: "Mina" } });
  assert.equal(savedB.status, 200);
  assert.equal((await savedB.json()).user.nickname, "Mina");

  const me = await call(handleMe, env, { method: "GET", cookie: cookieA });
  assert.equal((await me.json()).user.nickname, "Mina");
  const again = await call(handleLogin, env, {
    body: { email: "one@example.com", password: "correct horse" },
  });
  assert.equal((await again.json()).user.nickname, "Mina");

  const exported = await call(handleExport, env, { method: "GET", cookie: cookieA });
  const payload = await exported.json();
  assert.equal(payload.account.nickname, "Mina");
  assert.equal(JSON.stringify(payload).includes("password_hash"), false);

  const signedOut = await call(handleNickname, env, { body: { nickname: "Mina" } });
  assert.equal(signedOut.status, 401);
});

test("admin users: gate, search, grant trusted, admin locked", async () => {
  const db = openDb();
  const env = envOf(db);
  const admin = await call(handleRegister, env, {
    body: { email: "xcrunnnn@outlook.com", password: "correct horse" },
  });
  assert.equal(admin.status, 201);
  const adminCookie = cookieHeader(admin);
  const adminId = (await admin.json()).user.id;
  const reader = await call(handleRegister, env, {
    body: { email: "reader@example.com", password: "correct horse" },
  });
  const readerCookie = cookieHeader(reader);

  const refused = await call(handleList, env, { method: "GET", cookie: readerCookie });
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error, "forbidden");

  const listed = await call(handleList, env, {
    method: "GET",
    path: "/api/admin/users?q=reader",
    cookie: adminCookie,
  });
  assert.equal(listed.status, 200);
  const payload = await listed.json();
  assert.equal(payload.total, 1);
  assert.equal(payload.users[0].email, "reader@example.com");
  assert.equal(payload.users[0].role, "user");

  const granted = await call(handleSetRole, env, {
    body: { id: payload.users[0].id, role: "trusted" },
    cookie: adminCookie,
  });
  assert.equal(granted.status, 200);
  assert.equal((await granted.json()).user.role, "trusted");
  assert.equal((await call(handleList, env, { method: "GET", path: "/api/admin/users?q=reader", cookie: adminCookie }).then((res) => res.json())).users[0].trustedUntil, null);

  const week = await call(handleSetRole, env, {
    body: { id: payload.users[0].id, role: "trusted", term: "week" },
    cookie: adminCookie,
  });
  assert.equal((await week.json()).user.trustedUntil, trustedUntil("week", NOW));
  const badTerm = await call(handleSetRole, env, {
    body: { id: payload.users[0].id, role: "trusted", term: "nope" },
    cookie: adminCookie,
  });
  assert.equal(badTerm.status, 400);
  assert.equal((await badTerm.json()).error, "bad-term");

  const revoked = await call(handleSetRole, env, {
    body: { id: payload.users[0].id, role: "user" },
    cookie: adminCookie,
  });
  const revokedBody = await revoked.json();
  assert.equal(revokedBody.user.role, "user");
  assert.equal(revokedBody.user.trustedUntil, null);

  const locked = await call(handleSetRole, env, {
    body: { id: adminId, role: "user" },
    cookie: adminCookie,
  });
  assert.equal(locked.status, 400);
  assert.equal((await locked.json()).error, "admin-locked");
});

function stubBucket(files) {
  return {
    async get(key) {
      const value = files.get(key);
      if (!value) return null;
      const copy = value.slice();
      return {
        body: new Blob([copy]).stream(),
        arrayBuffer: async () => copy.buffer,
        size: copy.byteLength,
      };
    },
    async put(key, value) {
      const bytes = typeof value === "string"
        ? new TextEncoder().encode(value)
        : value instanceof Uint8Array
          ? value
          : new Uint8Array(value);
      files.set(key, bytes);
      return {};
    },
  };
}

function raw(path, cookie, body) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body,
  });
}

test("word-list publish: hash computed once, other rows untouched, unknown id refused", async () => {
  const db = openDb();
  await call(handleRegister, envOf(db), {
    body: { email: "xcrunnnn@outlook.com", password: "correct horse" },
  });
  const login = await call(handleLogin, envOf(db), {
    body: { email: "xcrunnnn@outlook.com", password: "correct horse" },
  });
  const adminCookie = cookieHeader(login);
  const files = new Map();
  const liveCatalog = {
    format: 1,
    name: "Word lists",
    updated: "2026-10-01T00:00:00.000Z",
    lists: [
      {
        id: "charlie",
        title: "Charlie",
        words: 10,
        glossary: { url: "charlie/glossary.json", bytes: 5, sha256: "aaa" },
        updated: "2026-10-01T00:00:00+00:00",
        paragraphs: 1,
        sentences: 1,
        phrases: 1,
      },
      {
        id: "george",
        title: "George",
        words: 20,
        glossary: { url: "george/glossary.json", bytes: 6, sha256: "bbb" },
        updated: "2026-10-01T00:00:00+00:00",
        paragraphs: 2,
        sentences: 2,
        phrases: 2,
      },
    ],
  };
  files.set("word-lists/catalog.json", new TextEncoder().encode(`${JSON.stringify(liveCatalog, null, 1)}\n`));
  const env = envOf(db, { BOOKS: stubBucket(files) });

  const glossary = JSON.stringify({
    count: 3,
    glossary: { a: {}, b: {}, c: {} },
    paragraphs: [1, 2],
    sentences: [1],
    phrases: { x: 1 },
  });
  const published = await handlePublish(
    raw("/api/admin/word-lists?id=charlie", adminCookie, glossary),
    env,
    { now: NOW },
  );
  assert.equal(published.status, 200);
  const { row } = await published.json();
  assert.equal(row.words, 3);
  assert.equal(row.paragraphs, 2);
  assert.equal(row.sentences, 1);
  assert.equal(row.phrases, 1);

  const storedCatalog = JSON.parse(new TextDecoder().decode(files.get("word-lists/catalog.json")));
  const storedRow = storedCatalog.lists.find((item) => item.id === "charlie");
  assert.equal(storedRow.glossary.sha256, row.glossary.sha256);
  assert.equal(storedRow.glossary.bytes, new TextEncoder().encode(glossary).length);
  assert.equal(new TextDecoder().decode(files.get("word-lists/charlie/glossary.json")), glossary);
  assert.equal(
    storedCatalog.lists.find((item) => item.id === "george").glossary.sha256,
    "bbb",
  );

  const unknown = await handlePublish(
    raw("/api/admin/word-lists?id=nope", adminCookie, glossary),
    env,
    { now: NOW },
  );
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error, "unknown-id");

  const onboarded = await handlePublish(
    raw(
      "/api/admin/word-lists?id=brand-new-book",
      adminCookie,
      JSON.stringify({ title: "A New Book", author: "Someone", glossary: { z: {} }, count: 1 }),
    ),
    env,
    { now: NOW },
  );
  assert.equal(onboarded.status, 200);
  const storedAfter = JSON.parse(new TextDecoder().decode(files.get("word-lists/catalog.json")));
  const newRow = storedAfter.lists.find((item) => item.id === "brand-new-book");
  assert.equal(newRow.title, "A New Book");
  assert.equal(newRow.author, "Someone");
  assert.equal(newRow.words, 1);
  assert.equal(newRow.glossary.url, "brand-new-book/glossary.json");
  assert.equal(storedAfter.lists.length, 3);

  const clash = await handlePublish(
    raw(
      "/api/admin/word-lists?id=charlie-2",
      adminCookie,
      JSON.stringify({ title: "Charlie!", glossary: { z: {} }, count: 1 }),
    ),
    env,
    { now: NOW },
  );
  assert.equal(clash.status, 409);
  assert.equal((await clash.json()).error, "duplicate-title");

  const charlieBefore = storedAfter.lists.find((item) => item.id === "charlie");
  const different = await handlePublish(
    raw(
      "/api/admin/word-lists?id=charlie",
      adminCookie,
      JSON.stringify({ title: "James", author: "Percival Everett", glossary: { jim: {} }, count: 1 }),
    ),
    env,
    { now: NOW },
  );
  assert.equal(different.status, 409);
  assert.equal((await different.json()).error, "different-book");
  const afterRefuse = JSON.parse(new TextDecoder().decode(files.get("word-lists/catalog.json")));
  const charlieKept = afterRefuse.lists.find((item) => item.id === "charlie");
  assert.equal(charlieKept.title, "Charlie");
  assert.equal(charlieKept.glossary.sha256, charlieBefore.glossary.sha256);
  assert.equal(new TextDecoder().decode(files.get("word-lists/charlie/glossary.json")), glossary);

  const sameBook = await handlePublish(
    raw(
      "/api/admin/word-lists?id=charlie",
      adminCookie,
      JSON.stringify({ title: "Charlie!", glossary: { a: {}, b: {}, c: {}, d: {} }, count: 4 }),
    ),
    env,
    { now: NOW },
  );
  assert.equal(sameBook.status, 200);
  const sameBody = await sameBook.json();
  assert.equal(sameBody.row.title, "Charlie");
  assert.equal(sameBody.row.words, 4);

  const edition = await handlePublish(
    raw(
      "/api/admin/word-lists?id=charlie",
      adminCookie,
      JSON.stringify({ title: "Charlie: A Novel", glossary: { a: {} }, count: 1 }),
    ),
    env,
    { now: NOW },
  );
  assert.equal(edition.status, 200);
  assert.equal((await edition.json()).row.title, "Charlie");

  // ?category= moves a book between the novel and speech tabs (and weekly counts).
  const george = JSON.stringify({ title: "George", glossary: { a: {} }, count: 1 });
  const stored = () => JSON.parse(new TextDecoder().decode(files.get("word-lists/catalog.json")));
  const toSpeech = await handlePublish(
    raw("/api/admin/word-lists?id=george&category=speech", adminCookie, george),
    env,
    { now: NOW },
  );
  assert.equal(toSpeech.status, 200);
  assert.equal(stored().lists.find((item) => item.id === "george").category, "speech");
  const kept = await handlePublish(raw("/api/admin/word-lists?id=george", adminCookie, george), env, { now: NOW });
  assert.equal(kept.status, 200);
  assert.equal(stored().lists.find((item) => item.id === "george").category, "speech");
  // ?series= gives a speech (or a novel) its series row; an empty name removes it.
  const toSeries = await handlePublish(
    raw("/api/admin/word-lists?id=george&series=TED&seriesNumber=3", adminCookie, george),
    env,
    { now: NOW },
  );
  assert.equal(toSeries.status, 200);
  let georgeRow = stored().lists.find((item) => item.id === "george");
  assert.equal(georgeRow.series, "TED");
  assert.equal(georgeRow.seriesNumber, 3);
  assert.equal(georgeRow.category, "speech", "the category stays when only the series changes");
  await handlePublish(raw("/api/admin/word-lists?id=george&series=TED&seriesNumber=abc", adminCookie, george), env, { now: NOW });
  georgeRow = stored().lists.find((item) => item.id === "george");
  assert.equal(georgeRow.series, "TED");
  assert.equal("seriesNumber" in georgeRow, false, "a number that is not a whole number above 0 is dropped");
  await handlePublish(raw("/api/admin/word-lists?id=george&series=&seriesNumber=", adminCookie, george), env, { now: NOW });
  georgeRow = stored().lists.find((item) => item.id === "george");
  assert.equal("series" in georgeRow, false, "an empty name removes the series");
  const toNovel = await handlePublish(
    raw("/api/admin/word-lists?id=george&category=novel", adminCookie, george),
    env,
    { now: NOW },
  );
  assert.equal(toNovel.status, 200);
  assert.equal("category" in stored().lists.find((item) => item.id === "george"), false);

  const editionClash = await handlePublish(
    raw(
      "/api/admin/word-lists?id=charlie-edition",
      adminCookie,
      JSON.stringify({ title: "Charlie: A Memoir", glossary: { a: {} }, count: 1 }),
    ),
    env,
    { now: NOW },
  );
  assert.equal(editionClash.status, 409);
  assert.equal((await editionClash.json()).error, "duplicate-title");

  const sequel = await handlePublish(
    raw(
      "/api/admin/word-lists?id=charlie",
      adminCookie,
      JSON.stringify({ title: "Charlie: Catching Fire", glossary: { a: {} }, count: 1 }),
    ),
    env,
    { now: NOW },
  );
  assert.equal(sequel.status, 409);
  assert.equal((await sequel.json()).error, "different-book");

  const sized = glossaryOfLength(4_000_001);
  assert.equal(sized.length, 4_000_001);
  const accepted = await handlePublish(
    raw("/api/admin/word-lists?id=charlie", adminCookie, sized),
    env,
    { now: NOW },
  );
  assert.equal(accepted.status, 200);
  const acceptedBody = await accepted.json();
  assert.equal(acceptedBody.row.title, "Charlie");
  assert.equal(acceptedBody.row.words, 1);
  assert.equal(acceptedBody.row.glossary.bytes, 4_000_001);

  const beforeHuge = new TextDecoder().decode(files.get("word-lists/charlie/glossary.json"));
  const refusedSize = await handlePublish(
    raw("/api/admin/word-lists?id=charlie", adminCookie, "x".repeat(GLOSSARY_MAX + 1)),
    env,
    { now: NOW },
  );
  assert.equal(refusedSize.status, 413);
  assert.equal((await refusedSize.json()).error, "too-large");
  assert.equal(new TextDecoder().decode(files.get("word-lists/charlie/glossary.json")), beforeHuge);
});

function glossaryOfLength(length) {
  const head = '{"title":"Charlie","count":1,"glossary":{"word":{}},"note":"';
  const tail = '"}';
  return head + "x".repeat(length - head.length - tail.length) + tail;
}

test("public glossary update replaces the list and keeps the epub", async () => {
  const db = openDb();
  await call(handleRegister, envOf(db), {
    body: { email: "xcrunnnn@outlook.com", password: "correct horse" },
  });
  const login = await call(handleLogin, envOf(db), {
    body: { email: "xcrunnnn@outlook.com", password: "correct horse" },
  });
  const adminCookie = cookieHeader(login);
  const files = new Map();
  const live = {
    format: 1,
    packs: [
      {
        id: "alice",
        title: "Alice's Adventures in Wonderland",
        author: "Lewis Carroll",
        rev: "oldrevoldrev",
        words: 10,
        epub: { url: "alice/book.epub", bytes: 4, sha256: "abc" },
        glossary: { url: "alice/glossary.json", bytes: 2, sha256: "dd", rev: "dd" },
      },
      {
        id: "looking-glass",
        title: "Through the Looking-Glass",
        rev: "keepmekeepme",
        words: 7,
        epub: { url: "looking-glass/book.epub", bytes: 4, sha256: "eee" },
        glossary: { url: "looking-glass/glossary.json", bytes: 2, sha256: "ff", rev: "ff" },
      },
    ],
  };
  files.set("public-books/catalog.json", new TextEncoder().encode(`${JSON.stringify(live, null, 1)}\n`));
  files.set("public-books/alice/book.epub", new Uint8Array([9, 9, 9, 9]));
  const env = envOf(db, { BOOKS: stubBucket(files) });
  const glossary = JSON.stringify({
    title: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    glossary: { rabbit: {}, tea: {} },
    phrases: { "the present": {} },
  });
  const published = await handlePublish(
    raw("/api/admin/word-lists?id=alice&catalog=public", adminCookie, glossary),
    env,
    { now: NOW },
  );
  assert.equal(published.status, 200);
  const body = await published.json();
  assert.equal(body.catalog, "public");
  assert.equal(body.row.words, 2);
  assert.equal(body.row.phrases, 1);
  assert.equal(body.row.epub.sha256, "abc");
  assert.equal(body.row.rev, body.row.glossary.sha256.slice(0, 12));
  assert.notEqual(body.row.rev, "oldrevoldrev");

  const stored = JSON.parse(new TextDecoder().decode(files.get("public-books/catalog.json")));
  const alice = stored.packs.find((item) => item.id === "alice");
  const other = stored.packs.find((item) => item.id === "looking-glass");
  assert.equal(alice.glossary.sha256, body.row.glossary.sha256);
  assert.equal(alice.epub.sha256, "abc");
  assert.equal(other.rev, "keepmekeepme");
  assert.equal(new TextDecoder().decode(files.get("public-books/alice/glossary.json")), glossary);
  assert.equal(files.has("word-lists/catalog.json"), false);
  assert.deepEqual([...files.get("public-books/alice/book.epub")], [9, 9, 9, 9]);

  const missing = await handlePublish(
    raw("/api/admin/word-lists?id=no-such-book&catalog=public", adminCookie, glossary),
    env,
    { now: NOW },
  );
  assert.equal(missing.status, 404);

  files.set(
    "word-lists/catalog.json",
    new TextEncoder().encode(`${JSON.stringify({ format: 1, lists: [] }, null, 1)}\n`),
  );
  const duplicate = await handlePublish(
    raw(
      "/api/admin/word-lists?id=alice-in-wonderland-lite",
      adminCookie,
      JSON.stringify({ title: "Alice's Adventures in Wonderland", glossary: { a: {} } }),
    ),
    env,
    { now: NOW },
  );
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error, "duplicate-title");
});

test("private epub: user denied, trusted allowed and logged, missing book 404", async () => {
  const db = openDb();
  const reader = await call(handleRegister, envOf(db), {
    body: { email: "reader@example.com", password: "correct horse" },
  });
  const readerCookie = cookieHeader(reader);
  const readerId = (await reader.json()).user.id;
  // grant trusted through the handler (admin cookie needed)
  const admin = await call(handleRegister, envOf(db), {
    body: { email: "xcrunnnn@outlook.com", password: "correct horse" },
  });
  const adminCookie = cookieHeader(admin);
  const listed = await call(handleList, envOf(db), { method: "GET", cookie: adminCookie });
  const target = (await listed.json()).users.find((item) => item.email === "reader@example.com");
  await call(handleSetRole, envOf(db), { body: { id: target.id, role: "trusted" }, cookie: adminCookie });

  const files = new Map([["great-book/book.epub", new Uint8Array([1, 2, 3])]]);
  const env = envOf(db, { PRIVATE: stubBucket(files) });

  const denied = await handleEpub(raw("/api/book/great-book/epub", ""), env, "great-book", { now: NOW });
  assert.equal(denied.status, 401);

  const reLogin = await call(handleLogin, envOf(db), {
    body: { email: "reader@example.com", password: "correct horse" },
  });
  const freshCookie = cookieHeader(reLogin);
  const ok = await handleEpub(raw("/api/book/great-book/epub", freshCookie), env, "great-book", { now: NOW });
  assert.equal(ok.status, 200);
  assert.equal(new Uint8Array(await ok.arrayBuffer())[0], 1);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM book_downloads").get().n, 1);

  const missing = await handleEpub(raw("/api/book/no-such-book/epub", freshCookie), env, "no-such-book", { now: NOW });
  assert.equal(missing.status, 404);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM book_downloads").get().n, 1);
  assert.equal(readerId !== "", true);

  await call(handleSetRole, envOf(db), {
    body: { id: target.id, role: "trusted", term: "week" },
    cookie: adminCookie,
  });
  const expired = await handleEpub(raw("/api/book/great-book/epub", freshCookie), env, "great-book", {
    now: NOW + 8 * 24 * 60 * 60 * 1000,
  });
  assert.equal(expired.status, 403);
  const me = await handleMe(raw("/api/auth/me", freshCookie), envOf(db), {
    now: NOW + 8 * 24 * 60 * 60 * 1000,
  });
  const meBody = await me.json();
  assert.equal(meBody.user.role, "user");
  assert.deepEqual(meBody.glossary, { used: 0, limit: GLOSSARY_WEEK_BOOKS, resetAt: 0, unlimited: false, speech: { used: 0, limit: GLOSSARY_WEEK_SPEECHES, resetAt: 0 } });
});

test("word-list reads: seven new books a week, an old book stays free, trusted is unlimited", async () => {
  const db = openDb();
  const reader = await call(handleRegister, envOf(db), {
    body: { email: "reader@example.com", password: "correct horse" },
  });
  const readerCookie = cookieHeader(reader);
  const readerId = (await reader.json()).user.id;
  // This test is about the weekly cap, for a reader who already checked their email.
  db.raw.prepare("UPDATE users SET email_verified_at = ? WHERE id = ?").run(NOW, readerId);
  const admin = await call(handleRegister, envOf(db), {
    body: { email: "xcrunnnn@outlook.com", password: "correct horse" },
  });
  const adminCookie = cookieHeader(admin);
  const files = new Map();
  const text = (id) => new TextEncoder().encode(`{"glossary":{"${id}":{}}}`);
  files.set("public-books/public-one/glossary.json", text("public-one"));
  for (let n = 1; n <= 8; n += 1) files.set(`word-lists/book-${n}/glossary.json`, text(`book-${n}`));
  const env = envOf(db, { BOOKS: stubBucket(files) });
  const open = (id, cookie, now = NOW) => handleGlossary(raw(`/api/glossary/${id}`, cookie), env, id, { now });
  const later = NOW + GLOSSARY_WEEK_MS + 1;

  assert.equal((await open("book-1", "")).status, 401);
  assert.equal((await open("missing-book", readerCookie)).status, 404);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM glossary_reads").get().n, 0);
  assert.equal((await open("public-one", readerCookie)).status, 200);
  for (let n = 1; n <= 6; n += 1) assert.equal((await open(`book-${n}`, readerCookie)).status, 200);
  assert.equal((await open("book-1", readerCookie)).status, 200);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM glossary_reads").get().n, 7);
  const capped = await handleMe(raw("/api/auth/me", readerCookie), envOf(db), { now: NOW });
  assert.deepEqual((await capped.json()).glossary, { used: 7, limit: GLOSSARY_WEEK_BOOKS, resetAt: NOW + GLOSSARY_WEEK_MS, unlimited: false, speech: { used: 0, limit: GLOSSARY_WEEK_SPEECHES, resetAt: 0 } });

  const blocked = await open("book-7", readerCookie);
  assert.equal(blocked.status, 429);
  assert.deepEqual(await blocked.json(), { error: "glossary-week", resetAt: NOW + GLOSSARY_WEEK_MS });
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM glossary_reads").get().n, 7);

  // Another device, a week later: a book already opened is free and takes no new place.
  assert.equal((await open("book-1", readerCookie, later)).status, 200);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM glossary_reads").get().n, 7);
  assert.equal((await open("book-7", readerCookie, later)).status, 200);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM glossary_reads").get().n, 8);
  const laterMe = await handleMe(raw("/api/auth/me", readerCookie), envOf(db), { now: later });
  assert.deepEqual((await laterMe.json()).glossary, { used: 1, limit: GLOSSARY_WEEK_BOOKS, resetAt: later + GLOSSARY_WEEK_MS, unlimited: false, speech: { used: 0, limit: GLOSSARY_WEEK_SPEECHES, resetAt: 0 } });

  const listed = await call(handleList, envOf(db), { method: "GET", cookie: adminCookie });
  const target = (await listed.json()).users.find((item) => item.id === readerId);
  await call(handleSetRole, envOf(db), {
    body: { id: target.id, role: "trusted", term: "forever" },
    cookie: adminCookie,
  });
  const reads = db.raw.prepare("SELECT COUNT(*) AS n FROM glossary_reads").get().n;
  assert.equal((await open("book-8", readerCookie)).status, 200);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM glossary_reads").get().n, reads);
  const trustedMe = await handleMe(raw("/api/auth/me", readerCookie), envOf(db), { now: NOW });
  assert.deepEqual((await trustedMe.json()).glossary, { used: 0, limit: GLOSSARY_WEEK_BOOKS, resetAt: 0, unlimited: true, speech: { used: 0, limit: GLOSSARY_WEEK_SPEECHES, resetAt: 0 } });
});

test("word-list reads: speeches have their own seven a week, apart from novels", async () => {
  const db = openDb();
  const reader = await call(handleRegister, envOf(db), {
    body: { email: "speech-reader@example.com", password: "correct horse" },
  });
  const readerCookie = cookieHeader(reader);
  const readerId = (await reader.json()).user.id;
  db.raw.prepare("UPDATE users SET email_verified_at = ? WHERE id = ?").run(NOW, readerId);
  const files = new Map();
  const text = (id) => new TextEncoder().encode(`{"glossary":{"${id}":{}}}`);
  const lists = [];
  for (let n = 1; n <= 8; n += 1) {
    files.set(`word-lists/novel-${n}/glossary.json`, text(`novel-${n}`));
    lists.push({ id: `novel-${n}`, title: `Novel ${n}` });
  }
  for (let n = 1; n <= 7; n += 1) {
    files.set(`word-lists/talk-${n}/glossary.json`, text(`talk-${n}`));
    lists.push({ id: `talk-${n}`, title: `Talk ${n}`, category: "speech" });
  }
  files.set("public-books/speech-8/glossary.json", text("speech-8"));
  files.set("word-lists/catalog.json", new TextEncoder().encode(JSON.stringify({ lists })));
  files.set(
    "public-books/catalog.json",
    new TextEncoder().encode(JSON.stringify({ packs: [{ id: "speech-8", title: "Speech 8", category: "speech" }] })),
  );
  const env = envOf(db, { BOOKS: stubBucket(files) });
  const open = (id) => handleGlossary(raw(`/api/glossary/${id}`, readerCookie), env, id, { now: NOW });

  for (let n = 1; n <= 7; n += 1) assert.equal((await open(`novel-${n}`)).status, 200);
  // Seven novels do not use any speech place.
  for (let n = 1; n <= 7; n += 1) assert.equal((await open(`talk-${n}`)).status, 200);
  const novelFull = await open("novel-8");
  assert.equal(novelFull.status, 429);
  assert.equal((await novelFull.json()).error, "glossary-week");
  const speechFull = await open("speech-8");
  assert.equal(speechFull.status, 429);
  assert.deepEqual(await speechFull.json(), { error: "glossary-week-speech", resetAt: NOW + GLOSSARY_WEEK_MS });
  // A speech opened before still downloads.
  assert.equal((await open("talk-1")).status, 200);
  const me = await handleMe(raw("/api/auth/me", readerCookie), env, { now: NOW });
  assert.deepEqual((await me.json()).glossary, {
    used: 7,
    limit: GLOSSARY_WEEK_BOOKS,
    resetAt: NOW + GLOSSARY_WEEK_MS,
    unlimited: false,
    speech: { used: 7, limit: GLOSSARY_WEEK_SPEECHES, resetAt: NOW + GLOSSARY_WEEK_MS },
  });
});

test("a new account opens word lists only after the emailed code", async () => {
  const db = openDb();
  const files = new Map([["word-lists/book-1/glossary.json", new TextEncoder().encode('{"glossary":{"a":{}}}')]]);
  const env = envOf(db, { BOOKS: stubBucket(files) });
  const sent = [];
  const sendCode = async (message) => {
    sent.push(message);
    return { sent: true };
  };
  const post = (path, body, cookie) =>
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: cookie ? { cookie } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const made = await handleRegister(post("/api/auth/register", { email: "new@example.com", password: "correct horse" }), env, { now: NOW, sendCode });
  assert.equal(made.status, 201);
  const madeBody = await made.json();
  assert.equal(madeBody.user.emailVerified, false);
  assert.equal(madeBody.codeSent, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].email, "new@example.com");
  assert.match(sent[0].code, /^\d{6}$/);
  assert.notEqual(db.raw.prepare("SELECT code_hash FROM email_codes").get().code_hash, sent[0].code, "only a hash is stored");
  const cookie = cookieHeader(made);

  const blocked = await handleGlossary(raw("/api/glossary/book-1", cookie), env, "book-1", { now: NOW });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error, "email-unverified");

  // Send again right away is refused, so a double click does not spend a second message.
  const tooSoon = await handleEmailCodeSend(post("/api/auth/email-code/send", {}, cookie), env, { now: NOW + 1000, sendCode });
  assert.equal(tooSoon.status, 429);
  assert.equal((await tooSoon.json()).error, "code-wait");

  const wrong = sent[0].code === "000000" ? "111111" : "000000";
  const bad = await handleEmailCodeConfirm(post("/api/auth/email-code/confirm", { code: wrong }, cookie), env, { now: NOW });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, "code");

  const good = await handleEmailCodeConfirm(post("/api/auth/email-code/confirm", { code: sent[0].code }, cookie), env, { now: NOW });
  assert.equal(good.status, 200);
  assert.equal((await good.json()).user.emailVerified, true);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM email_codes").get().n, 0, "the used code is gone");
  assert.equal((await handleGlossary(raw("/api/glossary/book-1", cookie), env, "book-1", { now: NOW })).status, 200);
});

test("five wrong codes end that code, and an old one stops working", async () => {
  const db = openDb();
  const env = envOf(db);
  const sent = [];
  const sendCode = async (message) => {
    sent.push(message);
    return { sent: true };
  };
  const post = (path, body, cookie) =>
    new Request(`http://localhost${path}`, { method: "POST", headers: cookie ? { cookie } : {}, body: JSON.stringify(body) });
  const made = await handleRegister(post("/api/auth/register", { email: "guess@example.com", password: "correct horse" }), env, { now: NOW, sendCode });
  const cookie = cookieHeader(made);
  const wrong = sent[0].code === "000000" ? "111111" : "000000";
  for (let n = 0; n < 5; n += 1) {
    const response = await handleEmailCodeConfirm(post("/api/auth/email-code/confirm", { code: wrong }, cookie), env, { now: NOW });
    assert.equal((await response.json()).error, "code");
  }
  const locked = await handleEmailCodeConfirm(post("/api/auth/email-code/confirm", { code: sent[0].code }, cookie), env, { now: NOW });
  assert.equal((await locked.json()).error, "code-expired", "after five misses even the right code is refused");

  // A new code (a minute later) works, and the old one does not.
  const again = await handleEmailCodeSend(post("/api/auth/email-code/send", {}, cookie), env, { now: NOW + 61_000, sendCode });
  assert.equal(again.status, 200);
  assert.equal(sent.length, 2);
  if (sent[0].code !== sent[1].code) {
    const old = await handleEmailCodeConfirm(post("/api/auth/email-code/confirm", { code: sent[0].code }, cookie), env, { now: NOW + 62_000 });
    assert.equal((await old.json()).error, "code");
  }
  const expired = await handleEmailCodeConfirm(post("/api/auth/email-code/confirm", { code: sent[1].code }, cookie), env, { now: NOW + 61_000 + 15 * 60 * 1000 + 1 });
  assert.equal((await expired.json()).error, "code-expired", "a code works for 15 minutes");
});

test("accounts made before the email check count as checked", async () => {
  const db = openDb();
  const migrated = db.raw.prepare("SELECT COUNT(*) AS n FROM users WHERE email_verified_at IS NULL").get().n;
  assert.equal(migrated, 0);
  const sql = readFileSync(join(ROOT, "migrations", "0012_email_verification.sql"), "utf8");
  assert.match(sql, /UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL/);
});

test("a book already on the shelf can be downloaded when the week is full", async () => {
  const db = openDb();
  const reader = await call(handleRegister, envOf(db), {
    body: { email: "reader@example.com", password: "correct horse" },
  });
  const readerCookie = cookieHeader(reader);
  const readerId = (await reader.json()).user.id;
  db.raw.prepare("UPDATE users SET email_verified_at = ? WHERE id = ?").run(NOW, readerId);
  const files = new Map();
  const text = (id) => new TextEncoder().encode(`{"glossary":{"${id}":{}}}`);
  const catalog = {
    format: 1,
    lists: [
      { id: "owned-book", title: "Owned Book", author: "Ada Lovelace" },
      { id: "fresh-book", title: "Fresh Book", author: "Ada Lovelace" },
    ],
  };
  files.set("word-lists/catalog.json", new TextEncoder().encode(JSON.stringify(catalog)));
  files.set("word-lists/owned-book/glossary.json", text("owned"));
  files.set("word-lists/fresh-book/glossary.json", text("fresh"));
  for (let n = 1; n <= 7; n += 1) files.set(`word-lists/book-${n}/glossary.json`, text(`book-${n}`));
  const env = envOf(db, { BOOKS: stubBucket(files) });
  const open = (id) => handleGlossary(raw(`/api/glossary/${id}`, readerCookie), env, id, { now: NOW });
  db.raw
    .prepare(
      "INSERT INTO sync_items (user_id, kind, item_id, data, updated_at, deleted, grant_title, grant_author, grant_isbn) VALUES (?, 'shelf', 'book:owned', '{}', ?, 0, 'Owned Book', 'Ada Lovelace', '')",
    )
    .run(readerId, NOW);
  db.raw
    .prepare(
      "INSERT INTO sync_items (user_id, kind, item_id, data, updated_at, deleted, grant_title, grant_author, grant_isbn) VALUES (?, 'shelf', 'book:fresh', ?, ?, 0, '', '', '')",
    )
    .run(readerId, JSON.stringify({ title: "Fresh Book", author: "Ada Lovelace" }), NOW);

  for (let n = 1; n <= 7; n += 1) assert.equal((await open(`book-${n}`)).status, 200);
  assert.equal((await open("fresh-book")).status, 429);
  assert.equal((await open("owned-book")).status, 200);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM glossary_reads WHERE created_at > 0").get().n, 7);
  assert.equal(db.raw.prepare("SELECT created_at AS at FROM glossary_reads WHERE book_id = 'owned-book'").get().at, 0);
  const me = await handleMe(raw("/api/auth/me", readerCookie), envOf(db), { now: NOW });
  assert.deepEqual((await me.json()).glossary, { used: 7, limit: GLOSSARY_WEEK_BOOKS, resetAt: NOW + GLOSSARY_WEEK_MS, unlimited: false, speech: { used: 0, limit: GLOSSARY_WEEK_SPEECHES, resetAt: 0 } });
  assert.equal((await open("owned-book")).status, 200);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM glossary_reads WHERE book_id = 'owned-book'").get().n, 1);
});

test("book upload: private streams to PRIVATE, public updates its catalog row", async () => {
  const db = openDb();
  const admin = await call(handleRegister, envOf(db), {
    body: { email: "xcrunnnn@outlook.com", password: "correct horse" },
  });
  const adminCookie = cookieHeader(admin);
  const epubBytes = new Uint8Array([80, 75, 3, 4, 9, 9]);
  const coverBytes = new Uint8Array([255, 216, 255, 1, 2]);

  function formWith(kindFiles) {
    const form = new FormData();
    form.set("epub", new File([epubBytes], "book.epub", { type: "application/epub+zip" }));
    if (kindFiles.cover) form.set("cover", new File([coverBytes], "cover.jpg", { type: "image/jpeg" }));
    if (kindFiles.glossary) form.set("glossary", new File([kindFiles.glossary], "glossary.json", { type: "application/json" }));
    return form;
  }

  // private: epub + cover land in the PRIVATE bucket, and the card cover reaches the books host
  const privateFiles = new Map();
  const cardCatalog = {
    format: 1,
    name: "Word lists",
    updated: "2026-10-01T00:00:00.000Z",
    lists: [
      {
        id: "great-book",
        title: "Great Book",
        words: 10,
        glossary: { url: "great-book/glossary.json", bytes: 5, sha256: "aaa" },
        updated: "2026-10-01T00:00:00+00:00",
        paragraphs: 1,
        sentences: 1,
        phrases: 1,
      },
    ],
  };
  const cardFiles = new Map([
    ["word-lists/catalog.json", new TextEncoder().encode(`${JSON.stringify(cardCatalog, null, 1)}\n`)],
  ]);
  const privateEnv = envOf(db, { PRIVATE: stubBucket(privateFiles), BOOKS: stubBucket(cardFiles) });
  const privateOk = await handleUpload(
    form("/api/admin/books?id=great-book&kind=private", adminCookie, formWith({ cover: true })),
    privateEnv,
    { now: NOW },
  );
  assert.equal(privateOk.status, 200);
  const privateJson = await privateOk.json();
  assert.equal(privateJson.kind, "private");
  assert.equal(new Uint8Array(privateFiles.get("great-book/book.epub"))[0], 80);
  assert.ok(privateFiles.has("great-book/cover.jpg"));
  const storedCardCatalog = JSON.parse(new TextDecoder().decode(cardFiles.get("word-lists/catalog.json")));
  // Card covers live under covers/ (no Worker on that path), named in the catalog by full address.
  assert.equal(storedCardCatalog.lists[0].cover.url, "https://books.inputread.site/covers/lists-great-book.jpg");
  assert.ok(cardFiles.has("covers/lists-great-book.jpg"));

  // A cover part that is a Blob, not a File, is still the picture Discover shows.
  const blobFiles = new Map();
  const blobCard = new Map([
    ["word-lists/catalog.json", new TextEncoder().encode(`${JSON.stringify(cardCatalog, null, 1)}\n`)],
  ]);
  const blobRequest = form(
    "/api/admin/books?id=great-book&kind=private",
    adminCookie,
    formWith({ cover: false }),
  );
  blobRequest.formData = async () => ({
    get(name) {
      if (name === "epub") return new File([epubBytes], "book.epub", { type: "application/epub+zip" });
      if (name === "cover") return new Blob([coverBytes], { type: "image/jpeg" });
      return null;
    },
  });
  const blobOk = await handleUpload(blobRequest, envOf(db, { PRIVATE: stubBucket(blobFiles), BOOKS: stubBucket(blobCard) }), {
    now: NOW,
  });
  assert.equal(blobOk.status, 200);
  assert.ok(blobFiles.has("great-book/cover.jpg"));
  assert.ok(blobCard.has("covers/lists-great-book.jpg"));

  // A chosen cover with no word-list row must not report success.
  const lonelyCatalog = { ...cardCatalog, lists: [] };
  const lonelyCard = new Map([
    ["word-lists/catalog.json", new TextEncoder().encode(`${JSON.stringify(lonelyCatalog, null, 1)}\n`)],
  ]);
  const lonely = await handleUpload(
    form("/api/admin/books?id=great-book&kind=private", adminCookie, formWith({ cover: true })),
    envOf(db, { PRIVATE: stubBucket(new Map()), BOOKS: stubBucket(lonelyCard) }),
    { now: NOW },
  );
  assert.equal(lonely.status, 409);
  assert.equal((await lonely.json()).error, "cover-not-saved");

  // A glossary for a different book must not replace this id's EPUB or cover.
  const mismatchFiles = new Map();
  const mismatchCard = new Map([
    ["word-lists/catalog.json", new TextEncoder().encode(`${JSON.stringify(cardCatalog, null, 1)}\n`)],
  ]);
  const mismatch = await handleUpload(
    form(
      "/api/admin/books?id=great-book&kind=private",
      adminCookie,
      formWith({ glossary: JSON.stringify({ title: "James", author: "Percival Everett", glossary: { jim: {} } }) }),
    ),
    envOf(db, { PRIVATE: stubBucket(mismatchFiles), BOOKS: stubBucket(mismatchCard) }),
    { now: NOW },
  );
  assert.equal(mismatch.status, 409);
  assert.equal((await mismatch.json()).error, "different-book");
  assert.equal(mismatchFiles.has("great-book/book.epub"), false);
  const mismatchCatalog = JSON.parse(new TextDecoder().decode(mismatchCard.get("word-lists/catalog.json")));
  assert.equal(mismatchCatalog.lists[0].title, "Great Book");
  assert.equal(mismatchCatalog.lists[0].cover, undefined);

  // public without a glossary file is refused
  const booksFiles = new Map();
  const livePublic = {
    format: 1,
    name: "Public books",
    updated: "2026-10-01T00:00:00.000Z",
    packs: [{ id: "alice", title: "Alice", glossary: { url: "alice/glossary.json", bytes: 1, sha256: "aaa" } }],
  };
  booksFiles.set("public-books/catalog.json", new TextEncoder().encode(`${JSON.stringify(livePublic, null, 1)}\n`));
  const publicEnv = envOf(db, { BOOKS: stubBucket(booksFiles) });
  const noGlossary = await handleUpload(
    form("/api/admin/books?id=alice&kind=public", adminCookie, formWith({ cover: false })),
    publicEnv,
    { now: NOW },
  );
  assert.equal(noGlossary.status, 400);
  assert.equal((await noGlossary.json()).error, "no-glossary");

  // public unknown id is refused
  const unknownBook = await handleUpload(
    form("/api/admin/books?id=nope&kind=public", adminCookie, formWith({ glossary: "{}" })),
    publicEnv,
    { now: NOW },
  );
  assert.equal(unknownBook.status, 404);

  // public happy path: epub + glossary + cover stored, row updated
  const okPublic = await handleUpload(
    form("/api/admin/books?id=alice&kind=public", adminCookie, formWith({ cover: true, glossary: '{"glossary":{"a":{}}}' })),
    publicEnv,
    { now: NOW },
  );
  assert.equal(okPublic.status, 200);
  const storedCatalog = JSON.parse(new TextDecoder().decode(booksFiles.get("public-books/catalog.json")));
  const alice = storedCatalog.packs.find((item) => item.id === "alice");
  assert.equal(alice.epub.url, "alice/book.epub");
  assert.equal(alice.epub.bytes, epubBytes.length);
  assert.equal(alice.glossary.rev.length, 12);
  assert.equal(alice.cover.url, "https://books.inputread.site/covers/public-alice.jpg");
  assert.ok(booksFiles.has("covers/public-alice.jpg"));
  assert.ok(booksFiles.has("public-books/alice/glossary.json"));

  const medium = new FormData();
  medium.set("epub", new File([epubBytes], "book.epub", { type: "application/epub+zip" }));
  medium.set(
    "glossary",
    new File([new Uint8Array(4_000_001)], "glossary.json", { type: "application/json" }),
  );
  const overOldCap = await handleUpload(
    form("/api/admin/books?id=alice&kind=public", adminCookie, medium),
    publicEnv,
    { now: NOW },
  );
  assert.equal(overOldCap.status, 200);
  assert.equal(booksFiles.get("public-books/alice/glossary.json").byteLength, 4_000_001);

  const huge = new FormData();
  huge.set("epub", new File([epubBytes], "book.epub", { type: "application/epub+zip" }));
  huge.set(
    "glossary",
    new File([new Uint8Array(GLOSSARY_MAX + 1)], "glossary.json", { type: "application/json" }),
  );
  const overNewCap = await handleUpload(
    form("/api/admin/books?id=alice&kind=public", adminCookie, huge),
    publicEnv,
    { now: NOW },
  );
  assert.equal(overNewCap.status, 413);
  assert.equal((await overNewCap.json()).error, "too-large");
  assert.equal(booksFiles.get("public-books/alice/glossary.json").byteLength, 4_000_001);

  // missing epub
  const noEpub = await handleUpload(form("/api/admin/books?id=alice&kind=public", adminCookie, new FormData()), publicEnv, {
    now: NOW,
  });
  assert.equal(noEpub.status, 400);
  assert.equal((await noEpub.json()).error, "no-epub");
});

test("word-list publish: isbn param sets and clears the edition number", async () => {
  const db = openDb();
  await call(handleRegister, envOf(db), { body: { email: "xcrunnnn@outlook.com", password: "correct horse" } });
  const login = await call(handleLogin, envOf(db), {
    body: { email: "xcrunnnn@outlook.com", password: "correct horse" },
  });
  const adminCookie = cookieHeader(login);
  const files = new Map();
  const liveCatalog = {
    format: 1,
    name: "Word lists",
    updated: "2026-10-01T00:00:00.000Z",
    lists: [
      {
        id: "charlie",
        title: "Charlie",
        isbn: "9780000000002",
        words: 10,
        glossary: { url: "charlie/glossary.json", bytes: 5, sha256: "aaa" },
        cover: { url: "charlie/cover.jpg", bytes: 12, sha256: "abc" },
        updated: "2026-10-01T00:00:00+00:00",
        paragraphs: 1,
        sentences: 1,
        phrases: 1,
      },
    ],
  };
  files.set("word-lists/catalog.json", new TextEncoder().encode(`${JSON.stringify(liveCatalog, null, 1)}\n`));
  const env = envOf(db, { BOOKS: stubBucket(files) });
  const glossary = JSON.stringify({ glossary: { a: {} }, count: 1 });

  const set = await handlePublish(
    raw("/api/admin/word-lists?id=charlie&isbn=9780062285768", adminCookie, glossary),
    env,
    { now: NOW },
  );
  assert.equal((await set.json()).row.isbn, "9780062285768");

  const cleared = await handlePublish(
    raw("/api/admin/word-lists?id=charlie&isbn=", adminCookie, glossary),
    env,
    { now: NOW },
  );
  const clearedRow = (await cleared.json()).row;
  assert.equal("isbn" in clearedRow, false);
  assert.equal(clearedRow.cover.url, "charlie/cover.jpg");
  assert.equal(clearedRow.cover.sha256, "abc");
});

function form(path, cookie, body) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  return new Request(`http://localhost${path}`, { method: "POST", headers, body });
}

test("sync push chunks batches over 100 items and saves all of them", async () => {
  const db = openDb();
  const env = envOf(db);
  const created = await call(handleRegister, env, { body: { email: "reader@example.com", password: "correct horse" } });
  const cookie = cookieHeader(created);
  const items = [];
  for (let n = 0; n < 130; n += 1) {
    const itemId = `chunk-book-${n}`;
    items.push({
      kind: "shelf",
      itemId,
      updatedAt: NOW + n,
      deleted: false,
      data: { id: itemId, title: `Book ${n}`, author: "A", cloth: "cloth", createdAt: NOW, updatedAt: NOW },
    });
  }
  const pushed = await call(handleSyncPush, env, { body: { items }, cookie });
  assert.equal(pushed.status, 200);
  const saved = (await pushed.json()).items;
  assert.equal(saved.length, 130);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM sync_items").get().n, 130);
});

function putJson(path, cookie, body) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  headers.set("content-type", "application/json");
  return new Request(`http://localhost${path}`, { method: "PUT", headers, body: JSON.stringify(body) });
}

/** Sign a reader in once per test database; word feedback needs a session. */
const readerSessions = new WeakMap();
async function readerCookie(env) {
  const cached = readerSessions.get(env.DB);
  if (cached) return cached;
  const made = await call(handleRegister, env, { body: { email: "feedback-reader@example.com", password: "correct horse" } });
  const cookie = cookieHeader(made);
  readerSessions.set(env.DB, cookie);
  return cookie;
}

function postJson(path, cookie, body, ip) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (ip) headers.set("cf-connecting-ip", ip);
  headers.set("content-type", "application/json");
  return new Request(`http://localhost${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

test("in-progress marks stay until that book's glossary is published", async () => {
  const db = openDb();
  await call(handleRegister, envOf(db), {
    body: { email: "xcrunnnn@outlook.com", password: "correct horse" },
  });
  const login = await call(handleLogin, envOf(db), {
    body: { email: "xcrunnnn@outlook.com", password: "correct horse" },
  });
  const adminCookie = cookieHeader(login);
  const files = new Map();
  const liveCatalog = {
    format: 1,
    name: "Word lists",
    updated: "2026-10-01T00:00:00.000Z",
    lists: [
      {
        id: "charlie",
        title: "Charlie",
        words: 10,
        glossary: { url: "charlie/glossary.json", bytes: 5, sha256: "aaa" },
        updated: "2026-10-01T00:00:00.000Z",
      },
      {
        id: "george",
        title: "George",
        words: 20,
        glossary: { url: "george/glossary.json", bytes: 6, sha256: "bbb" },
        updated: "2026-10-02T00:00:00.000Z",
      },
    ],
  };
  const publicCatalog = {
    format: 1,
    packs: [
      {
        id: "alice",
        title: "Alice",
        rev: "oldrevoldrev",
        words: 4,
        epub: { url: "alice/book.epub", bytes: 4, sha256: "abc" },
        glossary: { url: "alice/glossary.json", bytes: 2, sha256: "dd", rev: "dd" },
      },
    ],
  };
  files.set("word-lists/catalog.json", new TextEncoder().encode(`${JSON.stringify(liveCatalog, null, 1)}\n`));
  files.set("public-books/catalog.json", new TextEncoder().encode(`${JSON.stringify(publicCatalog, null, 1)}\n`));
  const env = envOf(db, { BOOKS: stubBucket(files) });
  const catalogBefore = files.get("word-lists/catalog.json");

  const empty = await handleGlossaryWorkGet(new Request("http://localhost/api/admin/glossary-work", { headers: { cookie: adminCookie } }), env, { now: NOW });
  assert.equal(empty.status, 200);
  assert.deepEqual((await empty.json()).items, []);

  const rejected = await handleGlossaryWorkPut(putJson("/api/admin/glossary-work", adminCookie, { kind: "shelf", id: "charlie", making: true }), env, { now: NOW });
  assert.equal(rejected.status, 400);
  assert.equal(files.has("word-lists/glossary-work.json"), false);

  const marked = await handleGlossaryWorkPut(putJson("/api/admin/glossary-work", adminCookie, { kind: "lists", id: "charlie", making: true }), env, { now: NOW });
  assert.equal(marked.status, 200);
  const first = await marked.json();
  const again = await handleGlossaryWorkPut(putJson("/api/admin/glossary-work", adminCookie, { kind: "lists", id: "charlie", making: true }), env, { now: NOW });
  assert.equal((await again.json()).items[0].since, first.items[0].since);
  await handleGlossaryWorkPut(putJson("/api/admin/glossary-work", adminCookie, { kind: "lists", id: "george", making: true }), env, { now: NOW });
  await handleGlossaryWorkPut(putJson("/api/admin/glossary-work", adminCookie, { kind: "public", id: "alice", making: true }), env, { now: NOW });
  assert.deepEqual(files.get("word-lists/catalog.json"), catalogBefore);

  const glossary = JSON.stringify({ glossary: { a: {}, b: {} }, count: 2 });
  const published = await handlePublish(raw("/api/admin/word-lists?id=charlie", adminCookie, glossary), env, { now: NOW });
  assert.equal(published.status, 200);
  const storedWork = JSON.parse(new TextDecoder().decode(files.get("word-lists/glossary-work.json")));
  assert.deepEqual(
    storedWork.items.map((item) => `${item.kind}:${item.id}`).sort(),
    ["lists:george", "public:alice"],
  );
  const storedCatalog = JSON.parse(new TextDecoder().decode(files.get("word-lists/catalog.json")));
  assert.equal(storedCatalog.lists.find((item) => item.id === "george").glossary.sha256, "bbb");

  const publicGlossary = JSON.stringify({ title: "Alice", glossary: { tea: {} }, count: 1 });
  const publicPublished = await handlePublish(
    raw("/api/admin/word-lists?id=alice&catalog=public", adminCookie, publicGlossary),
    env,
    { now: NOW },
  );
  assert.equal(publicPublished.status, 200);
  const afterPublic = JSON.parse(new TextDecoder().decode(files.get("word-lists/glossary-work.json")));
  assert.deepEqual(
    afterPublic.items.map((item) => `${item.kind}:${item.id}`),
    ["lists:george"],
  );
  const cleared = await handleGlossaryWorkPut(putJson("/api/admin/glossary-work", adminCookie, { kind: "lists", id: "george", making: false }), env, { now: NOW });
  assert.equal(cleared.status, 200);
  assert.deepEqual((await cleared.json()).items, []);
});

test("QQ groups stay out of the catalog until an admin saves them", async () => {
  const db = openDb();
  await call(handleRegister, envOf(db), {
    body: { email: "xcrunnnn@outlook.com", password: "correct horse" },
  });
  const login = await call(handleLogin, envOf(db), {
    body: { email: "xcrunnnn@outlook.com", password: "correct horse" },
  });
  const adminCookie = cookieHeader(login);
  const files = new Map();
  files.set("word-lists/catalog.json", new TextEncoder().encode('{"format":1,"lists":[]}\n'));
  const env = envOf(db, { BOOKS: stubBucket(files) });
  const catalogBefore = files.get("word-lists/catalog.json");

  const missing = await handleQqGroupsGet(new Request("http://localhost/api/qq-groups"), env);
  assert.equal(missing.status, 200);
  assert.deepEqual(await missing.json(), { format: 1, saved: false, groups: [] });

  const rejected = await handleQqGroupsPut(putJson("/api/admin/qq-groups", adminCookie, { groups: ["12"] }), env, { now: NOW });
  assert.equal(rejected.status, 400);
  assert.equal(files.has("word-lists/qq-groups.json"), false);

  const saved = await handleQqGroupsPut(
    putJson("/api/admin/qq-groups", adminCookie, { groups: ["656911882", "10001"] }),
    env,
    { now: NOW },
  );
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).groups, ["656911882", "10001"]);
  assert.deepEqual(files.get("word-lists/catalog.json"), catalogBefore);

  const listed = await handleQqGroupsGet(new Request("http://localhost/api/qq-groups"), env);
  assert.deepEqual((await listed.json()).groups, ["656911882", "10001"]);

  const cleared = await handleQqGroupsPut(putJson("/api/admin/qq-groups", adminCookie, { groups: [] }), env, { now: NOW });
  assert.equal(cleared.status, 200);
  const after = await handleQqGroupsGet(new Request("http://localhost/api/qq-groups"), env);
  const body = await after.json();
  assert.equal(body.saved, true);
  assert.deepEqual(body.groups, []);
});

test("reading word taps: batch ingestion, accumulation, rate limit, and admin query", async () => {
  const db = openDb();
  const env = envOf(db);

  // Ingestion: batch with 1 covered word and 1 missing word with location metadata.
  // The covered word is skipped: only words with no meaning in the book are kept.
  const resp1 = await handleWordTapsPost(
    postJson("/api/analytics/word-taps", null, {
      bookId: "charlie",
      bookTitle: "Charlie and the Chocolate Factory",
      taps: [
        {
          word: "eavesdrop",
          form: "eavesdropping",
          chapter: 2,
          occurrence: 1,
          paragraph: 5,
          context: "he was eavesdropping outside the small room",
          sentence: "Charlie realized he was eavesdropping outside the small room without making a sound.",
          count: 2,
          inGlossary: false,
        },
        {
          word: "chocolate",
          form: "chocolate",
          chapter: 0,
          occurrence: 1,
          paragraph: 1,
          context: "the great chocolate palace had melted away",
          sentence: "The great chocolate palace had melted away in the hot sun.",
          count: 1,
          inGlossary: true,
        },
      ],
    }),
    env,
    { now: NOW },
  );
  assert.equal(resp1.status, 200);
  assert.deepEqual(await resp1.json(), { ok: true, saved: 1 });

  // Ingestion: second batch accumulating counts for "eavesdrop" and adding "veruca"
  const resp2 = await handleWordTapsPost(
    postJson("/api/analytics/word-taps", null, {
      bookId: "charlie",
      bookTitle: "Charlie and the Chocolate Factory",
      taps: [
        {
          word: "eavesdrop",
          form: "eavesdropping",
          chapter: 2,
          occurrence: 1,
          paragraph: 5,
          context: "he was eavesdropping outside the small room",
          sentence: "Charlie realized he was eavesdropping outside the small room without making a sound.",
          count: 3,
          inGlossary: false,
          glossaryRev: "rev-charlie-v1",
        },
        {
          word: "veruca",
          form: "veruca",
          chapter: 3,
          occurrence: 1,
          paragraph: 2,
          context: "screamed veruca salt in a loud voice",
          sentence: "Then screamed Veruca Salt in a loud voice to her father.",
          count: 4,
          inGlossary: false,
          glossaryRev: "rev-charlie-v1",
        },
      ],
    }),
    env,
    { now: NOW + 1000 },
  );
  assert.equal(resp2.status, 200);
  assert.deepEqual(await resp2.json(), { ok: true, saved: 2 });

  // Gate admin query
  const unauthorized = await handleAdminWordTapsGet(
    raw("/api/admin/word-taps", "mw_session=fake"),
    env,
    { now: NOW },
  );
  assert.equal(unauthorized.status, 401);

  // Set up admin session
  await call(handleRegister, env, {
    body: { email: "xcrunnnn@outlook.com", password: "correct horse" },
  });
  const adminCookie = cookieHeader(
    await call(handleLogin, env, {
      body: { email: "xcrunnnn@outlook.com", password: "correct horse" },
    }),
  );

  // Admin query: default missing filter
  const missingOnly = await handleAdminWordTapsGet(
    raw("/api/admin/word-taps?filter=missing", adminCookie),
    env,
    { now: NOW },
  );
  assert.equal(missingOnly.status, 200);
  const missingBody = await missingOnly.json();
  assert.equal(missingBody.total, 2); // eavesdrop and veruca
  assert.equal(missingBody.summary.missingWords, 2);
  assert.equal(missingBody.summary.totalWords, 2); // "chocolate" has a meaning and was not stored
  assert.equal(missingBody.summary.totalTaps, 9); // 2+3 + 4
  assert.equal(missingBody.items[0].word, "eavesdrop");
  assert.equal(missingBody.items[0].tapCount, 5); // 2 + 3
  assert.equal(missingBody.items[0].inGlossary, false);
  assert.equal(missingBody.items[0].glossaryRev, "rev-charlie-v1");
  assert.equal(missingBody.items[0].status, "pending");
  assert.equal(missingBody.items[0].bookTitle, "Charlie and the Chocolate Factory");
  assert.deepEqual(missingBody.items[0].anchor, {
    chapter: 2,
    occurrence: 1,
    form: "eavesdropping",
    context: "he was eavesdropping outside the small room",
  });
  assert.equal(missingBody.items[0].sentence, "Charlie realized he was eavesdropping outside the small room without making a sound.");
  assert.equal(missingBody.items[1].word, "veruca");
  assert.equal(missingBody.items[1].tapCount, 4);

  // Mark eavesdrop as resolved by admin
  const resolveResp = await handleAdminWordTapsPost(
    postJson("/api/admin/word-taps", adminCookie, {
      action: "resolve",
      bookId: "charlie",
      word: "eavesdrop",
      chapter: 2,
      occurrence: 1,
      rev: "rev-charlie-v2",
    }),
    env,
    { now: NOW + 1500 },
  );
  assert.equal(resolveResp.status, 200);
  assert.deepEqual(await resolveResp.json(), { ok: true, resolved: true, resolvedRev: "rev-charlie-v2" });

  // Wrapped request format from legacy client also unwraps and resolves
  const resolveWrappedResp = await handleAdminWordTapsPost(
    postJson("/api/admin/word-taps", adminCookie, {
      method: "POST",
      body: JSON.stringify({
        action: "resolve",
        bookId: "charlie",
        word: "veruca",
        chapter: 2,
        occurrence: 1,
        rev: "rev-charlie-v2",
      }),
    }),
    env,
    { now: NOW + 1550 },
  );
  assert.equal(resolveWrappedResp.status, 200);

  // Now missing query excludes eavesdrop
  const afterResolveMissing = await handleAdminWordTapsGet(
    raw("/api/admin/word-taps?filter=missing", adminCookie),
    env,
    { now: NOW + 1600 },
  );
  const afterResolveBody = await afterResolveMissing.json();
  assert.equal(afterResolveBody.total, 1);
  assert.equal(afterResolveBody.items[0].word, "veruca");

  // Resolved filter includes eavesdrop
  const resolvedFilter = await handleAdminWordTapsGet(
    raw("/api/admin/word-taps?filter=resolved", adminCookie),
    env,
    { now: NOW + 1600 },
  );
  const resolvedBody = await resolvedFilter.json();
  assert.equal(resolvedBody.total, 1);
  assert.equal(resolvedBody.items[0].word, "eavesdrop");
  assert.equal(resolvedBody.items[0].status, "resolved");
  assert.equal(resolvedBody.items[0].resolvedRev, "rev-charlie-v2");

  // Admin query: all words
  const allWords = await handleAdminWordTapsGet(
    raw("/api/admin/word-taps?filter=all", adminCookie),
    env,
    { now: NOW },
  );
  const allBody = await allWords.json();
  assert.equal(allBody.total, 2);
  assert.ok(!allBody.items.some((item) => item.word === "chocolate"), "a word with a meaning is never stored");
});

test("word feedback: submit too_hard / wrong_meaning, deduplicate, and admin query", async () => {
  const db = openDb();
  const env = envOf(db);

  // Submit feedback from IP A: too_hard for "eavesdrop"
  const resp1 = await handleWordFeedbackPost(
    postJson(
      "/api/feedback/word",
      await readerCookie(env),
      {
        bookId: "charlie",
        bookTitle: "Charlie and the Chocolate Factory",
        word: "eavesdrop",
        form: "eavesdropping",
        chapter: 2,
        occurrence: 1,
        paragraph: 5,
        context: "he was eavesdropping outside the small room",
        sentence: "Charlie realized he was eavesdropping outside the small room without making a sound.",
        senseIndex: 0,
        senseMeaning: "to listen secretly to what other people are saying",
        reason: "too_hard",
      },
      "1.2.3.4",
    ),
    env,
    { now: NOW },
  );
  assert.equal(resp1.status, 200);
  assert.deepEqual(await resp1.json(), { ok: true, saved: true });

  // Duplicate submit from same IP within 24h: accepted quietly without duplicate insert
  const dup = await handleWordFeedbackPost(
    postJson(
      "/api/feedback/word",
      await readerCookie(env),
      {
        bookId: "charlie",
        bookTitle: "Charlie and the Chocolate Factory",
        word: "eavesdrop",
        form: "eavesdropping",
        chapter: 2,
        occurrence: 1,
        paragraph: 5,
        context: "he was eavesdropping outside the small room",
        sentence: "Charlie realized he was eavesdropping outside the small room without making a sound.",
        senseIndex: 0,
        senseMeaning: "to listen secretly to what other people are saying",
        reason: "too_hard",
      },
      "1.2.3.4",
    ),
    env,
    { now: NOW + 1000 },
  );
  assert.equal(dup.status, 200);
  assert.deepEqual(await dup.json(), { ok: true, duplicate: true });

  // Submit from IP B: too_hard for "eavesdrop" (increases report count to 2)
  const resp2 = await handleWordFeedbackPost(
    postJson(
      "/api/feedback/word",
      await readerCookie(env),
      {
        bookId: "charlie",
        bookTitle: "Charlie and the Chocolate Factory",
        word: "eavesdrop",
        form: "eavesdropping",
        chapter: 2,
        occurrence: 1,
        paragraph: 5,
        context: "he was eavesdropping outside the small room",
        sentence: "Charlie realized he was eavesdropping outside the small room without making a sound.",
        senseIndex: 0,
        senseMeaning: "to listen secretly to what other people are saying",
        reason: "too_hard",
      },
      "5.6.7.8",
    ),
    env,
    { now: NOW + 2000 },
  );
  assert.equal(resp2.status, 200);

  // Submit from IP C: wrong_meaning for "cricket" in wonder
  const resp3 = await handleWordFeedbackPost(
    postJson(
      "/api/feedback/word",
      await readerCookie(env),
      {
        bookId: "wonder",
        bookTitle: "Wonder",
        word: "cricket",
        form: "cricket",
        chapter: 1,
        occurrence: 1,
        paragraph: 2,
        context: "the chirping of a cricket in the dark",
        sentence: "He heard the chirping of a cricket in the dark corner.",
        senseIndex: 1,
        senseMeaning: "an open-air game played with a ball, bats, and wickets",
        reason: "wrong_meaning",
        glossaryRev: "wonder-rev-v1",
      },
      "9.10.11.12",
    ),
    env,
    { now: NOW + 3000 },
  );
  assert.equal(resp3.status, 200);

  // Reject invalid payload
  const badReason = await handleWordFeedbackPost(
    postJson("/api/feedback/word", await readerCookie(env), {
      bookId: "wonder",
      word: "cricket",
      reason: "other_bad",
    }),
    env,
    { now: NOW + 4000 },
  );
  assert.equal(badReason.status, 400);

  // Non-admin blocked from admin query
  const unauthorized = await handleAdminWordFeedbackGet(
    raw("/api/admin/word-feedback", "mw_session=fake"),
    env,
    { now: NOW },
  );
  assert.equal(unauthorized.status, 401);

  // Set up admin session
  await call(handleRegister, env, {
    body: { email: "xcrunnnn@outlook.com", password: "correct horse" },
  });
  const adminCookie = cookieHeader(
    await call(handleLogin, env, {
      body: { email: "xcrunnnn@outlook.com", password: "correct horse" },
    }),
  );

  // Admin query: all feedback
  const adminList = await handleAdminWordFeedbackGet(
    raw("/api/admin/word-feedback", adminCookie),
    env,
    { now: NOW },
  );
  assert.equal(adminList.status, 200);
  const body = await adminList.json();
  assert.equal(body.total, 2); // 2 distinct (book, word, chapter, occurrence, reason) groups
  assert.equal(body.summary.totalReports, 3);
  assert.equal(body.summary.tooHardReports, 2);
  assert.equal(body.summary.wrongMeaningReports, 1);
  assert.equal(body.summary.distinctWords, 2);

  // Most reported group is eavesdrop too_hard with count 2
  assert.equal(body.items[0].word, "eavesdrop");
  assert.equal(body.items[0].bookTitle, "Charlie and the Chocolate Factory");
  assert.equal(body.items[0].reason, "too_hard");
  assert.equal(body.items[0].count, 2);
  assert.equal(body.items[0].senseIndex, 0);
  assert.equal(body.items[0].senseMeaning, "to listen secretly to what other people are saying");
  assert.deepEqual(body.items[0].anchor, {
    chapter: 2,
    occurrence: 1,
    form: "eavesdropping",
    context: "he was eavesdropping outside the small room",
  });
  assert.equal(body.items[0].sentence, "Charlie realized he was eavesdropping outside the small room without making a sound.");

  // Filter by reason=wrong_meaning
  const filtered = await handleAdminWordFeedbackGet(
    raw("/api/admin/word-feedback?reason=wrong_meaning", adminCookie),
    env,
    { now: NOW },
  );
  const filteredBody = await filtered.json();
  assert.equal(filteredBody.total, 1);
  assert.equal(filteredBody.items[0].word, "cricket");
  assert.equal(filteredBody.items[0].reason, "wrong_meaning");
  assert.equal(filteredBody.items[0].status, "pending");

  // Admin marks cricket wrong_meaning as resolved
  // Admin marks cricket wrong_meaning as resolved without passing rev explicitly:
  // It automatically looks up the current catalog revision from BOOKS bucket ("wonder-rev-v2")
  const mockCatalog = {
    lists: [
      {
        id: "wonder",
        glossary: { url: "wonder/glossary.json", bytes: 1000, sha256: "wonder-rev-v200000000000000000000000000000000000000000000000000" },
      },
    ],
  };
  const booksMap = new Map();
  booksMap.set("word-lists/catalog.json", new TextEncoder().encode(JSON.stringify(mockCatalog)));
  env.BOOKS = {
    async get(key) {
      const data = booksMap.get(key);
      if (!data) return null;
      return { body: new ReadableStream({ start(c) { c.enqueue(data); c.close(); } }) };
    },
  };

  const resolveFeedback = await handleAdminWordFeedbackPost(
    postJson("/api/admin/word-feedback", adminCookie, {
      action: "resolve",
      bookId: "wonder",
      word: "cricket",
      chapter: 1,
      occurrence: 1,
      reason: "wrong_meaning",
    }),
    env,
    { now: NOW + 5000 },
  );
  assert.equal(resolveFeedback.status, 200);
  const resolveJson = await resolveFeedback.json();
  assert.equal(resolveJson.ok, true);
  assert.equal(resolveJson.resolved, true);
  assert.equal(resolveJson.resolvedRev, "wonder-rev-v");

  // Query resolved status
  const resolvedList = await handleAdminWordFeedbackGet(
    raw("/api/admin/word-feedback?status=resolved", adminCookie),
    env,
    { now: NOW + 5100 },
  );
  const resolvedListBody = await resolvedList.json();
  assert.equal(resolvedListBody.total, 1);
  assert.equal(resolvedListBody.items[0].word, "cricket");
  assert.equal(resolvedListBody.items[0].status, "resolved");
  assert.equal(resolvedListBody.items[0].resolvedRev, "wonder-rev-v");

  // A reader on an outdated version (wonder-rev-v1) reports cricket wrong_meaning:
  // Since wonder-rev-v1 != resolvedRev (wonder-rev-v), it should NOT be marked as reopened (stays resolved)
  const outdatedClientResp = await handleWordFeedbackPost(
    postJson(
      "/api/feedback/word",
      await readerCookie(env),
      {
        bookId: "wonder",
        bookTitle: "Wonder",
        word: "cricket",
        form: "cricket",
        chapter: 1,
        occurrence: 1,
        paragraph: 2,
        context: "the chirping of a cricket in the dark",
        sentence: "He heard the chirping of a cricket in the dark corner.",
        senseIndex: 1,
        senseMeaning: "wrong meaning from old v1 version",
        reason: "wrong_meaning",
        glossaryRev: "wonder-rev-v1",
      },
      "17.18.19.20",
    ),
    env,
    { now: NOW + 5500 },
  );
  assert.equal(outdatedClientResp.status, 200);

  // Still 0 reopened items
  const noReopenedYet = await handleAdminWordFeedbackGet(
    raw("/api/admin/word-feedback?status=reopened", adminCookie),
    env,
    { now: NOW + 5600 },
  );
  assert.equal((await noReopenedYet.json()).total, 0);

  // A reader reports cricket wrong_meaning again on the new resolved version (wonder-rev-v) -> automatically marked as 'reopened'
  const reopenResp = await handleWordFeedbackPost(
    postJson(
      "/api/feedback/word",
      await readerCookie(env),
      {
        bookId: "wonder",
        bookTitle: "Wonder",
        word: "cricket",
        form: "cricket",
        chapter: 1,
        occurrence: 1,
        paragraph: 2,
        context: "the chirping of a cricket in the dark",
        sentence: "He heard the chirping of a cricket in the dark corner.",
        senseIndex: 1,
        senseMeaning: "still a wrong meaning in new version",
        reason: "wrong_meaning",
        glossaryRev: "wonder-rev-v",
      },
      "13.14.15.16",
    ),
    env,
    { now: NOW + 6000 },
  );
  assert.equal(reopenResp.status, 200);

  // Query reopened status
  const reopenedList = await handleAdminWordFeedbackGet(
    raw("/api/admin/word-feedback?status=reopened", adminCookie),
    env,
    { now: NOW + 6100 },
  );
  const reopenedListBody = await reopenedList.json();
  assert.equal(reopenedListBody.total, 1);
  assert.equal(reopenedListBody.items[0].word, "cricket");
  assert.equal(reopenedListBody.items[0].status, "reopened");
  assert.equal(reopenedListBody.items[0].glossaryRev, "wonder-rev-v");

  // In the 'all' view, the group status must be 'reopened' (not masked by earlier 'resolved' reports)
  const allFeedbackList = await handleAdminWordFeedbackGet(
    raw("/api/admin/word-feedback?status=all", adminCookie),
    env,
    { now: NOW + 6200 },
  );
  const allFeedbackBody = await allFeedbackList.json();
  const cricketRow = allFeedbackBody.items.find((it) => it.word === "cricket" && it.reason === "wrong_meaning");
  assert.ok(cricketRow);
  assert.equal(cricketRow.status, "reopened");

  // Admin resolves again. Even if an old client sends a stale rev in payload,
  // the backend prioritizes the catalog revision.
  const resolveWithStaleClientRev = await handleAdminWordFeedbackPost(
    postJson("/api/admin/word-feedback", adminCookie, {
      action: "resolve",
      bookId: "wonder",
      word: "cricket",
      chapter: 1,
      occurrence: 1,
      reason: "wrong_meaning",
      rev: "stale-client-rev",
    }),
    env,
    { now: NOW + 6300 },
  );
  assert.equal(resolveWithStaleClientRev.status, 200);
  assert.equal((await resolveWithStaleClientRev.json()).resolvedRev, "wonder-rev-v");

  // Update catalog to v3 (within 60s). BypassCache guarantees resolve immediately picks up v3
  const v3Catalog = {
    lists: [
      {
        id: "wonder",
        glossary: { url: "wonder/glossary.json", bytes: 1000, sha256: "wonder-v3-000000000000000000000000000000000000000000000000000" },
      },
    ],
  };
  booksMap.set("word-lists/catalog.json", new TextEncoder().encode(JSON.stringify(v3Catalog)));

  const resolveV3 = await handleAdminWordFeedbackPost(
    postJson("/api/admin/word-feedback", adminCookie, {
      action: "resolve",
      bookId: "wonder",
      word: "cricket",
      chapter: 1,
      occurrence: 1,
      reason: "wrong_meaning",
    }),
    env,
    { now: NOW + 6400 },
  );
  assert.equal(resolveV3.status, 200);
  assert.equal((await resolveV3.json()).resolvedRev, "wonder-v3-00");

  // Wrapped request format from legacy client also unwraps and resolves
  const resolveWrappedFeedback = await handleAdminWordFeedbackPost(
    postJson("/api/admin/word-feedback", adminCookie, {
      method: "POST",
      body: JSON.stringify({
        action: "resolve",
        bookId: "wonder",
        word: "cricket",
        chapter: 1,
        occurrence: 1,
        reason: "wrong_meaning",
      }),
    }),
    env,
    { now: NOW + 6450 },
  );
  assert.equal(resolveWrappedFeedback.status, 200);

  // Outdated client on v1 reports -> stays resolved (suppressed)
  const legacyReport = await handleWordFeedbackPost(
    postJson(
      "/api/feedback/word",
      await readerCookie(env),
      {
        bookId: "wonder",
        bookTitle: "Wonder",
        word: "cricket",
        form: "cricket",
        chapter: 1,
        occurrence: 1,
        paragraph: 2,
        context: "the chirping of a cricket in the dark",
        sentence: "He heard the chirping of a cricket in the dark corner.",
        senseIndex: 1,
        senseMeaning: "wrong meaning from old v1",
        reason: "wrong_meaning",
        glossaryRev: "wonder-rev-v1",
      },
      "21.22.23.24",
    ),
    env,
    { now: NOW + 6500 },
  );
  assert.equal(legacyReport.status, 200);

  const checkNoReopened = await handleAdminWordFeedbackGet(
    raw("/api/admin/word-feedback?status=reopened", adminCookie),
    env,
    { now: NOW + 6600 },
  );
  assert.equal((await checkNoReopened.json()).total, 0);

  // Client on current v3 reports -> genuine regression, correctly marked reopened
  const v3Regression = await handleWordFeedbackPost(
    postJson(
      "/api/feedback/word",
      await readerCookie(env),
      {
        bookId: "wonder",
        bookTitle: "Wonder",
        word: "cricket",
        form: "cricket",
        chapter: 1,
        occurrence: 1,
        paragraph: 2,
        context: "the chirping of a cricket in the dark",
        sentence: "He heard the chirping of a cricket in the dark corner.",
        senseIndex: 1,
        senseMeaning: "still broken in v3",
        reason: "wrong_meaning",
        glossaryRev: "wonder-v3-00",
      },
      "25.26.27.28",
    ),
    env,
    { now: NOW + 6700 },
  );
  assert.equal(v3Regression.status, 200);

  const checkReopenedV3 = await handleAdminWordFeedbackGet(
    raw("/api/admin/word-feedback?status=reopened", adminCookie),
    env,
    { now: NOW + 6800 },
  );
  assert.equal((await checkReopenedV3.json()).total, 1);

  // Same IP on the same revision within 24h is deduplicated
  const dupResp = await handleWordFeedbackPost(
    postJson(
      "/api/feedback/word",
      await readerCookie(env),
      {
        bookId: "wonder",
        word: "cricket",
        chapter: 1,
        occurrence: 1,
        reason: "wrong_meaning",
        glossaryRev: "wonder-v3-00",
      },
      "25.26.27.28",
    ),
    env,
    { now: NOW + 6900 },
  );
  assert.equal(dupResp.status, 200);
  assert.equal((await dupResp.json()).duplicate, true);

  // But if the same IP updates to a new version (v4) within 24h, it is NOT blocked
  const upgradedResp = await handleWordFeedbackPost(
    postJson(
      "/api/feedback/word",
      await readerCookie(env),
      {
        bookId: "wonder",
        word: "cricket",
        chapter: 1,
        occurrence: 1,
        reason: "wrong_meaning",
        glossaryRev: "wonder-v4-00",
      },
      "25.26.27.28",
    ),
    env,
    { now: NOW + 7000 },
  );
  assert.equal(upgradedResp.status, 200);
  assert.equal((await upgradedResp.json()).saved, true);
});

test("word feedback: a reader's own meaning is cleaned, capped and kept for review", async () => {
  const db = openDb();
  const env = envOf(db);
  const base = { bookId: "wonder", word: "dive", form: "dive", chapter: 2, occurrence: 1, reason: "missing_meaning" };
  const long = `To jump in <b>head first</b>\u0007 ${"x".repeat(400)}`;
  const first = await handleWordFeedbackPost(postJson("/api/feedback/word", await readerCookie(env), { ...base, suggestion: long }, "41.42.43.44"), env, { now: NOW });
  assert.equal(first.status, 200);
  const stored = db.raw.prepare("SELECT suggestion FROM word_feedback").get().suggestion;
  assert.equal([...stored].length, 200, "at most 200 characters");
  assert.ok(stored.startsWith("To jump in b head first /b x"), "markup brackets and control characters become single spaces");
  assert.doesNotMatch(stored, /[<>\u0000-\u001f]/);

  // The same place again from the same address: without a meaning it is a duplicate, with one it is kept.
  const plain = await handleWordFeedbackPost(postJson("/api/feedback/word", await readerCookie(env), base, "41.42.43.44"), env, { now: NOW + 1000 });
  assert.equal((await plain.json()).duplicate, true);
  const withMeaning = await handleWordFeedbackPost(
    postJson("/api/feedback/word", await readerCookie(env), { ...base, suggestion: "  To jump into water,\n head first.  " }, "41.42.43.44"),
    env,
    { now: NOW + 2000 },
  );
  assert.equal((await withMeaning.json()).saved, true);
  const rows = db.raw.prepare("SELECT suggestion FROM word_feedback ORDER BY created_at").all();
  assert.equal(rows.length, 2);
  assert.equal(rows[1].suggestion, "To jump into water, head first.", "spaces and line breaks are folded");

  await call(handleRegister, env, { body: { email: "xcrunnnn@outlook.com", password: "correct horse" } });
  const adminCookie = cookieHeader(
    await call(handleLogin, env, { body: { email: "xcrunnnn@outlook.com", password: "correct horse" } }),
  );
  const listed = await (await handleAdminWordFeedbackGet(raw("/api/admin/word-feedback", adminCookie), env, { now: NOW })).json();
  assert.equal(listed.items[0].suggestions.length, 2, "the admin list shows every reader meaning for the place");
});

test("word feedback: a word with no meaning in the book can be reported as missing", async () => {
  const db = openDb();
  const env = envOf(db);
  const sent = await handleWordFeedbackPost(
    postJson(
      "/api/feedback/word",
      await readerCookie(env),
      { bookId: "wonder", word: "slept", form: "slept", chapter: 3, occurrence: 1, reason: "missing_meaning" },
      "31.32.33.34",
    ),
    env,
    { now: NOW },
  );
  assert.equal(sent.status, 200);
  assert.deepEqual(await sent.json(), { ok: true, saved: true });

  await call(handleRegister, env, { body: { email: "xcrunnnn@outlook.com", password: "correct horse" } });
  const adminCookie = cookieHeader(
    await call(handleLogin, env, { body: { email: "xcrunnnn@outlook.com", password: "correct horse" } }),
  );
  const listed = await (
    await handleAdminWordFeedbackGet(raw("/api/admin/word-feedback?reason=missing_meaning", adminCookie), env, {
      now: NOW,
    })
  ).json();
  assert.equal(listed.total, 1);
  assert.equal(listed.items[0].word, "slept");
  assert.equal(listed.items[0].reason, "missing_meaning");
  // Not counted as either of the two meaning complaints.
  assert.equal(listed.summary.tooHardReports, 0);
  assert.equal(listed.summary.wrongMeaningReports, 0);
});

test("a hash from the 100k era still signs in, and is rewritten at the current count", async () => {
  const db = openDb();
  const env = envOf(db);
  await call(handleRegister, env, { body: { email: "reader@example.com", password: "correct horse" } });
  // Put the account back to what it looked like before the CPU cut.
  const legacy = await hashPassword("correct horse", undefined, 100_000);
  db.raw
    .prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_iters = 100000 WHERE email = ?")
    .run(legacy.hash, legacy.salt, "reader@example.com");

  const ok = await call(handleLogin, env, { body: { email: "reader@example.com", password: "correct horse" } });
  assert.equal(ok.status, 200, "the old hash must still be accepted");
  const after = db.raw.prepare("SELECT password_iters FROM users WHERE email = ?").get("reader@example.com");
  assert.equal(after.password_iters, PBKDF2_ITERATIONS, "the next sign-in rewrites it at the current count");
});

test("one request may only carry a batch the CPU budget can pay for", async () => {
  const db = openDb();
  const env = envOf(db);
  const tap = (word) => ({ word, chapter: 1, occurrence: 1, paragraph: 0, context: "", sentence: "" });

  const tooManyTaps = await handleWordTapsPost(
    postJson("/api/analytics/word-taps", null, {
      bookId: "charlie",
      taps: Array.from({ length: 21 }, (_, i) => tap(`word${"abcdefghij"[i % 10]}${i}`)),
    }),
    env,
    { now: NOW },
  );
  assert.equal(tooManyTaps.status, 400);
  assert.equal((await tooManyTaps.json()).error, "bad-taps");

  const cookie = cookieHeader(await call(handleRegister, env, { body: { email: "reader@example.com", password: "correct horse" } }));
  const item = { kind: "settings", itemId: "main", updatedAt: NOW, deleted: false, data: {} };
  const tooManyItems = await call(handleSyncPush, env, {
    cookie,
    body: { items: Array.from({ length: 201 }, () => item) },
  });
  assert.equal(tooManyItems.status, 413);
  assert.equal((await tooManyItems.json()).error, "too-large");
});

test("the day's telemetry budget is a hard fuse, and a spent one writes nothing", async () => {
  const db = openDb();
  const env = envOf(db);
  const day = 24 * 60 * 60 * 1000;
  const dayStart = Math.floor(NOW / day) * day;
  db.raw
    .prepare("INSERT INTO rate_limits (bucket, window_start, hits) VALUES (?, ?, ?)")
    .run(`budget:taps:${dayStart}`, dayStart, DAILY_WRITE_BUDGET.taps);

  const response = await handleWordTapsPost(
    postJson("/api/analytics/word-taps", null, {
      bookId: "charlie",
      taps: [{ word: "eavesdrop", chapter: 1, occurrence: 1, paragraph: 0, context: "", sentence: "" }],
    }),
    env,
    { now: NOW },
  );
  assert.equal(response.status, 429);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM book_word_taps").get().n, 0, "nothing is written");
});

test("a signed-in account cannot loop the word-list endpoint", async () => {
  const db = openDb();
  const env = envOf(db);
  const created = await call(handleRegister, env, { body: { email: "reader@example.com", password: "correct horse" } });
  const cookie = cookieHeader(created);
  const userId = db.raw.prepare("SELECT id FROM users WHERE email = ?").get("reader@example.com").id;
  const windowStart = Math.floor(NOW / (15 * 60 * 1000)) * (15 * 60 * 1000);
  db.raw
    .prepare("INSERT INTO rate_limits (bucket, window_start, hits) VALUES (?, ?, ?)")
    .run(`glossary:user:${userId}`, windowStart, 120);

  const response = await handleGlossary(raw("/api/glossary/book-1", cookie), env, "book-1", { now: NOW });
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error, "rate");
});

test("a story summary is saved only by the admin, only for a book in the catalog, in the right language", async () => {
  const db = openDb();
  const register = (email) => call(handleRegister, envOf(db), { body: { email, password: "correct horse" } });
  await register("xcrunnnn@outlook.com");
  const reader = await register("reader-blurb@example.com");
  const adminCookie = cookieHeader(await call(handleLogin, envOf(db), { body: { email: "xcrunnnn@outlook.com", password: "correct horse" } }));
  const readerCookie = cookieHeader(reader);
  const files = new Map();
  const catalog = new TextEncoder().encode(`${JSON.stringify({ format: 1, lists: [{ id: "wonder", title: "Wonder" }] })}\n`);
  files.set("word-lists/catalog.json", catalog);
  files.set("public-books/catalog.json", new TextEncoder().encode(JSON.stringify({ format: 1, packs: [{ id: "alice", title: "Alice" }] })));
  const env = envOf(db, { BOOKS: stubBucket(files) });
  const put = (cookie, query, body) => handleBlurbPut(putJson(`/api/admin/blurb?${query}`, cookie, body), env, { now: NOW });
  const stored = (key) => JSON.parse(new TextDecoder().decode(files.get(key)));
  const zh = "\u4e00\u4e2a\u7537\u5b69\u7b2c\u4e00\u6b21\u53bb\u5b66\u6821\u3002";

  assert.equal((await put(readerCookie, "kind=lists&id=wonder", { zh })).status, 403, "only the admin");
  assert.equal((await put("", "kind=lists&id=wonder", { zh })).status, 401);
  assert.equal((await put(adminCookie, "kind=lists&id=wondr", { zh })).status, 404, "a mistyped id is refused");
  assert.equal((await put(adminCookie, "kind=public&id=wonder", { zh })).status, 404, "a list book is not a public book");
  assert.equal((await put(adminCookie, "kind=lists&id=../x", { zh })).status, 400);

  const wrong = await put(adminCookie, "kind=lists&id=wonder", { zh: "A boy goes to school.", en: zh });
  assert.equal(wrong.status, 400);
  assert.deepEqual((await wrong.json()).problems, ["zh:no-chinese", "en:has-chinese"]);
  assert.equal((await put(adminCookie, "kind=lists&id=wonder", { en: "A <b>boy</b>." })).status, 400, "no markup");
  assert.equal(files.has("word-lists/wonder/blurb.json"), false, "nothing is written when a check fails");

  const saved = await put(adminCookie, "kind=lists&id=wonder", { zh, en: "  A boy goes to school\n for the first time.  " });
  assert.equal(saved.status, 200);
  assert.deepEqual(stored("word-lists/wonder/blurb.json"), { format: 1, zh, en: "A boy goes to school\nfor the first time." });
  assert.deepEqual(files.get("word-lists/catalog.json"), catalog, "the catalog is not touched");

  const read = await handleBlurbGet(
    new Request("http://localhost/api/admin/blurb?kind=lists&id=wonder", { headers: { cookie: adminCookie } }),
    env,
    { now: NOW },
  );
  assert.deepEqual(await read.json(), { kind: "lists", id: "wonder", zh, en: "A boy goes to school\nfor the first time." });

  // The body is the whole summary: saving one language clears the other.
  await put(adminCookie, "kind=lists&id=wonder", { zh });
  assert.deepEqual(stored("word-lists/wonder/blurb.json"), { format: 1, zh });

  assert.equal((await put(adminCookie, "kind=public&id=alice", { en: "A girl falls down a rabbit hole." })).status, 200);
  assert.ok(files.has("public-books/alice/blurb.json"), "a public book keeps its summary in public-books/");
});
