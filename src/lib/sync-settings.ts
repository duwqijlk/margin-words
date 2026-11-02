import { asSettings, sameSyncItem, type SettingsData, type SyncItem } from "./sync-merge.ts";

export type HistorySettings = Pick<SettingsData, "reviewLog"> & { readDays: string[] };

/** Device preferences never cross the upgraded client's synchronization boundary. */
export function historySettings(data: unknown): HistorySettings {
  const settings = asSettings(data);
  return { reviewLog: settings.reviewLog, readDays: settings.readDays ?? [] };
}

export function clientSyncItem(item: SyncItem): SyncItem {
  return item.kind === "settings" && !item.deleted ? { ...item, data: historySettings(item.data) } : item;
}

export function sameClientSyncItem(a: SyncItem, b: SyncItem): boolean {
  return sameSyncItem(clientSyncItem(a), clientSyncItem(b));
}
