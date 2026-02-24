import type {
  ChatDeletePayload,
  ChatListPayload,
  ChatLoadPayload,
  ChatNewPayload,
  ChatSessionSummary,
  ChatTabContextPayload,
} from '../../../../shared/runtime';
import { createSession, mapSessionToChatMessages } from '../../session/sessions';
import type { ChatSession } from '../../session/types';
import { pruneExpiredSessionsBestEffort } from '../bootstrap';
import type { RuntimeDependencies, RuntimeRequestContext } from '../contracts';

export async function handleLoadChat(
  chatId: string | undefined,
  dependencies: RuntimeDependencies,
): Promise<ChatLoadPayload> {
  if (!chatId) {
    return {
      chatId: null,
      messages: [],
    };
  }

  const session = await dependencies.repository.getSession(chatId);
  if (!session) {
    return {
      chatId: null,
      messages: [],
    };
  }

  return {
    chatId: session.id,
    messages: mapSessionToChatMessages(session),
  };
}

export async function handleNewChat(dependencies: RuntimeDependencies): Promise<ChatNewPayload> {
  const session = createSession();
  const now = dependencies.now();
  await dependencies.repository.upsertSession(session, now.getTime());
  await pruneExpiredSessionsBestEffort(dependencies, now.getTime());
  return {
    chatId: session.id,
  };
}

export async function handleDeleteChat(
  chatId: string,
  dependencies: RuntimeDependencies,
): Promise<ChatDeletePayload> {
  const deleted = await dependencies.repository.deleteSession(chatId);
  await pruneExpiredSessionsBestEffort(dependencies, dependencies.now().getTime());

  return {
    deleted,
    chatId: null,
  };
}

export async function handleListChats(dependencies: RuntimeDependencies): Promise<ChatListPayload> {
  const nowMs = dependencies.now().getTime();
  await pruneExpiredSessionsBestEffort(dependencies, nowMs);
  const sessions = await dependencies.repository.listSessions();
  const summaries: ChatSessionSummary[] = sessions.map((session) => ({
    chatId: session.id,
    title: summarizeSessionTitle(session),
    updatedAt: session.updatedAt,
  }));

  return {
    sessions: summaries,
  };
}

export function handleGetChatTabContext(context?: RuntimeRequestContext): ChatTabContextPayload {
  const tabId = context?.sender?.tab?.id;
  if (typeof tabId !== 'number' || !Number.isInteger(tabId) || tabId <= 0) {
    return { tabId: null };
  }

  return { tabId };
}

function summarizeSessionTitle(session: ChatSession): string {
  const title = session.title?.trim();
  if (title) {
    return title;
  }

  const latestUserText = findLatestContentText(session, 'user');
  if (latestUserText) {
    return truncateForLabel(latestUserText, 48);
  }

  const latestAssistantText = findLatestContentText(session, 'model');
  if (latestAssistantText) {
    return truncateForLabel(latestAssistantText, 48);
  }

  const timestamp = session.updatedAt.replace('T', ' ').slice(0, 16);
  return `Chat ${timestamp || session.id.slice(0, 8)}`;
}

function findLatestContentText(session: ChatSession, role: 'user' | 'model'): string {
  for (let index = session.contents.length - 1; index >= 0; index -= 1) {
    const content = session.contents[index];
    if (!content || content.role !== role) {
      continue;
    }

    for (const part of content.parts) {
      const text = typeof part.text === 'string' ? part.text.trim() : '';
      if (text) {
        return text;
      }
    }
  }

  return '';
}

function truncateForLabel(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}
