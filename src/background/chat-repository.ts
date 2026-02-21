import { normalizeContent } from './gemini';
import type { ChatSession, GeminiContent } from './types';
import { isRecord } from './utils';

export const CHAT_DB_NAME = 'speakeasy-chat';
export const CHAT_DB_VERSION = 1;
export const CHAT_SESSION_STORE_NAME = 'sessions';
export const CHAT_SESSION_BY_EXPIRES_AT_INDEX = 'byExpiresAtMs';
export const CHAT_SESSION_BY_UPDATED_AT_INDEX = 'byUpdatedAtMs';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface PersistedChatSessionRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  updatedAtMs: number;
  expiresAtMs: number;
  contents: unknown[];
  lastInteractionId?: string;
}

export interface ChatRepository {
  getSession(chatId: string): Promise<ChatSession | null>;
  listSessions(): Promise<ChatSession[]>;
  upsertSession(session: ChatSession, nowMs?: number): Promise<void>;
  deleteSession(chatId: string): Promise<boolean>;
  pruneExpiredSessions(nowMs?: number): Promise<number>;
}

let databasePromise: Promise<IDBDatabase> | null = null;

export function createChatRepository(): ChatRepository {
  return {
    getSession,
    listSessions,
    upsertSession,
    deleteSession,
    pruneExpiredSessions,
  };
}

export async function closeChatDatabaseForTests(): Promise<void> {
  if (!databasePromise) {
    return;
  }

  const database = await databasePromise.catch(() => null);
  if (database) {
    database.close();
  }
  databasePromise = null;
}

async function getSession(chatId: string): Promise<ChatSession | null> {
  if (!chatId.trim()) {
    return null;
  }

  const database = await openChatDatabase();
  return new Promise<ChatSession | null>((resolve, reject) => {
    const transaction = database.transaction(CHAT_SESSION_STORE_NAME, 'readonly');
    const store = transaction.objectStore(CHAT_SESSION_STORE_NAME);
    const request = store.get(chatId);

    request.onerror = () => {
      reject(new Error('Failed to read chat session from IndexedDB.'));
    };
    request.onsuccess = () => {
      resolve(parsePersistedSessionRecord(request.result));
    };
  });
}

async function upsertSession(session: ChatSession, nowMs = Date.now()): Promise<void> {
  const database = await openChatDatabase();
  const record = toPersistedSessionRecord(session, nowMs);

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(CHAT_SESSION_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(CHAT_SESSION_STORE_NAME);
    const request = store.put(record);

    request.onerror = () => {
      reject(new Error('Failed to persist chat session to IndexedDB.'));
    };
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onabort = () => {
      reject(new Error('Failed to commit chat session transaction.'));
    };
    transaction.onerror = () => {
      reject(new Error('Failed to commit chat session transaction.'));
    };
  });
}

async function listSessions(): Promise<ChatSession[]> {
  const database = await openChatDatabase();
  return new Promise<ChatSession[]>((resolve, reject) => {
    const sessions: ChatSession[] = [];
    const transaction = database.transaction(CHAT_SESSION_STORE_NAME, 'readonly');
    const store = transaction.objectStore(CHAT_SESSION_STORE_NAME);
    const index = store.index(CHAT_SESSION_BY_UPDATED_AT_INDEX);
    const cursorRequest = index.openCursor(null, 'prev');

    cursorRequest.onerror = () => {
      reject(new Error('Failed to list chat sessions from IndexedDB.'));
    };
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        return;
      }

      const parsed = parsePersistedSessionRecord(cursor.value);
      if (parsed) {
        sessions.push(parsed);
      }

      cursor.continue();
    };
    transaction.oncomplete = () => {
      resolve(sessions);
    };
    transaction.onabort = () => {
      reject(new Error('Failed to commit chat session listing.'));
    };
    transaction.onerror = () => {
      reject(new Error('Failed to commit chat session listing.'));
    };
  });
}

async function deleteSession(chatId: string): Promise<boolean> {
  if (!chatId.trim()) {
    return false;
  }

  const existing = await getSession(chatId);
  if (!existing) {
    return false;
  }

  const database = await openChatDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(CHAT_SESSION_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(CHAT_SESSION_STORE_NAME);
    const request = store.delete(chatId);

    request.onerror = () => {
      reject(new Error('Failed to delete chat session from IndexedDB.'));
    };
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onabort = () => {
      reject(new Error('Failed to commit chat session deletion.'));
    };
    transaction.onerror = () => {
      reject(new Error('Failed to commit chat session deletion.'));
    };
  });

  return true;
}

async function pruneExpiredSessions(nowMs = Date.now()): Promise<number> {
  const database = await openChatDatabase();
  return new Promise<number>((resolve, reject) => {
    let deletedCount = 0;
    const transaction = database.transaction(CHAT_SESSION_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(CHAT_SESSION_STORE_NAME);
    const index = store.index(CHAT_SESSION_BY_EXPIRES_AT_INDEX);
    const cursorRequest = index.openCursor(IDBKeyRange.upperBound(nowMs));

    cursorRequest.onerror = () => {
      reject(new Error('Failed to iterate expired chat sessions.'));
    };
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        return;
      }

      deletedCount += 1;
      cursor.delete();
      cursor.continue();
    };
    transaction.oncomplete = () => {
      resolve(deletedCount);
    };
    transaction.onabort = () => {
      reject(new Error('Failed to commit chat session pruning.'));
    };
    transaction.onerror = () => {
      reject(new Error('Failed to commit chat session pruning.'));
    };
  });
}

async function openChatDatabase(): Promise<IDBDatabase> {
  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this runtime.'));
      return;
    }

    const request = indexedDB.open(CHAT_DB_NAME, CHAT_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(CHAT_SESSION_STORE_NAME)
        ? request.transaction?.objectStore(CHAT_SESSION_STORE_NAME)
        : database.createObjectStore(CHAT_SESSION_STORE_NAME, { keyPath: 'id' });

      if (!store) {
        throw new Error('Failed to initialize IndexedDB session store.');
      }

      if (!store.indexNames.contains(CHAT_SESSION_BY_EXPIRES_AT_INDEX)) {
        store.createIndex(CHAT_SESSION_BY_EXPIRES_AT_INDEX, 'expiresAtMs');
      }
      if (!store.indexNames.contains(CHAT_SESSION_BY_UPDATED_AT_INDEX)) {
        store.createIndex(CHAT_SESSION_BY_UPDATED_AT_INDEX, 'updatedAtMs');
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => {
      reject(new Error('Failed to open chat IndexedDB database.'));
    };
    request.onblocked = () => {
      reject(new Error('Chat IndexedDB open request was blocked.'));
    };
  });

  return databasePromise;
}

function toPersistedSessionRecord(session: ChatSession, nowMs: number): PersistedChatSessionRecord {
  const id = session.id.trim();
  if (!id) {
    throw new Error('Cannot persist chat session without an id.');
  }

  const createdAt =
    typeof session.createdAt === 'string' && session.createdAt
      ? session.createdAt
      : new Date(nowMs).toISOString();
  const updatedAt =
    typeof session.updatedAt === 'string' && session.updatedAt
      ? session.updatedAt
      : new Date(nowMs).toISOString();
  const parsedUpdatedAtMs = Date.parse(updatedAt);
  const updatedAtMs = Number.isFinite(parsedUpdatedAtMs) ? parsedUpdatedAtMs : nowMs;
  const expiresAtMs = nowMs + SESSION_TTL_MS;

  const contents = session.contents.map((content) => ({
    role: content.role === 'user' ? 'user' : 'model',
    parts: content.parts.map((part) => ({ ...part })),
  }));
  const lastInteractionId =
    typeof session.lastInteractionId === 'string' && session.lastInteractionId.trim()
      ? session.lastInteractionId.trim()
      : undefined;

  return {
    id,
    createdAt,
    updatedAt,
    updatedAtMs,
    expiresAtMs,
    contents,
    ...(lastInteractionId ? { lastInteractionId } : {}),
  };
}

function parsePersistedSessionRecord(rawValue: unknown): ChatSession | null {
  if (!isRecord(rawValue)) {
    return null;
  }

  const id = typeof rawValue.id === 'string' && rawValue.id.trim() ? rawValue.id.trim() : '';
  if (!id) {
    return null;
  }

  const createdAt =
    typeof rawValue.createdAt === 'string' && rawValue.createdAt
      ? rawValue.createdAt
      : new Date().toISOString();
  const updatedAt =
    typeof rawValue.updatedAt === 'string' && rawValue.updatedAt ? rawValue.updatedAt : createdAt;
  const rawContents = Array.isArray(rawValue.contents) ? rawValue.contents : [];

  const contents: GeminiContent[] = [];
  for (const rawContent of rawContents) {
    try {
      contents.push(normalizeContent(rawContent));
    } catch {
      // Skip malformed entries to keep storage resilient to schema changes.
    }
  }

  const lastInteractionId =
    typeof rawValue.lastInteractionId === 'string' && rawValue.lastInteractionId.trim()
      ? rawValue.lastInteractionId.trim()
      : undefined;

  return {
    id,
    createdAt,
    updatedAt,
    contents,
    ...(lastInteractionId ? { lastInteractionId } : {}),
  };
}
