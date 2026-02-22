import { normalizeContent } from './gemini';
import { ensureBranchTree, rebuildActiveBranchSnapshot } from './sessions';
import type { ChatBranchNode, ChatSession, GeminiContent } from './types';
import { isRecord } from './utils';

export const CHAT_DB_NAME = 'speakeasy-chat';
const CHAT_DB_VERSION = 2;
export const CHAT_SESSION_STORE_NAME = 'sessions';
export const CHAT_SESSION_BY_EXPIRES_AT_INDEX = 'byExpiresAtMs';
export const CHAT_SESSION_BY_UPDATED_AT_INDEX = 'byUpdatedAtMs';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface PersistedChatSessionRecord {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  updatedAtMs: number;
  expiresAtMs: number;
  contents: unknown[];
  lastInteractionId?: string;
  branchTree?: PersistedChatBranchTreeRecord;
}

interface PersistedChatBranchTreeRecord {
  rootNodeId: string;
  activeLeafNodeId: string;
  nodes: PersistedChatBranchNodeRecord[] | Record<string, PersistedChatBranchNodeRecord>;
}

type PersistedChatBranchNodeRecord = Omit<ChatBranchNode, 'content'> & { content?: unknown };

export interface ChatRepository {
  getSession(chatId: string): Promise<ChatSession | null>;
  listSessions(): Promise<ChatSession[]>;
  upsertSession(session: ChatSession, nowMs?: number): Promise<void>;
  deleteSession(chatId: string): Promise<boolean>;
  pruneExpiredSessions(nowMs?: number): Promise<number>;
}

// Shared singleton connection for the background worker runtime.
let databasePromise: Promise<IDBDatabase> | null = null;
let consecutiveOpenFailureCount = 0;
let nextOpenRetryAtMs = 0;
const OPEN_RETRY_INITIAL_BACKOFF_MS = 500;
const OPEN_RETRY_MAX_BACKOFF_MS = 30_000;

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
    consecutiveOpenFailureCount = 0;
    nextOpenRetryAtMs = 0;
    return;
  }

  const database = await databasePromise.catch(() => null);
  if (database) {
    database.close();
  }
  databasePromise = null;
  consecutiveOpenFailureCount = 0;
  nextOpenRetryAtMs = 0;
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
      } else {
        console.warn('Skipping malformed chat session while listing history.', cursor.value);
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

  const nowMs = Date.now();
  if (nowMs < nextOpenRetryAtMs) {
    throw new Error('IndexedDB open is temporarily throttled after repeated failures.');
  }

  const openingPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const rejectOpen = (message: string, cause?: unknown): void => {
      reject(cause ? new Error(message, { cause }) : new Error(message));
    };

    if (typeof indexedDB === 'undefined') {
      rejectOpen('IndexedDB is not available in this runtime.');
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(CHAT_DB_NAME, CHAT_DB_VERSION);
    } catch (error: unknown) {
      rejectOpen('Failed to open chat IndexedDB database.', error);
      return;
    }

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
      consecutiveOpenFailureCount = 0;
      nextOpenRetryAtMs = 0;
      resolve(database);
    };
    request.onerror = () => {
      rejectOpen('Failed to open chat IndexedDB database.', request.error);
    };
    request.onblocked = () => {
      rejectOpen('Chat IndexedDB open request was blocked.');
    };
  });

  databasePromise = openingPromise;
  openingPromise.catch(() => {
    if (databasePromise === openingPromise) {
      databasePromise = null;
    }

    consecutiveOpenFailureCount += 1;
    const backoffMs = getOpenRetryBackoffMs(consecutiveOpenFailureCount);
    nextOpenRetryAtMs = backoffMs > 0 ? Date.now() + backoffMs : 0;
  });

  return openingPromise;
}

function getOpenRetryBackoffMs(consecutiveFailureCount: number): number {
  if (consecutiveFailureCount < 2) {
    return 0;
  }

  const exponent = consecutiveFailureCount - 2;
  return Math.min(OPEN_RETRY_INITIAL_BACKOFF_MS * 2 ** exponent, OPEN_RETRY_MAX_BACKOFF_MS);
}

function toPersistedSessionRecord(session: ChatSession, nowMs: number): PersistedChatSessionRecord {
  const id = session.id.trim();
  if (!id) {
    throw new Error('Cannot persist chat session without an id.');
  }

  const preservedLastInteractionId =
    typeof session.lastInteractionId === 'string' ? session.lastInteractionId.trim() : '';

  if (
    session.branchTree &&
    session.contents.length > 0 &&
    !branchTreeHasContentNodes(session.branchTree)
  ) {
    Reflect.deleteProperty(session, 'branchTree');
  }

  ensureBranchTree(session);
  if (session.branchTree) {
    ensureBranchTreeContentIds(session.branchTree);
  }
  rebuildActiveBranchSnapshot(session);
  if (!session.lastInteractionId && preservedLastInteractionId) {
    session.lastInteractionId = preservedLastInteractionId;
  }
  const title = session.title?.trim() || undefined;

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
    id: ensurePersistedContentId(content),
    role: content.role === 'user' ? 'user' : 'model',
    parts: content.parts.map((part) => ({ ...part })),
    ...(content.metadata ? { metadata: structuredClone(content.metadata) } : {}),
  }));
  const trimmedLastInteractionId =
    typeof session.lastInteractionId === 'string' ? session.lastInteractionId.trim() : '';
  const lastInteractionId = trimmedLastInteractionId || undefined;
  const branchTree = session.branchTree ? toPersistedBranchTreeRecord(session) : undefined;

  return {
    id,
    ...(title ? { title } : {}),
    createdAt,
    updatedAt,
    updatedAtMs,
    expiresAtMs,
    contents,
    ...(lastInteractionId ? { lastInteractionId } : {}),
    ...(branchTree ? { branchTree } : {}),
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
    } catch (error: unknown) {
      // Keep storage resilient to schema drift while preserving observability for field debugging.
      console.warn('Skipping malformed chat content while parsing persisted session.', {
        rawContent,
        error,
      });
    }
  }

  const trimmedLastInteractionId =
    typeof rawValue.lastInteractionId === 'string' ? rawValue.lastInteractionId.trim() : '';
  const lastInteractionId = trimmedLastInteractionId || undefined;
  const trimmedTitle = typeof rawValue.title === 'string' ? rawValue.title.trim() : '';
  const title = trimmedTitle || undefined;
  const parsedBranchTree = parsePersistedBranchTreeRecord(rawValue.branchTree);
  const effectiveBranchTree =
    parsedBranchTree && (contents.length === 0 || branchTreeHasContentNodes(parsedBranchTree))
      ? parsedBranchTree
      : undefined;

  const session: ChatSession = {
    id,
    ...(title ? { title } : {}),
    createdAt,
    updatedAt,
    contents,
    ...(effectiveBranchTree ? { branchTree: effectiveBranchTree } : {}),
    ...(lastInteractionId ? { lastInteractionId } : {}),
  };

  const tree = ensureBranchTree(session);
  if (effectiveBranchTree) {
    ensureBranchTreeContentIds(tree);
    rebuildActiveBranchSnapshot(session);
    if (!session.lastInteractionId && lastInteractionId) {
      session.lastInteractionId = lastInteractionId;
    }
  }
  return session;
}

function ensurePersistedContentId(content: GeminiContent): string {
  const existing = typeof content.id === 'string' ? content.id.trim() : '';
  if (existing) {
    content.id = existing;
    return existing;
  }

  const generated = crypto.randomUUID();
  content.id = generated;
  return generated;
}

function toPersistedBranchTreeRecord(session: ChatSession): PersistedChatBranchTreeRecord {
  const tree = ensureBranchTree(session);
  const nodes: Record<string, PersistedChatBranchNodeRecord> = {};

  for (const node of Object.values(tree.nodes)) {
    const nodeId = node.id.trim();
    if (!nodeId) {
      continue;
    }

    const parentNodeId = node.parentNodeId?.trim();
    const childNodeIds = node.childNodeIds
      .map((childNodeId) => childNodeId.trim())
      .filter((childNodeId) => childNodeId.length > 0);
    const persistedNode: PersistedChatBranchNodeRecord = {
      id: nodeId,
      childNodeIds,
    };
    if (parentNodeId) {
      persistedNode.parentNodeId = parentNodeId;
    }
    if (node.content) {
      persistedNode.content = {
        id: ensurePersistedContentId(node.content),
        role: node.content.role === 'user' ? 'user' : 'model',
        parts: node.content.parts.map((part) => ({ ...part })),
        ...(node.content.metadata ? { metadata: structuredClone(node.content.metadata) } : {}),
      };
    }
    nodes[nodeId] = persistedNode;
  }

  return {
    rootNodeId: tree.rootNodeId,
    activeLeafNodeId: tree.activeLeafNodeId,
    nodes,
  };
}

function parsePersistedBranchTreeRecord(rawValue: unknown): ChatSession['branchTree'] {
  if (!isRecord(rawValue)) {
    return undefined;
  }

  const rootNodeId =
    typeof rawValue.rootNodeId === 'string' && rawValue.rootNodeId.trim()
      ? rawValue.rootNodeId.trim()
      : '';
  const activeLeafNodeId =
    typeof rawValue.activeLeafNodeId === 'string' && rawValue.activeLeafNodeId.trim()
      ? rawValue.activeLeafNodeId.trim()
      : '';
  if (!rootNodeId || !activeLeafNodeId) {
    return undefined;
  }

  const rawNodes = Array.isArray(rawValue.nodes)
    ? rawValue.nodes
    : isRecord(rawValue.nodes)
      ? Object.values(rawValue.nodes)
      : [];
  const nodes: NonNullable<ChatSession['branchTree']>['nodes'] = {};
  for (const rawNode of rawNodes) {
    if (!isRecord(rawNode)) {
      continue;
    }

    const nodeId = typeof rawNode.id === 'string' ? rawNode.id.trim() : '';
    if (!nodeId) {
      continue;
    }

    const parentNodeId =
      typeof rawNode.parentNodeId === 'string' && rawNode.parentNodeId.trim()
        ? rawNode.parentNodeId.trim()
        : undefined;
    const childNodeIds = Array.isArray(rawNode.childNodeIds)
      ? rawNode.childNodeIds
          .filter((childNodeId): childNodeId is string => typeof childNodeId === 'string')
          .map((childNodeId) => childNodeId.trim())
          .filter((childNodeId) => childNodeId.length > 0)
      : [];
    let content: GeminiContent | undefined;
    if ('content' in rawNode) {
      try {
        content = normalizeContent(rawNode.content);
      } catch (error: unknown) {
        console.warn('Skipping malformed branch node content while parsing persisted session.', {
          rawNode,
          error,
        });
      }
    }

    nodes[nodeId] = {
      id: nodeId,
      ...(parentNodeId ? { parentNodeId } : {}),
      childNodeIds,
      ...(content ? { content } : {}),
    };
  }

  return {
    rootNodeId,
    activeLeafNodeId,
    nodes,
  };
}

function branchTreeHasContentNodes(tree: NonNullable<ChatSession['branchTree']>): boolean {
  return Object.values(tree.nodes).some((node) => !!node.content);
}

function ensureBranchTreeContentIds(tree: NonNullable<ChatSession['branchTree']>): void {
  for (const node of Object.values(tree.nodes)) {
    if (node.content) {
      ensurePersistedContentId(node.content);
    }
  }
}
