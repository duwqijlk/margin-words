import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  handleNickname,
  handleRegister,
  handleRegisterConfirm,
} from "../functions/lib/handlers.ts";
import {
  handleAdminSponsorshipsGet,
  handleAdminSponsorshipsPost,
  handleCreateSponsorship,
  handleMySponsorship,
  handlePublicSponsorships,
} from "../functions/lib/sponsorship.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = Date.parse("2026-10-08T05:00:00Z");

/** Register and finish with the emailed code: the account the tests used to get from one call. */
async function signUpFully(handlerRegister, env, input, now = NOW) {
  let code = "";
  const opts = {
    now,
    sendCode: async (message) => {
      code = message.code;
      return { sent: true };
    },
  };
  const body = input.body ?? input;
  const started = await handlerRegister(
    new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.ip ? { "cf-connecting-ip": input.ip } : {}),
      },
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
      headers: {
        "content-type": "application/json",
        ...(input.ip ? { "cf-connecting-ip": input.ip } : {}),
      },
      body: JSON.stringify({ email: body.email, code, ticket }),
    }),
    env,
    { now },
  );
}
const EARLIER = Date.parse("2026-09-15T04:00:00Z");

function openDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  // Every migration, in filename order: `requireUser` reads users.role (0004) and the handlers
  // touch tables added later. A hand-kept list here went stale and turned a 400 into a 500.
  const dir = join(ROOT, "migrations");
  for (const name of readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(join(dir, name), "utf8"));
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
  };
}

function cookieFrom(response) {
  const match = /mw_session=([^;]*)/.exec(response.headers.get("set-cookie") ?? "");
  return match?.[1] ? `mw_session=${match[1]}` : "";
}

async function call(handler, env, { method = "POST", body, cookie, now = NOW } = {}) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  const request = new Request("https://inputread.site/api/sponsorships", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handler(request, env, { now });
}

for (const method of ["wechat", "crypto"]) {
  test(`${method} requests are accepted; unsupported methods and duplicate requests are refused`, async () => {
    const env = { DB: openDb() };
    const reader = await signUpFully(handleRegister, env, {
      body: { email: "giver@example.com", password: "correct horse" },
    });
    const cookie = cookieFrom(reader);
    await call(handleNickname, env, { cookie, body: { nickname: "Mei" } });
    for (const rejected of ["alipay", "unknown", "evm", null]) {
      const response = await call(handleCreateSponsorship, env, {
        cookie,
        body: { method: rejected },
      });
      assert.equal(response.status, 400);
    }
    const created = await call(handleCreateSponsorship, env, { cookie, body: { method } });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).method, method);
    const mine = await (await call(handleMySponsorship, env, { method: "GET", cookie })).json();
    assert.equal(mine.open.method, method);
    const duplicate = await call(handleCreateSponsorship, env, {
      cookie,
      now: NOW + 16 * 60 * 1000,
      body: { method: method === "wechat" ? "crypto" : "wechat" },
    });
    assert.equal(duplicate.status, 409);
  });
}

for (const method of ["wechat", "crypto"]) {
  test(`${method} gifts stay hidden until the admin types dollars and ticks them`, async () => {
    const db = openDb();
    const env = { DB: db };
    const reader = await signUpFully(handleRegister, env, {
      body: { email: "reader@example.com", password: "correct horse" },
    });
    const readerCookie = cookieFrom(reader);
    const readerPublicId = (await reader.clone().json()).user.publicId;
    const admin = await signUpFully(handleRegister, env, {
      body: { email: "xcrunnnn@outlook.com", password: "correct horse" },
    });
    const adminCookie = cookieFrom(admin);

    const denied = await call(handleCreateSponsorship, env, { body: { method } });
    assert.equal(denied.status, 401);

    const unnamed = await call(handleCreateSponsorship, env, {
      cookie: readerCookie,
      body: { method, displayName: "Lin" },
    });
    assert.equal(unnamed.status, 400);

    const named = await call(handleNickname, env, {
      cookie: readerCookie,
      body: { nickname: "Lin" },
    });
    assert.equal(named.status, 200);

    const created = await call(handleCreateSponsorship, env, {
      cookie: readerCookie,
      body: { method, displayName: "Someone else" },
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.equal(createdBody.displayName, "Lin");
    assert.equal(createdBody.officialEmail, "xcrunnnn@outlook.com");

    const again = await call(handleCreateSponsorship, env, {
      cookie: readerCookie,
      body: { method },
    });
    assert.equal(again.status, 409);

    const empty = await call(handlePublicSponsorships, env, { method: "GET" });
    assert.deepEqual(await empty.json(), { month: [], total: [] });

    const stranger = await call(handleAdminSponsorshipsGet, env, {
      method: "GET",
      cookie: readerCookie,
    });
    assert.equal(stranger.status, 403);

    const adminRows = await (
      await call(handleAdminSponsorshipsGet, env, { method: "GET", cookie: adminCookie })
    ).json();
    assert.equal(adminRows.requests[0].method, method);

    const id = createdBody.id;
    const emailed = await call(handleAdminSponsorshipsPost, env, {
      cookie: adminCookie,
      body: { id, action: "email" },
    });
    assert.equal((await emailed.json()).request.emailSentAt, NOW);

    const badAmount = await call(handleAdminSponsorshipsPost, env, {
      cookie: adminCookie,
      body: { id, action: "list", amount: "0" },
    });
    assert.equal(badAmount.status, 400);

    const listed = await call(handleAdminSponsorshipsPost, env, {
      cookie: adminCookie,
      now: EARLIER,
      body: { id, action: "list", amount: "10" },
    });
    assert.equal(listed.status, 200);

    const second = await call(handleCreateSponsorship, env, {
      cookie: readerCookie,
      body: { method },
    });
    assert.equal(second.status, 201);
    const secondId = (await second.json()).id;
    await call(handleAdminSponsorshipsPost, env, {
      cookie: adminCookie,
      body: { id: secondId, action: "list", amount: "5.50" },
    });

    const boards = await (await call(handlePublicSponsorships, env, { method: "GET" })).json();
    // The public line carries the reader's public id for the avatar, never the account id or email.
    assert.match(readerPublicId, /^[a-f0-9]{12}$/);
    assert.deepEqual(boards.month, [{ name: "Lin", cents: 550, publicId: readerPublicId }]);
    assert.deepEqual(boards.total, [{ name: "Lin", cents: 1550, publicId: readerPublicId }]);
    assert.doesNotMatch(JSON.stringify(boards), /@|example\.com/);

    const mine = await (
      await call(handleMySponsorship, env, { method: "GET", cookie: readerCookie })
    ).json();
    assert.equal(mine.open, null);

    await call(handleNickname, env, { cookie: readerCookie, body: { nickname: "Mei" } });
    const renamed = await (await call(handlePublicSponsorships, env, { method: "GET" })).json();
    assert.deepEqual(renamed.month, [{ name: "Mei", cents: 550, publicId: readerPublicId }]);
    assert.deepEqual(renamed.total, [{ name: "Mei", cents: 1550, publicId: readerPublicId }]);
  });
}
