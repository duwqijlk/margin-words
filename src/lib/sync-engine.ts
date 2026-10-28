/**
 * Optional account sync. The shelf keeps working with no account.
 * After sign-in, local state and the server copy are merged (nothing on either
 * side is dropped), then later edits are pushed on a short delay. Offline is
 * normal: the push waits and runs on the next start, focus, or reconnect.
 */
import { useAccount, type AccountRole } from "@/lib/account-store";
import { isSponsorAdmin } from "@/lib/sponsor";
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
  syncBatches,
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
import { claimDevice, ownedByAnother, PENDING_KEY, startDeviceWipe } from "@/lib/device-wipe";
import { afterPull, afterPush, needsUpload, pullAfter, readView, SYNC_VIEW_KEY, type SyncView } from "@/lib/sync-view";
import { canSkipPull, type LastPull, PUSH_DELAY_MS, pushDelay } from "@/lib/sync-pace";

const META_KEY = "cibian-sync-meta-v1";
const EMAIL_KEY = "cibian-account-email-v1";
const NICK_KEY = "cibian-account-nickname-v1";
const ROLE_KEY = "cibian-account-role-v1";
const DIRTY_KEY = "cibian-sync-dirty-v1";
/** Coming back to the tab pulls again only after this long (a pending edit still syncs at once). */
const FOCUS_PULL_MS = 30_000;

let meta: SyncMeta = emptyMeta();
let prev: LocalSnapshot | null = null;
let quiet = false;
let armed = false;
let running = false;
let again = false;
let dirty = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastRun = 0;
/** Review sessions holding uploads (holdSyncPushes), edits waiting since the last sync, the last pull. */
let holds = 0;
let waiting = 0;
let lastPull: LastPull = null;
let started = false;
let readyWait: Array<() => void> = [];
let ready = false;
let sessionEpoch = 0;
/** Set once the device is about to be cleared. Nothing is sent after that, not even on pagehide. */
let stopped = false;

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
    paging: state.paging,
    pronunciationAccent: state.pronunciationAccent,
    quietMarks: state.quietMarks,
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

function rememberEmail(email: string | null, nickname?: string | null, role?: AccountRole) {
  writeStorage(EMAIL_KEY, email);
  // The record of what the server holds belongs to one account (sync-view.ts).
  if (!email) writeStorage(SYNC_VIEW_KEY, null);
  if (!email) writeStorage(ROLE_KEY, null);
  else if (role !== undefined) writeStorage(ROLE_KEY, role);
  const nextNick = email ? (nickname === undefined ? useAccount.getState().nickname : nickname) : null;
  if (!email || nickname !== undefined) writeStorage(NICK_KEY, nextNick);
  useAccount.getState().patch({
    email,
    nickname: nextNick,
    phase: email ? "in" : "out",
    ...(role !== undefined ? { role } : {}),
    ...(email ? {} : { nicknamePrompt: false }),
  });
}

function userFields(payload: Record<string, unknown>): {
  email: string | null;
  nickname: string | null;
  role: "user" | "trusted" | "admin";
  emailVerified: boolean;
  publicId: string | null;
  avatar: number;
} {
  const user = payload.user;
  if (!user || typeof user !== "object") return { email: null, nickname: null, role: "user", emailVerified: true, publicId: null, avatar: 0 };
  const record = user as {
    email?: unknown;
    nickname?: unknown;
    role?: unknown;
    emailVerified?: unknown;
    publicId?: unknown;
    avatar?: unknown;
  };
  const email = typeof record.email === "string" && record.email ? record.email : null;
  const nickname = typeof record.nickname === "string" && record.nickname ? record.nickname : null;
  const role = record.role === "trusted" || record.role === "admin" ? record.role : "user";
  // An older server does not send the field: treat that as checked.
  const publicId = typeof record.publicId === "string" && /^[a-z0-9]{12}$/.test(record.publicId) ? record.publicId : null;
  const avatar = typeof record.avatar === "number" && record.avatar > 0 ? record.avatar : 0;
  return { email, nickname, role, emailVerified: record.emailVerified !== false, publicId, avatar };
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
    let payload = body;
    if (payload && typeof payload === "object" && "body" in payload && !("action" in payload)) {
      const inner = (payload as { body: unknown }).body;
      if (typeof inner === "string") {
        try {
          payload = JSON.parse(inner) as unknown;
        } catch {
          payload = inner;
        }
      } else if (inner && typeof inner === "object") {
        payload = inner;
      }
    }
    response = await request(path, payload === undefined ? { method: "GET" } : { method: "POST", body: JSON.stringify(payload) });
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

/** POST a body that must reach the server byte-for-byte, such as a glossary file. */
export async function accountPostRaw(path: string, body: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await request(path, { method: "POST", body });
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

/** POST multipart form data (file uploads). The browser sets the content type. */
export async function accountPostForm(path: string, form: FormData): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(path, { method: "POST", body: form, credentials: "same-origin" });
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

/**
 * Read what the server holds: only what changed since this device's cursor when it has one, the
 * whole account otherwise (sync-view.ts says when). Returns the items and the updated record.
 */
async function pullItems(): Promise<{ items: SyncItem[]; full: boolean; view: SyncView | null }> {
  const email = useAccount.getState().email;
  const known = readView(readStorage(SYNC_VIEW_KEY), email);
  const after = pullAfter(known, email, Date.now());
  const payload = await accountRequest(after === null ? "/api/sync" : `/api/sync?after=${after}`);
  const items = asItems(payload.items);
  // A server without cursors answers every pull in full and sends no cursor: then there is no
  // record, and the upload is decided against this full answer as before.
  const full = after === null || typeof payload.cursor !== "number";
  const view = email ? afterPull(known, email, items, payload.cursor, full, Date.now()) : null;
  return { items, full, view };
}

async function pushItems(items: SyncItem[]): Promise<SyncItem[]> {
  if (items.length === 0) return [];
  // A first sync from a new device can carry a whole shelf and a whole word book. One request
  // with all of it is a lot of CPU for a single Function call (10ms on the Free plan) and can be
  // larger than the server takes, so the upload goes in batches and the answers are joined.
  const out: SyncItem[] = [];
  for (const batch of syncBatches(items)) {
    const payload = await accountRequest("/api/sync", { items: batch });
    out.push(...asItems(payload.items));
  }
  return out;
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
    paging: settings.paging === true,
    pronunciationAccent: settings.pronunciationAccent === "UK" ? "UK" as const : "US" as const,
    quietMarks: settings.quietMarks === true,
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
  waiting += 1;
  if (useAccount.getState().phase === "in") schedulePush();
}

/** sync-pace.ts says how long an edit waits: longer while a review session holds uploads. */
function schedulePush(delay = pushDelay(holds > 0, waiting)) {
  if (useAccount.getState().phase !== "in") return;
  markDirty();
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, delay);
}

async function flush() {
  if (stopped || useAccount.getState().phase !== "in") return;
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
  waiting = 0;
  useAccount.getState().patch({ sync: "saving" });
  try {
    // Right after another sync the pull is skipped (sync-pace.ts): the upload is decided against
    // the cursor record, and the server merges what it is sent. Nothing to upload, no request.
    const email = useAccount.getState().email;
    const known = readView(readStorage(SYNC_VIEW_KEY), email);
    const skip = canSkipPull(known, email, lastPull, lastRun);
    const pulled = skip ? { items: [] as SyncItem[], full: false, view: known } : await pullItems();
    if (!skip) lastPull = email && pulled.view ? { email, at: lastRun } : null;
    const remote = pulled.items;
    let view = pulled.view;
    // Per-book `words` items from older versions are read as part of the wordbook; they are never rewritten.
    // A partial pull is merged the same way: mergeSnapshots joins per item, and an item the pull
    // did not return keeps its local value.
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
    // Upload what the server does not hold yet. With a record, that is decided against the
    // signatures it keeps for every item; without one, against the full pull just made.
    const upload = after.filter((item) => {
      if (view && !pulled.full) return needsUpload(view, item);
      const prior = remote.find((other) => itemKey(other) === itemKey(item));
      return !prior || !sameSyncItem(prior, item);
    });
    if (upload.length > 0) {
      const saved = await pushItems(upload);
      view = afterPush(view, saved);
      const againLocal = buildSyncItems(capture(), meta);
      const reconciled = mergeSnapshots(foldLegacyWords(saved), againLocal);
      const needApply = reconciled.some((item) => {
        const prior = againLocal.find((other) => itemKey(other) === itemKey(item));
        return !prior || !sameSyncItem(prior, item);
      });
      if (needApply) await applyMerged(reconciled);
    }
    // Only after a whole round: a failed push leaves the old cursor, and the next pull returns
    // whatever did reach the server (its writes are newer than that cursor).
    if (view && view.email === useAccount.getState().email) writeStorage(SYNC_VIEW_KEY, JSON.stringify(view));
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

/** No more pushes from this page: the device is about to be cleared and the page reloads. */
function stopSyncing() {
  stopped = true;
  sessionEpoch += 1;
  armed = false;
  if (timer) clearTimeout(timer);
  timer = null;
}

/**
 * The data on this device belongs to another account: clear it before anything is merged, so the
 * last reader's shelf and wordbook never reach this account. Returns true when the page reloads.
 */
function clearIfAnother(email: string): boolean {
  if (!ownedByAnother(email)) {
    claimDevice(email);
    return false;
  }
  stopSyncing();
  void startDeviceWipe(email);
  return true;
}

async function refreshSession() {
  const epoch = sessionEpoch;
  const saved = readStorage(EMAIL_KEY);
  const storedRole = readStorage(ROLE_KEY) as AccountRole | null;
  const initialRole: AccountRole = storedRole ?? (isSponsorAdmin(saved) ? "admin" : "user");
  if (saved) {
    useAccount.getState().patch({
      email: saved,
      nickname: readStorage(NICK_KEY),
      role: initialRole,
      phase: "in",
    });
  }
  if (!online()) {
    useAccount.getState().patch({ phase: saved ? "in" : "out", sync: saved ? "offline" : "idle" });
    return;
  }
  try {
    const payload = await accountRequest("/api/auth/me");
    if (epoch !== sessionEpoch) return;
    const fields = userFields(payload);
    useAccount.getState().patch({
      resetEmail: payload.resetEmail === true,
      role: fields.role,
      emailVerified: fields.emailVerified,
      publicId: fields.publicId,
      avatar: fields.avatar,
    });
    if (fields.email) {
      rememberEmail(fields.email, fields.nickname, fields.role);
      if (clearIfAnother(fields.email)) return;
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
  if (Date.now() - lastRun < FOCUS_PULL_MS && !dirty) return;
  void flush();
}

/**
 * While a review session is open, edits are uploaded in batches (sync-pace.ts) instead of one sync
 * per answer. Returns the release; releasing uploads what is waiting. Hiding or closing the page
 * still uploads at once (onFocus, onPageHide).
 */
export function holdSyncPushes(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
    if (holds === 0 && timer) schedulePush(PUSH_DELAY_MS);
  };
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
  // Another tab signed out or switched account: this tab must not save its old state back.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== PENDING_KEY || !event.newValue) return;
    stopSyncing();
    window.location.reload();
  };
  window.addEventListener("storage", onStorage);
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
    window.removeEventListener("storage", onStorage);
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
  useAccount.getState().patch({ emailVerified: fields.emailVerified, publicId: fields.publicId, avatar: fields.avatar });
  rememberEmail(fields.email ?? email, fields.nickname, fields.role);
  if (clearIfAnother(fields.email ?? email)) return;
  await flush();
}

/**
 * Start a sign-up: the server checks the form and emails a 6-digit code. No account exists yet and
 * nothing is signed in; finishSignUp with the code makes the account. Returns the address the code
 * went to (lower case, as the server keeps it).
 */
export async function signUp(
  email: string,
  password: string,
  turnstileToken?: string,
): Promise<{ email: string; ticket: string }> {
  const payload = await accountRequest("/api/auth/register", {
    email,
    password,
    turnstileToken: turnstileToken || undefined,
  });
  return {
    email: typeof payload.email === "string" ? payload.email : email,
    ticket: typeof payload.ticket === "string" ? payload.ticket : "",
  };
}

/** A new code for a sign-up in progress. The first code stops working. */
export async function resendSignUpCode(email: string, ticket: string): Promise<void> {
  await accountRequest("/api/auth/register/resend", { email, ticket });
}

/** Finish a sign-up with the emailed code: the account is made (already checked) and signed in. */
export async function finishSignUp(email: string, code: string, ticket: string): Promise<void> {
  await readyPromise();
  const epoch = ++sessionEpoch;
  const payload = await accountRequest("/api/auth/register/confirm", { email, code, ticket });
  if (epoch !== sessionEpoch) return;
  const fields = userFields(payload);
  useAccount.getState().patch({ emailVerified: fields.emailVerified, publicId: fields.publicId, avatar: fields.avatar });
  rememberEmail(fields.email ?? email, fields.nickname, fields.role);
  if (clearIfAnother(fields.email ?? email)) return;
  await flush();
}

/**
 * Shrink a picked image to a 128x128 WebP (centre crop) in the browser and upload it as the
 * reader's avatar. Throws "avatar-type" when the browser cannot read or encode the image.
 */
/** The reader already changed their avatar today. `nextAt` is when the next change is allowed. */
export class AvatarDailyLimit extends Error {
  readonly nextAt: number;
  constructor(nextAt: number) {
    super("avatar-daily");
    this.nextAt = nextAt;
  }
}

export async function uploadAvatar(file: File): Promise<void> {
  if (!file.type.startsWith("image/")) throw new Error("avatar-type");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("avatar-type");
  }
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("avatar-type");
  const side = Math.min(bitmap.width, bitmap.height);
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
  // A browser that cannot write WebP returns PNG instead; the server only takes WebP.
  if (!blob || blob.type !== "image/webp") throw new Error("avatar-type");
  let response: Response;
  try {
    response = await fetch("/api/auth/avatar", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "image/webp" },
      body: blob,
    });
  } catch {
    throw new Error("network");
  }
  const payload = await readBody(response);
  if (!response.ok) {
    const code = typeof payload.error === "string" ? payload.error : "generic";
    // Once a day: say when the next change is allowed.
    if (code === "avatar-daily" && typeof payload.nextAt === "number") throw new AvatarDailyLimit(payload.nextAt);
    throw new Error(code);
  }
  useAccount.getState().patch({ avatar: typeof payload.avatar === "number" ? payload.avatar : 0 });
}

export async function removeAvatar(): Promise<void> {
  const response = await request("/api/auth/avatar", { method: "DELETE" });
  if (!response.ok) throw new Error("generic");
  useAccount.getState().patch({ avatar: 0 });
}

/** Send the 6-digit code to the signed-in account's email again. */
export async function sendEmailCode(): Promise<void> {
  await accountRequest("/api/auth/email-code/send", {});
}

/** Check the emailed code. On success the account may open word lists. */
export async function confirmEmailCode(code: string): Promise<void> {
  const payload = await accountRequest("/api/auth/email-code/confirm", { code });
  useAccount.getState().patch({ emailVerified: userFields(payload).emailVerified });
}

export async function saveNickname(nickname: string): Promise<void> {
  const payload = await accountRequest("/api/auth/nickname", { nickname });
  const fields = userFields(payload);
  const email = fields.email ?? useAccount.getState().email;
  if (email) rememberEmail(email, fields.nickname);
}

/**
 * Sign out and clear this device: the shelf, the book files and word lists, progress, the wordbook
 * and settings. The cloud copy stays, so signing in again brings the synced part back. Changes not
 * sent yet are sent first. The page reloads; `login` opens the sign-in dialog after it.
 */
export async function signOut(options: { login?: boolean } = {}): Promise<void> {
  if (dirty && online()) {
    try {
      await flush();
    } catch {
      // Best effort: flush() reports its own failure.
    }
  }
  stopSyncing();
  try {
    await accountRequest("/api/auth/logout", {});
  } catch {
    // The cookie may already be gone. The device is still cleared.
  }
  await startDeviceWipe(null, options);
}

/** Delete the account, then clear this device the same way as a sign-out. */
export async function deleteAccount(password: string): Promise<void> {
  await accountRequest("/api/auth/delete", { password });
  stopSyncing();
  await startDeviceWipe(null);
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
