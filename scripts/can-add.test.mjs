/**
 * Only a signed-in reader may add books (src/lib/can-add.ts). Signed-out and
 * not-yet-known visitors see "Sign in to add", and the helper opens the normal
 * sign-in dialog.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModules } from "./lib/app-modules.mjs";

const { canAdd, accountStore } = await loadAppModules();
const { canAddBooks, askToSignIn } = canAdd;
const { useAccount } = accountStore;

test("only a signed-in reader may add books", () => {
  assert.equal(canAddBooks("in"), true);
  assert.equal(canAddBooks("out"), false);
  assert.equal(canAddBooks("unknown"), false, "before the first /api/auth/me answer, adding stays closed");
});

test("the gate follows the account store", () => {
  const { patch } = useAccount.getState();
  patch({ phase: "out" });
  assert.equal(canAddBooks(useAccount.getState().phase), false);
  patch({ phase: "in" });
  assert.equal(canAddBooks(useAccount.getState().phase), true);
  patch({ phase: "out" });
});

test("asking to sign in opens the existing sign-in dialog", () => {
  useAccount.getState().closeDialog();
  assert.equal(useAccount.getState().dialogOpen, false);
  askToSignIn();
  const state = useAccount.getState();
  assert.equal(state.dialogOpen, true);
  assert.equal(state.mode, "login");
  useAccount.getState().closeDialog();
});
