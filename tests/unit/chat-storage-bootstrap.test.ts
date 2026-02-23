import { beforeEach, describe, expect, it } from 'bun:test';
import {
  CURRENT_CHAT_STORAGE_SCHEMA_VERSION,
  LEGACY_CHAT_SESSIONS_STORAGE_KEY,
  bootstrapChatStorage,
} from '../../src/background/chat-storage-bootstrap';
import {
  ACTIVE_CHAT_STORAGE_KEY,
  CHAT_STORAGE_SCHEMA_VERSION_STORAGE_KEY,
  GEMINI_SETTINGS_STORAGE_KEY,
} from '../../src/shared/settings';
import { createChromeStorageLocalMock } from './helpers/chrome-mock';

const storageState: Record<string, unknown> = {};

function clearStorage(): void {
  for (const key of Object.keys(storageState)) {
    delete storageState[key];
  }
}

function installChromeStorageMock(): void {
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: createChromeStorageLocalMock(storageState),
    },
  };
}

describe('chat storage bootstrap', () => {
  beforeEach(() => {
    clearStorage();
    installChromeStorageMock();
  });

  it('resets legacy chat keys and writes schema version on first run', async () => {
    storageState[LEGACY_CHAT_SESSIONS_STORAGE_KEY] = { stale: true };
    storageState[ACTIVE_CHAT_STORAGE_KEY] = 'chat-old';

    await bootstrapChatStorage();

    expect(storageState[LEGACY_CHAT_SESSIONS_STORAGE_KEY]).toBeUndefined();
    expect(storageState[ACTIVE_CHAT_STORAGE_KEY]).toBeUndefined();
    expect(storageState[CHAT_STORAGE_SCHEMA_VERSION_STORAGE_KEY]).toBe(
      CURRENT_CHAT_STORAGE_SCHEMA_VERSION,
    );
  });

  it('preserves gemini settings while resetting chat keys', async () => {
    storageState[GEMINI_SETTINGS_STORAGE_KEY] = {
      apiKey: 'keep-me',
      model: 'gemini-3-flash-preview',
    };
    storageState[LEGACY_CHAT_SESSIONS_STORAGE_KEY] = { stale: true };
    storageState[ACTIVE_CHAT_STORAGE_KEY] = 'chat-old';

    await bootstrapChatStorage();

    expect(storageState[GEMINI_SETTINGS_STORAGE_KEY]).toEqual({
      apiKey: 'keep-me',
      model: 'gemini-3-flash-preview',
    });
  });

  it('skips reset when schema version is already current', async () => {
    storageState[CHAT_STORAGE_SCHEMA_VERSION_STORAGE_KEY] = CURRENT_CHAT_STORAGE_SCHEMA_VERSION;
    storageState[LEGACY_CHAT_SESSIONS_STORAGE_KEY] = { keep: true };
    storageState[ACTIVE_CHAT_STORAGE_KEY] = 'chat-1';

    await bootstrapChatStorage();

    expect(storageState[LEGACY_CHAT_SESSIONS_STORAGE_KEY]).toEqual({ keep: true });
    expect(storageState[ACTIVE_CHAT_STORAGE_KEY]).toBe('chat-1');
    expect(storageState[CHAT_STORAGE_SCHEMA_VERSION_STORAGE_KEY]).toBe(
      CURRENT_CHAT_STORAGE_SCHEMA_VERSION,
    );
  });
});
