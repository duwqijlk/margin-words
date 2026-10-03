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
  handleExport,
  handleLogin,
  handleLogout,
  handleMe,
  handlePasswordResetConfirm,
  handlePasswordResetRequest,
  handleRegister,
  handleSyncPull,
  handleSyncPush,
} from "../functions/lib/handlers.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = 1_700_000_000_000;

function openDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(readFileSync(join(ROOT, "migrations", "0001_init.sql"), "utf8"));
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

test("password hashing uses PBKDF2-SHA256 with at least 100k iterations and a per-user salt", async () => {
  assert.ok(PBKDF2_ITERATIONS >= 100_000);
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
  assert.equal((await me.json()).user.email, "reader@example.com");

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
  assert.deepEqual(await after.json(), { user: null });

  const anon = await call(handleMe, env, { method: "GET" });
  assert.equal(anon.status, 200);
  assert.deepEqual(await anon.json(), { user: null });
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
    { now: NOW, fetch: async () => new Response(JSON.stringify({ success: true }), { status: 200 }) },
  );
  assert.equal(ok.status, 201);
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
  assert.deepEqual(await oldSession.json(), { user: null });
  const loggedIn = await call(handleLogin, env, {
    body: { email: "reader@example.com", password: "a newer horse" },
  });
  assert.equal(loggedIn.status, 200);
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
