import {
  ACTIVE_CHAT_STORAGE_KEY,
  CHAT_STORAGE_SCHEMA_VERSION_STORAGE_KEY,
} from '../shared/settings';
import { CHAT_DB_NAME, closeChatDatabaseForTests } from './chat-repository';

export const LEGACY_CHAT_SESSIONS_STORAGE_KEY = 'chatSessions';
export const CURRENT_CHAT_STORAGE_SCHEMA_VERSION = 3;

export async function bootstrapChatStorage(): Promise<void> {
  const stored = await chrome.storage.local.get(CHAT_STORAGE_SCHEMA_VERSION_STORAGE_KEY);
  const rawVersion = stored[CHAT_STORAGE_SCHEMA_VERSION_STORAGE_KEY];
  const currentVersion =
    typeof rawVersion === 'number' && Number.isFinite(rawVersion) ? Math.trunc(rawVersion) : 0;

  if (currentVersion >= CURRENT_CHAT_STORAGE_SCHEMA_VERSION) {
    return;
  }

  await resetIndexedDbBestEffort();
  await chrome.storage.local.remove([LEGACY_CHAT_SESSIONS_STORAGE_KEY, ACTIVE_CHAT_STORAGE_KEY]);
  await chrome.storage.local.set({
    [CHAT_STORAGE_SCHEMA_VERSION_STORAGE_KEY]: CURRENT_CHAT_STORAGE_SCHEMA_VERSION,
  });
}

async function resetIndexedDbBestEffort(): Promise<void> {
  if (typeof indexedDB === 'undefined') {
    return;
  }

  try {
    await closeChatDatabaseForTests();
  } catch {
    // Best-effort close before delete; continue even if close fails.
  }

  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(CHAT_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
