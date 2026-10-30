/**
 * Clearing this device when an account leaves it, so the next account that signs in here does not
 * merge the last reader's shelf, word lists, progress and wordbook into its own.
 *
 * The wipe runs at the next page start, before the app reads any storage (see main.tsx). Clearing
 * storage under a running app would let the open stores write their old state back, or let the
 * sync engine send every book to the cloud as a deletion.
 */

/** The book files, word lists and covers on this device (book-db.ts). */
export const BOOK_DB_NAME = "cibian-books";

/** The signed-in account, kept when the device is cleared for an account that is signing in. */
export const ACCOUNT_KEYS = ["cibian-account-email-v1", "cibian-account-nickname-v1", "cibian-account-role-v1"] as const;

/** localStorage keys that belong to the reader who used this device. */
export const PERSONAL_KEYS = [
  ...ACCOUNT_KEYS,
  "cibian-notebook-v1",
  "cibian-progress-v1",
  "cibian-quotes-v1",
  "cibian-prefs-v1",
  "cibian-sync-meta-v1",
  "cibian-sync-dirty-v1",
  "cibian-pending-removal-v1",
  "cibian-removed-packs-v1",
  "cibian-cover-tried-v1",
  "cibian-library-v1",
] as const;

/** Which account the data on this device belongs to (its email, lower case). */
export const OWNER_KEY = "cibian-device-owner-v1";

/** Set before the reload that clears the device. Other tabs reload when they see it. */
export const PENDING_KEY = "cibian-device-wipe-v1";

/** sessionStorage: open the sign-in dialog once after the reload ("Switch account"). */
const LOGIN_AFTER_KEY = "cibian-login-after-wipe";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type DbFactory = Pick<IDBFactory, "deleteDatabase">;
type Pending = { owner: string | null };

function local(): Store | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function normal(email: string): string {
  return email.trim().toLowerCase();
}

export function deviceOwner(storage: Store | undefined = local()): string | null {
  try {
    return storage?.getItem(OWNER_KEY) ?? null;
  } catch {
    return null;
  }
}

/** The first account that signs in on a device owns what is on it. A later sign-in keeps the owner. */
export function claimDevice(email: string, storage: Store | undefined = local()): void {
  if (deviceOwner(storage)) return;
  try {
    storage?.setItem(OWNER_KEY, normal(email));
  } catch {
    // Blocked storage: nothing stays on this device anyway.
  }
}

/** True when the data here belongs to another account than `email`. No owner yet means it does not. */
export function ownedByAnother(email: string, storage: Store | undefined = local()): boolean {
  const owner = deviceOwner(storage);
  return Boolean(owner && owner !== normal(email));
}

/**
 * Delete the reader's data from this device: the book database and the personal localStorage keys.
 * `keep` names keys to leave in place. Resolves when the database is gone, or when the browser
 * will not say (another tab holds it open: it closes on "versionchange" and the delete ends then).
 */
export async function wipeDeviceStorage(
  options: { keep?: readonly string[]; storage?: Store; indexedDB?: DbFactory } = {},
): Promise<void> {
  const storage = options.storage ?? local();
  const keep = new Set(options.keep ?? []);
  for (const key of [...PERSONAL_KEYS, OWNER_KEY]) {
    if (keep.has(key)) continue;
    try {
      storage?.removeItem(key);
    } catch {
      // see above
    }
  }
  const factory = options.indexedDB ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
  if (!factory) return;
  await new Promise<void>((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.deleteDatabase(BOOK_DB_NAME);
    } catch {
      resolve();
      return;
    }
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/**
 * Clear the device on the next start and reload now. `owner` is the account signing in (its
 * account keys stay and it owns the empty device), or null after a sign-out.
 */
export async function startDeviceWipe(owner: string | null, options: { login?: boolean } = {}): Promise<void> {
  const storage = local();
  if (options.login) {
    try {
      sessionStorage.setItem(LOGIN_AFTER_KEY, "1");
    } catch {
      // The reader opens the sign-in dialog by hand.
    }
  }
  const pending: Pending = { owner: owner ? normal(owner) : null };
  try {
    storage?.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Storage that cannot keep the flag: clear now, the reload follows straight away.
    await wipeDeviceStorage({ keep: owner ? ACCOUNT_KEYS : [] });
  }
  window.location.reload();
}

/** Run at page start, before the app reads storage. Does nothing unless a wipe was asked for. */
export async function finishDeviceWipe(
  options: { storage?: Store; indexedDB?: DbFactory } = {},
): Promise<boolean> {
  const storage = options.storage ?? local();
  let raw: string | null = null;
  try {
    raw = storage?.getItem(PENDING_KEY) ?? null;
  } catch {
    return false;
  }
  if (!raw) return false;
  let pending: Pending = { owner: null };
  try {
    const parsed = JSON.parse(raw) as { owner?: unknown };
    pending = { owner: typeof parsed.owner === "string" && parsed.owner ? parsed.owner : null };
  } catch {
    // An unreadable flag still means: clear everything.
  }
  await wipeDeviceStorage({ keep: pending.owner ? ACCOUNT_KEYS : [], storage, indexedDB: options.indexedDB });
  if (pending.owner) claimDevice(pending.owner, storage);
  try {
    storage?.removeItem(PENDING_KEY);
  } catch {
    // see above
  }
  return true;
}

/** True once after a "Switch account" reload. */
export function takeLoginAfterWipe(): boolean {
  try {
    if (sessionStorage.getItem(LOGIN_AFTER_KEY) !== "1") return false;
    sessionStorage.removeItem(LOGIN_AFTER_KEY);
    return true;
  } catch {
    return false;
  }
}
