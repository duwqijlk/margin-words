import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACCOUNT_KEYS,
  BOOK_DB_NAME,
  claimDevice,
  deviceOwner,
  finishDeviceWipe,
  OWNER_KEY,
  ownedByAnother,
  PENDING_KEY,
  PERSONAL_KEYS,
  wipeDeviceStorage,
} from "../src/lib/device-wipe.ts";

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

/** deleteDatabase that records the name and answers on the next tick. */
function fakeIdb(outcome = "onsuccess") {
  const deleted = [];
  return {
    deleted,
    deleteDatabase(name) {
      deleted.push(name);
      const request = {};
      setTimeout(() => request[outcome]?.(), 0);
      return request;
    },
  };
}

function filled() {
  const values = {};
  for (const key of PERSONAL_KEYS) values[key] = "x";
  values[OWNER_KEY] = "a@example.com";
  values["cibian-locale-v1"] = "zh";
  values["cibian-site-notice-v1"] = "1";
  return memoryStorage(values);
}

test("the first account owns the device; another account is told apart, case does not matter", () => {
  const storage = memoryStorage();
  assert.equal(ownedByAnother("a@example.com", storage), false);
  claimDevice("A@Example.com ", storage);
  assert.equal(deviceOwner(storage), "a@example.com");
  claimDevice("b@example.com", storage);
  assert.equal(deviceOwner(storage), "a@example.com");
  assert.equal(ownedByAnother("a@EXAMPLE.com", storage), false);
  assert.equal(ownedByAnother("b@example.com", storage), true);
});

test("a wipe removes the book database and every personal key, and keeps the language", async () => {
  const storage = filled();
  const idb = fakeIdb();
  await wipeDeviceStorage({ storage, indexedDB: idb });
  assert.deepEqual(idb.deleted, [BOOK_DB_NAME]);
  for (const key of PERSONAL_KEYS) assert.equal(storage.getItem(key), null, key);
  assert.equal(storage.getItem(OWNER_KEY), null);
  assert.equal(storage.getItem("cibian-locale-v1"), "zh");
  assert.equal(storage.getItem("cibian-site-notice-v1"), "1");
});

test("a blocked or failed delete does not hang the page start", async () => {
  for (const outcome of ["onblocked", "onerror"]) {
    const storage = filled();
    await wipeDeviceStorage({ storage, indexedDB: fakeIdb(outcome) });
    assert.equal(storage.getItem("cibian-notebook-v1"), null);
  }
});

test("finishDeviceWipe does nothing without the flag", async () => {
  const storage = filled();
  const idb = fakeIdb();
  assert.equal(await finishDeviceWipe({ storage, indexedDB: idb }), false);
  assert.deepEqual(idb.deleted, []);
  assert.equal(storage.getItem("cibian-notebook-v1"), "x");
});

test("after a sign-out the device is empty and has no owner", async () => {
  const storage = filled();
  storage.setItem(PENDING_KEY, JSON.stringify({ owner: null }));
  const idb = fakeIdb();
  assert.equal(await finishDeviceWipe({ storage, indexedDB: idb }), true);
  assert.deepEqual(idb.deleted, [BOOK_DB_NAME]);
  for (const key of PERSONAL_KEYS) assert.equal(storage.getItem(key), null, key);
  assert.equal(storage.getItem(OWNER_KEY), null);
  assert.equal(storage.getItem(PENDING_KEY), null);
});

test("another account signing in keeps its own account keys and owns the cleared device", async () => {
  const storage = filled();
  for (const key of ACCOUNT_KEYS) storage.setItem(key, "b");
  storage.setItem(PENDING_KEY, JSON.stringify({ owner: "b@example.com" }));
  assert.equal(await finishDeviceWipe({ storage, indexedDB: fakeIdb() }), true);
  for (const key of ACCOUNT_KEYS) assert.equal(storage.getItem(key), "b", key);
  assert.equal(storage.getItem("cibian-notebook-v1"), null);
  assert.equal(storage.getItem("cibian-sync-meta-v1"), null);
  assert.equal(deviceOwner(storage), "b@example.com");
  assert.equal(storage.getItem(PENDING_KEY), null);
});

test("an unreadable flag still clears everything", async () => {
  const storage = filled();
  storage.setItem(PENDING_KEY, "{not json");
  assert.equal(await finishDeviceWipe({ storage, indexedDB: fakeIdb() }), true);
  for (const key of PERSONAL_KEYS) assert.equal(storage.getItem(key), null, key);
});
