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
} from '../../src/background/features/chat-storage/chat-repository';
import { createSession } from '../../src/background/features/session/sessions';

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

  it('returns null or false for blank and unknown chat ids', async () => {
    const repository = createChatRepository();

    await expect(repository.getSession('   ')).resolves.toBeNull();
    await expect(repository.deleteSession('   ')).resolves.toBe(false);
    await expect(repository.deleteSession('missing-chat-id')).resolves.toBe(false);
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

  it('round-trips branch tree fields', async () => {
    const repository = createChatRepository();
    const session = createSession();
    const rootNodeId = session.branchTree?.rootNodeId ?? '';
    session.contents = [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ text: 'hello' }],
      },
      {
        id: 'model-1',
        role: 'model',
        parts: [{ text: 'world' }],
        metadata: { interactionId: 'interaction-123' },
      },
    ];
    session.branchTree = {
      rootNodeId,
      activeLeafNodeId: 'model-node-1',
      nodes: {
        [rootNodeId]: {
          id: rootNodeId,
          childNodeIds: ['user-node-1'],
        },
        'user-node-1': {
          id: 'user-node-1',
          parentNodeId: rootNodeId,
          childNodeIds: ['model-node-1'],
          content: {
            id: 'user-1',
            role: 'user',
            parts: [{ text: 'hello' }],
          },
        },
        'model-node-1': {
          id: 'model-node-1',
          parentNodeId: 'user-node-1',
          childNodeIds: [],
          content: {
            id: 'model-1',
            role: 'model',
            parts: [{ text: 'world' }],
            metadata: { interactionId: 'interaction-123' },
          },
        },
      },
    };
    session.lastInteractionId = 'interaction-123';

    await repository.upsertSession(session, Date.UTC(2025, 0, 1));
    const stored = await repository.getSession(session.id);
    expect(stored).toBeDefined();
    expect(stored?.branchTree?.rootNodeId).toBe(rootNodeId);
    expect(stored?.branchTree?.activeLeafNodeId).toBe('model-node-1');
    expect(stored?.branchTree?.nodes['user-node-1']?.content?.role).toBe('user');
    expect(stored?.branchTree?.nodes['model-node-1']?.content?.metadata?.interactionId).toBe(
      'interaction-123',
    );
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

  it('rejects when IndexedDB is unavailable in the runtime', async () => {
    const originalIndexedDb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    (globalThis as { indexedDB?: IDBFactory }).indexedDB = undefined;

    try {
      const repository = createChatRepository();
      await expect(repository.listSessions()).rejects.toThrow(/indexeddb is not available/i);
    } finally {
      (globalThis as { indexedDB?: IDBFactory }).indexedDB = originalIndexedDb;
    }
  });

  it('rejects when open requests are blocked', async () => {
    const repository = createChatRepository();
    const idbFactory = indexedDB as unknown as { open: typeof indexedDB.open };
    const originalOpen = idbFactory.open;
    idbFactory.open = (() => {
      const request = {} as IDBOpenDBRequest;
      queueMicrotask(() => {
        request.onblocked?.(new Event('blocked'));
      });
      return request;
    }) as typeof indexedDB.open;

    try {
      await expect(repository.listSessions()).rejects.toThrow(/open request was blocked/i);
    } finally {
      idbFactory.open = originalOpen;
    }
  });

  it('reopens the database after versionchange closes the active connection', async () => {
    const repository = createChatRepository();
    const idbFactory = indexedDB as unknown as { open: typeof indexedDB.open };
    const originalOpen = idbFactory.open;
    let openCallCount = 0;
    let latestRequest: IDBOpenDBRequest | null = null;

    idbFactory.open = function (...args: Parameters<IDBFactory['open']>) {
      openCallCount += 1;
      const request = originalOpen.apply(this, args);
      latestRequest = request;
      return request;
    } as typeof indexedDB.open;

    try {
      await expect(repository.listSessions()).resolves.toEqual([]);
      expect(openCallCount).toBe(1);
      const database = latestRequest?.result;
      if (!database) {
        throw new Error('Expected an opened IndexedDB database.');
      }

      database.onversionchange?.(new Event('versionchange'));

      await expect(repository.listSessions()).resolves.toEqual([]);
      expect(openCallCount).toBe(2);
    } finally {
      idbFactory.open = originalOpen;
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

  it('throttles repeated open attempts after consecutive IndexedDB failures', async () => {
    const repository = createChatRepository();
    const idbFactory = indexedDB as unknown as { open: typeof indexedDB.open };
    const originalOpen = idbFactory.open;
    const originalNow = Date.now;
    let openCallCount = 0;
    let nowMs = Date.UTC(2025, 0, 1, 0, 0, 0);
    Date.now = () => nowMs;
    idbFactory.open = (() => {
      openCallCount += 1;
      throw new Error('persistent IndexedDB open failure');
    }) as typeof indexedDB.open;

    try {
      await expect(repository.listSessions()).rejects.toThrow(/failed to open chat indexeddb/i);
      await expect(repository.listSessions()).rejects.toThrow(/failed to open chat indexeddb/i);
      await expect(repository.listSessions()).rejects.toThrow(/temporarily throttled/i);
      expect(openCallCount).toBe(2);

      nowMs += 500;
      await expect(repository.listSessions()).rejects.toThrow(/failed to open chat indexeddb/i);
      expect(openCallCount).toBe(3);
    } finally {
      Date.now = originalNow;
      idbFactory.open = originalOpen;
    }
  });

  it('rebuilds active branch snapshot before persistence to avoid tree/content divergence', async () => {
    const repository = createChatRepository();
    const session = createSession();
    const rootNodeId = session.branchTree?.rootNodeId ?? '';
    session.branchTree = {
      rootNodeId,
      activeLeafNodeId: 'model-node',
      nodes: {
        [rootNodeId]: {
          id: rootNodeId,
          childNodeIds: ['user-node'],
        },
        'user-node': {
          id: 'user-node',
          parentNodeId: rootNodeId,
          childNodeIds: ['model-node'],
          content: {
            id: 'user-content',
            role: 'user',
            parts: [{ text: 'Question' }],
          },
        },
        'model-node': {
          id: 'model-node',
          parentNodeId: 'user-node',
          childNodeIds: [],
          content: {
            id: 'model-content',
            role: 'model',
            parts: [{ text: 'Answer' }],
            metadata: { interactionId: 'interaction-1' },
          },
        },
      },
    };
    session.contents = [{ id: 'stale-content', role: 'model', parts: [{ text: 'stale' }] }];
    session.lastInteractionId = undefined;

    await repository.upsertSession(session, Date.UTC(2025, 0, 1));
    const stored = await repository.getSession(session.id);

    expect(stored?.contents.map((content) => content.id)).toEqual([
      'user-content',
      'model-content',
    ]);
    expect(stored?.lastInteractionId).toBe('interaction-1');
  });

  it('parses legacy array-based persisted branch nodes and realigns active contents', async () => {
    const nowIso = new Date(Date.UTC(2025, 0, 1)).toISOString();
    await insertRawSessionRecord({
      id: 'legacy-array-branch',
      createdAt: nowIso,
      updatedAt: nowIso,
      updatedAtMs: Date.UTC(2025, 0, 1),
      expiresAtMs: Date.UTC(2025, 0, 1) + SESSION_TTL_MS,
      contents: [{ id: 'stale', role: 'model', parts: [{ text: 'stale' }] }],
      branchTree: {
        rootNodeId: 'root-node',
        activeLeafNodeId: 'model-node',
        nodes: [
          { id: 'root-node', childNodeIds: ['user-node'] },
          {
            id: 'user-node',
            parentNodeId: 'root-node',
            childNodeIds: ['model-node'],
            content: {
              id: 'user-content',
              role: 'user',
              parts: [{ text: 'Question' }],
            },
          },
          {
            id: 'model-node',
            parentNodeId: 'user-node',
            childNodeIds: [],
            content: {
              id: 'model-content',
              role: 'model',
              parts: [{ text: 'Answer' }],
              metadata: { interactionId: 'interaction-legacy' },
            },
          },
        ],
      },
    });

    const repository = createChatRepository();
    const stored = await repository.getSession('legacy-array-branch');
    expect(stored?.branchTree?.nodes['model-node']?.content?.metadata?.interactionId).toBe(
      'interaction-legacy',
    );
    expect(stored?.contents.map((content) => content.id)).toEqual([
      'user-content',
      'model-content',
    ]);
    expect(stored?.lastInteractionId).toBe('interaction-legacy');
  });
});
