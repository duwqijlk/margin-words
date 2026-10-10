/**
 * Optional account sync. The shelf keeps working with no account.
 * After sign-in, local state and the server copy are merged (nothing on either
 * side is dropped), then later edits are pushed on a short delay. Offline is
 * normal: the push waits and runs on the next start, focus, or reconnect.
 */
import { useAccount } from "@/lib/account-store";
import { useLocale, type Locale } from "@/lib/i18n";
import { usePrefs, type Prefs } from "@/lib/reader-prefs";
import { useProgress } from "@/lib/progress-store";
import { forgetBook } from "@/lib/shelf-remove";
import { repairShelf } from "@/lib/shelf-repair";
import {
  buildSyncItems,
  captureSnapshot,
  emptyMeta,
  loadMeta,
  noteChanges,
  type LocalSnapshot,
  type SyncMeta,
} from "@/lib/sync-diff";
import {
  asProgress,
  asSettings,
  asShelf,
  asWordbookBlob,
  bookSyncKey,
  foldLegacyWords,
  isLive,
  itemKey,
  lemmaKey,
  mergeSnapshots,
  sameSyncItem,
  wordbookItemId,
  wordbookShard,
  type SettingsData,
  type SyncItem,
  type WordbookRecord,
} from "@/lib/sync-merge";
import { rehomeForeignSources } from "@/lib/wordbook";
import { useVocab } from "@/lib/vocab-store";
import type { Book, VocabEntry, WordSource } from "@/lib/vocab-model";

const META_KEY = "cibian-sync-meta-v1";
const EMAIL_KEY = "cibian-account-email-v1";
const NICK_KEY = "cibian-account-nickname-v1";
const DIRTY_KEY = "cibian-sync-dirty-v1";
const PUSH_DELAY_MS = 1500;

let meta: SyncMeta = emptyMeta();
let prev: LocalSnapshot | null = null;
let quiet = false;
let armed = false;
let running = false;
let again = false;
let dirty = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastRun = 0;
let started = false;
let readyWait: Array<() => void> = [];
let ready = false;
let sessionEpoch = 0;

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private mode: sync still works until the tab closes.
  }
}

function prefsOf(): Prefs {
  const state = usePrefs.getState();
  return {
    theme: state.theme,
    font: state.font,
    size: state.size,
    leading: state.leading,
    width: state.width,
    column: state.column,
    focus: state.focus,
  };
}

function capture(): LocalSnapshot {
  const vocab = useVocab.getState();
  const settings = {
    ...prefsOf(),
    locale: useLocale.getState().locale,
    reviewLog: vocab.log,
  };
  return captureSnapshot({
    books: vocab.books,
    words: vocab.words,
    progress: useProgress.getState().items,
    settings,
  });
}

function rememberEmail(email: string | null, nickname?: string | null) {
  writeStorage(EMAIL_KEY, email);
  const nextNick = email ? (nickname === undefined ? useAccount.getState().nickname : nickname) : null;
  if (!email || nickname !== undefined) writeStorage(NICK_KEY, nextNick);
  useAccount.getState().patch({
    email,
    nickname: nextNick,
    phase: email ? "in" : "out",
    ...(email ? {} : { nicknamePrompt: false }),
  });
}

function userFields(payload: Record<string, unknown>): { email: string | null; nickname: string | null } {
  const user = payload.user;
  if (!user || typeof user !== "object") return { email: null, nickname: null };
  const record = user as { email?: unknown; nickname?: unknown };
  const email = typeof record.email === "string" && record.email ? record.email : null;
  const nickname = typeof record.nickname === "string" && record.nickname ? record.nickname : null;
  return { email, nickname };
}

function saveMeta() {
  writeStorage(META_KEY, JSON.stringify(meta));
}

function markDirty() {
  dirty = true;
  writeStorage(DIRTY_KEY, "1");
}

function clearDirty() {
  dirty = false;
  writeStorage(DIRTY_KEY, null);
}

type ApiError = { error?: string };

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
}

async function readBody(response: Response): Promise<ApiError & Record<string, unknown>> {
  try {
    return (await response.json()) as ApiError & Record<string, unknown>;
  } catch {
    return { error: response.ok ? "bad-json" : "network" };
  }
}

export async function accountRequest(path: string, body?: unknown): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await request(path, body === undefined ? { method: "GET" } : { method: "POST", body: JSON.stringify(body) });
  } catch {
    throw new Error("network");
  }
  const payload = await readBody(response);
  if (!response.ok) {
    if (response.status === 401 && payload.error !== "credentials") throw new Error("unauthorized");
    throw new Error(typeof payload.error === "string" ? payload.error : "generic");
  }
  return payload;
}

function asItems(value: unknown): SyncItem[] {
  if (!Array.isArray(value)) return [];
  const out: SyncItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<SyncItem>;
    if (row.kind !== "shelf" && row.kind !== "progress" && row.kind !== "words" && row.kind !== "wordbook" && row.kind !== "settings") continue;
    if (typeof row.itemId !== "string") continue;
    out.push({
      kind: row.kind,
      itemId: row.itemId,
      updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : 0,
      deleted: row.deleted === true,
      data: row.data ?? {},
    });
  }
  return out;
}

function online(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

async function pullItems(): Promise<SyncItem[]> {
  const payload = await accountRequest("/api/sync");
  return asItems(payload.items);
}

async function pushItems(items: SyncItem[]): Promise<SyncItem[]> {
  if (items.length === 0) return [];
  const payload = await accountRequest("/api/sync", { items });
  return asItems(payload.items);
}

function alignMeta(items: SyncItem[]) {
  for (const item of items) {
    if (item.kind === "shelf") {
      if (item.deleted) meta.shelfDeleted[item.itemId] = item.updatedAt;
      else {
        delete meta.shelfDeleted[item.itemId];
        meta.shelfTouched[item.itemId] = Math.max(meta.shelfTouched[item.itemId] ?? 0, item.updatedAt);
      }
    } else if (item.kind === "progress") {
      if (item.deleted) meta.progressDeleted[item.itemId] = item.updatedAt;
      else delete meta.progressDeleted[item.itemId];
    } else if (item.kind === "wordbook" && !item.deleted) {
      const blob = asWordbookBlob(item.data);
      for (const word of blob.words) {
        const lemma = lemmaKey(word.lemma);
        meta.wordTouched[lemma] = Math.max(meta.wordTouched[lemma] ?? 0, word.updatedAt);
        delete meta.wordRemoved[lemma];
        const gone: Record<string, number> = {};
        for (const source of word.sources) if (!isLive(source)) gone[source.k] = source.removed;
        if (Object.keys(gone).length > 0) meta.sourceRemoved[lemma] = { ...(meta.sourceRemoved[lemma] ?? {}), ...gone };
      }
      for (const row of blob.removed) {
        const lemma = lemmaKey(row.lemma);
        meta.wordRemoved[lemma] = Math.max(meta.wordRemoved[lemma] ?? 0, row.updatedAt);
        delete meta.wordTouched[lemma];
        delete meta.sourceRemoved[lemma];
      }
    } else if (item.kind === "settings") {
      meta.settingsUpdatedAt = Math.max(meta.settingsUpdatedAt, item.updatedAt);
    }
  }
  saveMeta();
}

function recordToSource(source: Extract<WordbookRecord["sources"][number], { book: string }>): WordSource {
  const { k: _k, ...rest } = source;
  return rest;
}

/** The merged wordbook shards become the local list. Local ids are kept so open review sessions stay valid. */
function mergeWordbook(local: VocabEntry[], items: SyncItem[], books: Book[]): VocabEntry[] {
  const shards = items.filter((item) => item.kind === "wordbook");
  if (shards.length === 0) return local;
  const byLemma = new Map(local.map((word) => [lemmaKey(word.lemma), word]));
  const seen = new Set<string>();
  const out: VocabEntry[] = [];
  for (const item of shards) {
    if (item.deleted) continue;
    for (const record of asWordbookBlob(item.data).words) {
      const lemma = lemmaKey(record.lemma);
      const prior = byLemma.get(lemma);
      seen.add(lemma);
      const { sources, updatedAt: _updatedAt, ...rest } = record;
      const live = sources.filter(isLive).map(recordToSource);
      const home = books.find((book) => live.some((source) => source.book === bookSyncKey(book)));
      out.push({
        ...rest,
        id: prior?.id ?? record.id,
        ...(prior?.bookId && books.some((book) => book.id === prior.bookId)
          ? { bookId: prior.bookId }
          : home
            ? { bookId: home.id }
            : {}),
        sources: live,
      });
    }
  }
  const shardIds = new Set(shards.map((item) => item.itemId));
  const kept = local.filter((word) => !seen.has(lemmaKey(word.lemma)) && !shardIds.has(wordbookItemId(wordbookShard(word.lemma))));
  return rehomeForeignSources([...out, ...kept]);
}

async function applyMerged(items: SyncItem[]) {
  quiet = true;
  try {
    const shelf = items.filter((item) => item.kind === "shelf");
    for (const item of shelf) {
      if (!item.deleted) continue;
      const locals = useVocab.getState().books.filter((book) => bookSyncKey(book) === item.itemId);
      for (const book of locals) await forgetBook(book.id);
    }

    let books = [...useVocab.getState().books];
    for (const item of shelf) {
      if (item.deleted) continue;
      const data = asShelf(item.data);
      if (!data) continue;
      const matches = books.filter((book) => bookSyncKey(book) === item.itemId);
      if (matches.length === 0) {
        const id = books.some((book) => book.id === data.id) ? crypto.randomUUID() : data.id;
        const created: Book = { ...data, id, updatedAt: item.updatedAt };
        books = [created, ...books];
        continue;
      }
      const ids = new Set(matches.map((book) => book.id));
      books = books.map((book) => (ids.has(book.id) ? { ...book, ...data, id: book.id, updatedAt: item.updatedAt } : book));
    }

    const nextWords = mergeWordbook(useVocab.getState().words, items, books);

    const progress = { ...useProgress.getState().items };
    for (const book of books) {
      const key = bookSyncKey(book);
      const item = items.find((entry) => entry.kind === "progress" && entry.itemId === key);
      if (!item) continue;
      if (item.deleted) delete progress[book.id];
      else {
        const data = asProgress(item.data);
        if (data) progress[book.id] = data;
      }
    }

    const settingsItem = items.find((item) => item.kind === "settings" && !item.deleted);
    const settings = settingsItem ? asSettings(settingsItem.data) : null;

    useVocab.setState({
      books,
      words: nextWords,
      ...(settings ? { log: settings.reviewLog } : {}),
    });
    useProgress.setState({ items: progress });
    if (settings) applySettings(settings);
    alignMeta(items);
    try {
      await repairShelf();
    } catch {
      // A duplicate card can wait until the next start.
    }
    prev = capture();
  } finally {
    quiet = false;
  }
}

function applySettings(settings: SettingsData) {
  const current = prefsOf();
  const next = {
    theme: settings.theme,
    font: settings.font,
    size: settings.size,
    leading: settings.leading,
    width: settings.width,
    column: settings.column,
    focus: settings.focus,
  };
  if (JSON.stringify(current) !== JSON.stringify(next)) usePrefs.getState().set(next);
  if (useLocale.getState().locale !== settings.locale) useLocale.getState().setLocale(settings.locale as Locale);
}

function onStore() {
  if (!armed || quiet) return;
  const next = capture();
  if (!prev) {
    prev = next;
    return;
  }
  const changed = noteChanges(meta, prev, next, Date.now());
  const changedJson = JSON.stringify(changed);
  if (changedJson === JSON.stringify(meta) && JSON.stringify(prev) === JSON.stringify(next)) return;
  meta = changed;
  prev = next;
  saveMeta();
  if (useAccount.getState().phase === "in") schedulePush();
}

function schedulePush(delay = PUSH_DELAY_MS) {
  if (useAccount.getState().phase !== "in") return;
  markDirty();
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, delay);
}

async function flush() {
  if (useAccount.getState().phase !== "in") return;
  if (running) {
    again = true;
    return;
  }
  if (!online()) {
    useAccount.getState().patch({ sync: "offline" });
    return;
  }
  running = true;
  lastRun = Date.now();
  useAccount.getState().patch({ sync: "saving" });
  try {
    const remote = await pullItems();
    // Per-book `words` items from older versions are read as part of the wordbook; they are never rewritten.
    const folded = foldLegacyWords(remote);
    const local = buildSyncItems(capture(), meta);
    const merged = mergeSnapshots(folded, local);
    const differs = (list: readonly SyncItem[]) =>
      merged.some((item) => {
        const prior = list.find((other) => itemKey(other) === itemKey(item));
        return !prior || !sameSyncItem(prior, item);
      });
    if (differs(local)) await applyMerged(merged);
    const after = buildSyncItems(capture(), meta);
    const upload = after.filter((item) => {
      const prior = remote.find((other) => itemKey(other) === itemKey(item));
      return !prior || !sameSyncItem(prior, item);
    });
    if (upload.length > 0) {
      const saved = await pushItems(upload);
      const againLocal = buildSyncItems(capture(), meta);
      const reconciled = mergeSnapshots(foldLegacyWords(saved), againLocal);
      const needApply = reconciled.some((item) => {
        const prior = againLocal.find((other) => itemKey(other) === itemKey(item));
        return !prior || !sameSyncItem(prior, item);
      });
      if (needApply) await applyMerged(reconciled);
    }
    clearDirty();
    useAccount.getState().patch({ sync: "saved" });
  } catch (error) {
    if (error instanceof Error && error.message === "unauthorized") {
      rememberEmail(null);
      useAccount.getState().patch({ sync: "idle" });
      return;
    }
    useAccount.getState().patch({ sync: online() ? "error" : "offline" });
  } finally {
    running = false;
    if (again) {
      again = false;
      schedulePush(400);
    }
  }
}

async function refreshSession() {
  const epoch = sessionEpoch;
  const saved = readStorage(EMAIL_KEY);
  if (saved) useAccount.getState().patch({ email: saved, nickname: readStorage(NICK_KEY), phase: "in" });
  if (!online()) {
    useAccount.getState().patch({ phase: saved ? "in" : "out", sync: saved ? "offline" : "idle" });
    return;
  }
  try {
    const payload = await accountRequest("/api/auth/me");
    if (epoch !== sessionEpoch) return;
    const fields = userFields(payload);
    useAccount.getState().patch({ resetEmail: payload.resetEmail === true });
    if (fields.email) {
      rememberEmail(fields.email, fields.nickname);
      await flush();
    } else {
      rememberEmail(null);
    }
  } catch (error) {
    if (epoch !== sessionEpoch) return;
    // An older server answered 401 for signed-out visitors. Treat that as signed out.
    // Sync and export still use 401, and flush() handles that on its own.
    if (error instanceof Error && error.message === "unauthorized") {
      rememberEmail(null);
      return;
    }
    useAccount.getState().patch({
      phase: saved ? "in" : "out",
      sync: saved ? "offline" : "idle",
    });
  }
}

function onFocus() {
  if (document.visibilityState !== "visible") {
    if (dirty) void flush();
    return;
  }
  if (useAccount.getState().phase !== "in") return;
  if (Date.now() - lastRun < 4000 && !dirty) return;
  void flush();
}

/** Call once the notebook, progress and settings stores have rehydrated. */
export function notifySyncReady() {
  ready = true;
  const waiters = readyWait;
  readyWait = [];
  for (const waiter of waiters) waiter();
}

function whenReady(run: () => void) {
  if (ready) run();
  else readyWait.push(run);
}

function readyPromise(): Promise<void> {
  if (ready) return Promise.resolve();
  return new Promise((resolve) => readyWait.push(resolve));
}

/** Start listeners. Safe to call once; returns a stop function for the page teardown. */
export function startAccountSync(): () => void {
  if (started) return () => undefined;
  started = true;
  meta = loadMeta(readStorage(META_KEY));
  dirty = readStorage(DIRTY_KEY) === "1";
  const stopVocab = useVocab.subscribe(onStore);
  const stopProgress = useProgress.subscribe(onStore);
  const stopPrefs = usePrefs.subscribe(onStore);
  const stopLocale = useLocale.subscribe(onStore);
  const onOnline = () => {
    if (useAccount.getState().phase === "in") void flush();
  };
  const onPageHide = () => {
    if (dirty) void flush();
  };
  document.addEventListener("visibilitychange", onFocus);
  window.addEventListener("online", onOnline);
  window.addEventListener("pagehide", onPageHide);
  whenReady(() => {
    prev = capture();
    armed = true;
    void refreshSession();
  });
  return () => {
    armed = false;
    started = false;
    stopVocab();
    stopProgress();
    stopPrefs();
    stopLocale();
    document.removeEventListener("visibilitychange", onFocus);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("pagehide", onPageHide);
    if (timer) clearTimeout(timer);
  };
}

export async function signIn(email: string, password: string, turnstileToken?: string): Promise<void> {
  await readyPromise();
  const epoch = ++sessionEpoch;
  const payload = await accountRequest("/api/auth/login", {
    email,
    password,
    turnstileToken: turnstileToken || undefined,
  });
  if (epoch !== sessionEpoch) return;
  const fields = userFields(payload);
  rememberEmail(fields.email ?? email, fields.nickname);
  await flush();
}

export async function signUp(email: string, password: string, turnstileToken?: string): Promise<void> {
  await readyPromise();
  const epoch = ++sessionEpoch;
  const payload = await accountRequest("/api/auth/register", {
    email,
    password,
    turnstileToken: turnstileToken || undefined,
  });
  if (epoch !== sessionEpoch) return;
  const fields = userFields(payload);
  rememberEmail(fields.email ?? email, fields.nickname);
  await flush();
}

export async function saveNickname(nickname: string): Promise<void> {
  const payload = await accountRequest("/api/auth/nickname", { nickname });
  const fields = userFields(payload);
  const email = fields.email ?? useAccount.getState().email;
  if (email) rememberEmail(email, fields.nickname);
}

export async function signOut(): Promise<void> {
  sessionEpoch += 1;
  try {
    await accountRequest("/api/auth/logout", {});
  } catch {
    // The cookie may already be gone. Local books stay.
  }
  rememberEmail(null);
  useAccount.getState().patch({ sync: "idle" });
}

export async function deleteAccount(password: string): Promise<void> {
  sessionEpoch += 1;
  await accountRequest("/api/auth/delete", { password });
  rememberEmail(null);
  useAccount.getState().patch({ sync: "idle" });
}

export async function exportAccount(): Promise<void> {
  const payload = await accountRequest("/api/auth/export");
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "margin-words-account.json";
  link.click();
  URL.revokeObjectURL(url);
}

export async function confirmPasswordReset(token: string, password: string): Promise<void> {
  await accountRequest("/api/auth/password-reset/confirm", { token, password });
}

export async function requestPasswordReset(email: string, turnstileToken?: string): Promise<void> {
  await accountRequest("/api/auth/password-reset/request", { email, turnstileToken });
}
