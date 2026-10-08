import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleRegister } from "../functions/lib/handlers.ts";
import {
  handleAdminSponsorshipsGet,
  handleAdminSponsorshipsPost,
  handleCreateSponsorship,
  handleMySponsorship,
  handlePublicSponsorships,
} from "../functions/lib/sponsorship.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = Date.parse("2026-10-08T05:00:00Z");
const EARLIER = Date.parse("2026-09-15T04:00:00Z");

function openDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of ["0001_init.sql", "0002_nickname.sql", "0003_sponsorship.sql"]) {
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

test("a gift is hidden until the admin types dollars and ticks it", async () => {
  const db = openDb();
  const env = { DB: db };
  const reader = await call(handleRegister, env, {
    body: { email: "reader@example.com", password: "correct horse" },
  });
  const readerCookie = cookieFrom(reader);
  const admin = await call(handleRegister, env, {
    body: { email: "xcrunnnn@outlook.com", password: "correct horse" },
  });
  const adminCookie = cookieFrom(admin);

  const denied = await call(handleCreateSponsorship, env, { body: { method: "wechat", displayName: "Lin" } });
  assert.equal(denied.status, 401);

  const created = await call(handleCreateSponsorship, env, {
    cookie: readerCookie,
    body: { method: "wechat", displayName: "Lin" },
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.officialEmail, "xcrunnnn@outlook.com");

  const again = await call(handleCreateSponsorship, env, {
    cookie: readerCookie,
    body: { method: "alipay", displayName: "Lin" },
  });
  assert.equal(again.status, 409);

  const empty = await call(handlePublicSponsorships, env, { method: "GET" });
  assert.deepEqual(await empty.json(), { month: [], total: [] });

  const stranger = await call(handleAdminSponsorshipsGet, env, { method: "GET", cookie: readerCookie });
  assert.equal(stranger.status, 403);

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
    body: { method: "crypto", displayName: "Lin" },
  });
  assert.equal(second.status, 201);
  const secondId = (await second.json()).id;
  await call(handleAdminSponsorshipsPost, env, {
    cookie: adminCookie,
    body: { id: secondId, action: "list", amount: "5.50" },
  });

  const boards = await (await call(handlePublicSponsorships, env, { method: "GET" })).json();
  assert.deepEqual(boards.month, [{ name: "Lin", cents: 550 }]);
  assert.deepEqual(boards.total, [{ name: "Lin", cents: 1550 }]);

  const mine = await (await call(handleMySponsorship, env, { method: "GET", cookie: readerCookie })).json();
  assert.equal(mine.open, null);
});
