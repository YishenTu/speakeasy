import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'bun:test';
import {
  CHAT_DB_NAME,
  CHAT_SESSION_BY_EXPIRES_AT_INDEX,
  CHAT_SESSION_BY_UPDATED_AT_INDEX,
  CHAT_SESSION_STORE_NAME,
  SESSION_TTL_MS,
  closeChatDatabaseForTests,
  createChatRepository,
} from '../../src/background/chat-repository';
import { createSession } from '../../src/background/sessions';

async function deleteChatDatabase(): Promise<void> {
  await closeChatDatabaseForTests();

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(CHAT_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('Failed to delete test chat database.'));
    request.onblocked = () => reject(new Error('Failed to delete test chat database (blocked).'));
  });
}

async function insertRawSessionRecord(record: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const openRequest = indexedDB.open(CHAT_DB_NAME, 1);
    openRequest.onupgradeneeded = () => {
      const database = openRequest.result;
      const store = database.objectStoreNames.contains(CHAT_SESSION_STORE_NAME)
        ? openRequest.transaction?.objectStore(CHAT_SESSION_STORE_NAME)
        : database.createObjectStore(CHAT_SESSION_STORE_NAME, { keyPath: 'id' });

      if (!store) {
        throw new Error('Failed to initialize test chat session store.');
      }

      if (!store.indexNames.contains(CHAT_SESSION_BY_EXPIRES_AT_INDEX)) {
        store.createIndex(CHAT_SESSION_BY_EXPIRES_AT_INDEX, 'expiresAtMs');
      }
      if (!store.indexNames.contains(CHAT_SESSION_BY_UPDATED_AT_INDEX)) {
        store.createIndex(CHAT_SESSION_BY_UPDATED_AT_INDEX, 'updatedAtMs');
      }
    };
    openRequest.onerror = () => reject(new Error('Failed to open test chat database.'));
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      const transaction = database.transaction(CHAT_SESSION_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(CHAT_SESSION_STORE_NAME);
      const putRequest = store.put(record as Record<string, unknown>);
      putRequest.onerror = () => reject(new Error('Failed to insert raw session record.'));
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(new Error('Failed to commit raw session insert.'));
      transaction.onabort = () => reject(new Error('Failed to commit raw session insert.'));
    };
  });
}

describe('chat repository', () => {
  beforeEach(async () => {
    await deleteChatDatabase();
  });

  it('supports CRUD session operations', async () => {
    const repository = createChatRepository();
    const session = createSession();
    session.contents.push({
      role: 'user',
      parts: [{ text: 'hello' }],
    });

    await repository.upsertSession(session, Date.UTC(2025, 0, 1));
    const stored = await repository.getSession(session.id);
    expect(stored).toBeDefined();
    expect(stored?.id).toBe(session.id);
    expect(stored?.contents).toEqual(session.contents);

    const deleted = await repository.deleteSession(session.id);
    expect(deleted).toBe(true);
    expect(await repository.getSession(session.id)).toBeNull();
  });

  it('lists sessions in descending updated order', async () => {
    const repository = createChatRepository();
    const older = createSession();
    older.id = 'chat-older';
    older.updatedAt = new Date(Date.UTC(2025, 0, 1, 0, 0, 0)).toISOString();
    const newer = createSession();
    newer.id = 'chat-newer';
    newer.updatedAt = new Date(Date.UTC(2025, 0, 1, 0, 1, 0)).toISOString();

    await repository.upsertSession(older, Date.UTC(2025, 0, 1, 0, 0, 0));
    await repository.upsertSession(newer, Date.UTC(2025, 0, 1, 0, 1, 0));

    const sessions = await repository.listSessions();
    expect(sessions.map((session) => session.id)).toEqual(['chat-newer', 'chat-older']);
  });

  it('prunes sessions by TTL expiration time', async () => {
    const repository = createChatRepository();
    const session = createSession();
    const nowMs = Date.UTC(2025, 0, 1, 12, 0, 0);

    await repository.upsertSession(session, nowMs);
    expect(await repository.pruneExpiredSessions(nowMs + SESSION_TTL_MS - 1)).toBe(0);
    expect(await repository.getSession(session.id)).toBeDefined();

    expect(await repository.pruneExpiredSessions(nowMs + SESSION_TTL_MS)).toBe(1);
    expect(await repository.getSession(session.id)).toBeNull();
  });

  it('keeps lastInteractionId for continuation token round-trip', async () => {
    const repository = createChatRepository();
    const session = createSession();
    session.lastInteractionId = 'interaction-abc';
    session.contents.push({
      role: 'user',
      parts: [{ text: 'continue' }],
    });

    await repository.upsertSession(session, Date.UTC(2025, 0, 1));
    const stored = await repository.getSession(session.id);

    expect(stored?.lastInteractionId).toBe('interaction-abc');
  });

  it('backfills missing content ids during persistence round-trip', async () => {
    const repository = createChatRepository();
    const session = createSession();
    session.contents = [
      {
        role: 'user',
        parts: [{ text: 'hello' }],
      },
      {
        role: 'model',
        parts: [{ text: 'world' }],
      },
    ];

    await repository.upsertSession(session, Date.UTC(2025, 0, 1));
    const stored = await repository.getSession(session.id);
    expect(stored).toBeDefined();
    expect(stored?.contents).toHaveLength(2);
    for (const content of stored?.contents ?? []) {
      expect(typeof content.id).toBe('string');
      expect((content.id ?? '').length).toBeGreaterThan(0);
    }
  });

  it('round-trips branch lineage fields', async () => {
    const repository = createChatRepository();
    const session = createSession();
    session.parentChatId = 'chat-parent';
    session.rootChatId = 'chat-root';
    session.forkedFromInteractionId = 'interaction-123';
    session.forkedAt = '2025-01-01T01:02:03.000Z';
    session.contents.push({
      id: 'user-1',
      role: 'user',
      parts: [{ text: 'hello' }],
    });

    await repository.upsertSession(session, Date.UTC(2025, 0, 1));
    const stored = await repository.getSession(session.id);
    expect(stored).toBeDefined();
    expect(stored?.parentChatId).toBe('chat-parent');
    expect(stored?.rootChatId).toBe('chat-root');
    expect(stored?.forkedFromInteractionId).toBe('interaction-123');
    expect(stored?.forkedAt).toBe('2025-01-01T01:02:03.000Z');
  });

  it('round-trips persisted session titles', async () => {
    const repository = createChatRepository();
    const session = createSession();
    session.title = 'Sprint Retro Notes';
    session.contents.push({
      role: 'user',
      parts: [{ text: 'Let us capture retro action items' }],
    });

    await repository.upsertSession(session, Date.UTC(2025, 0, 1));
    const stored = await repository.getSession(session.id);

    expect(stored?.title).toBe('Sprint Retro Notes');
  });

  it('ignores blank persisted titles when parsing sessions', async () => {
    const nowIso = new Date(Date.UTC(2025, 0, 1)).toISOString();
    await insertRawSessionRecord({
      id: 'blank-title-session',
      title: '   ',
      createdAt: nowIso,
      updatedAt: nowIso,
      updatedAtMs: Date.UTC(2025, 0, 1),
      expiresAtMs: Date.UTC(2025, 0, 1) + SESSION_TTL_MS,
      contents: [{ role: 'model', parts: [{ text: 'valid reply' }] }],
    });

    const repository = createChatRepository();
    const stored = await repository.getSession('blank-title-session');
    expect(stored?.title).toBeUndefined();
  });

  it('skips malformed persisted content entries', async () => {
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    const nowIso = new Date(Date.UTC(2025, 0, 1)).toISOString();
    try {
      await insertRawSessionRecord({
        id: 'malformed-session',
        createdAt: nowIso,
        updatedAt: nowIso,
        updatedAtMs: Date.UTC(2025, 0, 1),
        expiresAtMs: Date.UTC(2025, 0, 1) + SESSION_TTL_MS,
        lastInteractionId: 'interaction-123',
        contents: [
          { role: 'model', parts: [{ text: 'valid reply' }] },
          'bad-entry',
          { role: 'model', parts: [] },
        ],
      });

      const repository = createChatRepository();
      const stored = await repository.getSession('malformed-session');

      expect(stored).toBeDefined();
      expect(stored?.lastInteractionId).toBe('interaction-123');
      expect(stored?.contents).toEqual([{ role: 'model', parts: [{ text: 'valid reply' }] }]);
      expect(
        warnings.some((call) => String(call[0] ?? '').includes('Skipping malformed chat content')),
      ).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('warns when listing malformed persisted session records', async () => {
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    const nowIso = new Date(Date.UTC(2025, 0, 1)).toISOString();
    try {
      await insertRawSessionRecord({
        id: '   ',
        createdAt: nowIso,
        updatedAt: nowIso,
        updatedAtMs: Date.UTC(2025, 0, 1),
        expiresAtMs: Date.UTC(2025, 0, 1) + SESSION_TTL_MS,
        contents: [{ role: 'model', parts: [{ text: 'valid reply' }] }],
      });

      const repository = createChatRepository();
      await expect(repository.listSessions()).resolves.toEqual([]);
      expect(
        warnings.some((call) => String(call[0] ?? '').includes('Skipping malformed chat session')),
      ).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('retries database open after a transient IndexedDB open failure', async () => {
    const repository = createChatRepository();
    const idbFactory = indexedDB as unknown as { open: typeof indexedDB.open };
    const originalOpen = idbFactory.open;
    let openCallCount = 0;
    idbFactory.open = function (...args: Parameters<IDBFactory['open']>) {
      openCallCount += 1;
      if (openCallCount === 1) {
        throw new Error('transient IndexedDB open failure');
      }
      return originalOpen.apply(this, args);
    } as typeof indexedDB.open;

    try {
      await expect(repository.listSessions()).rejects.toThrow(/failed to open chat indexeddb/i);
      await expect(repository.listSessions()).resolves.toEqual([]);
      expect(openCallCount).toBe(2);
    } finally {
      idbFactory.open = originalOpen;
    }
  });
});
