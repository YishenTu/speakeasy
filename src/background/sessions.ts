import type { ChatMessage } from '../shared/chat';
import { extractAttachments, normalizeContent, renderContentForChat } from './gemini';
import type { ChatSession, GeminiContent } from './types';
import { isRecord } from './utils';

const CHAT_SESSIONS_STORAGE_KEY = 'chatSessions';
const MAX_SESSION_COUNT = 25;

export function createSession(): ChatSession {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    contents: [],
  };
}

export function getOrCreateSession(
  sessions: Record<string, ChatSession>,
  chatId: string | undefined,
): ChatSession {
  if (chatId && sessions[chatId]) {
    return sessions[chatId];
  }

  const session = createSession();
  sessions[session.id] = session;
  return session;
}

export async function readSessions(): Promise<Record<string, ChatSession>> {
  const stored = await chrome.storage.local.get(CHAT_SESSIONS_STORAGE_KEY);
  const raw = stored[CHAT_SESSIONS_STORAGE_KEY];

  if (!isRecord(raw)) {
    return {};
  }

  const sessions: Record<string, ChatSession> = {};
  for (const [id, value] of Object.entries(raw)) {
    const parsed = parseSession(id, value);
    if (parsed) {
      sessions[id] = parsed;
    }
  }

  return sessions;
}

export async function writeSessions(sessions: Record<string, ChatSession>): Promise<void> {
  const entries = Object.values(sessions).sort((left, right) =>
    left.updatedAt < right.updatedAt ? 1 : -1,
  );

  const bounded = entries.slice(0, MAX_SESSION_COUNT);
  const nextStore: Record<string, ChatSession> = {};
  for (const session of bounded) {
    nextStore[session.id] = session;
  }

  await chrome.storage.local.set({
    [CHAT_SESSIONS_STORAGE_KEY]: nextStore,
  });
}

export function toAssistantChatMessage(content: GeminiContent): ChatMessage {
  const rendered = renderContentForChat(content).trim();
  const attachments = extractAttachments(content);
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content:
      rendered ||
      (attachments.length === 0 ? 'Gemini returned a response with no displayable text.' : ''),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

export function mapSessionToChatMessages(session: ChatSession): ChatMessage[] {
  const messages: ChatMessage[] = [];

  for (const content of session.contents) {
    const text = renderContentForChat(content).trim();
    const attachments = extractAttachments(content);
    if (!text && attachments.length === 0) {
      continue;
    }

    const role = content.role === 'user' ? 'user' : 'assistant';
    messages.push({
      id: crypto.randomUUID(),
      role,
      content: text,
      ...(attachments.length > 0 ? { attachments } : {}),
    });
  }

  return messages;
}

function parseSession(expectedId: string, value: unknown): ChatSession | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === 'string' && value.id ? value.id : expectedId;
  const createdAt =
    typeof value.createdAt === 'string' && value.createdAt
      ? value.createdAt
      : new Date().toISOString();
  const updatedAt =
    typeof value.updatedAt === 'string' && value.updatedAt ? value.updatedAt : createdAt;
  const lastInteractionId =
    typeof value.lastInteractionId === 'string' && value.lastInteractionId
      ? value.lastInteractionId
      : undefined;
  const rawContents = Array.isArray(value.contents) ? value.contents : [];

  const contents: GeminiContent[] = [];
  for (const rawContent of rawContents) {
    try {
      contents.push(normalizeContent(rawContent));
    } catch {
      // Skip malformed entries to keep storage resilient to schema changes.
    }
  }

  return {
    id,
    createdAt,
    updatedAt,
    contents,
    ...(lastInteractionId ? { lastInteractionId } : {}),
  };
}
