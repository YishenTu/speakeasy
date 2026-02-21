import type { ChatMessage } from '../shared/chat';
import { extractAttachments, renderContentForChat } from './gemini';
import type { ChatSession, GeminiContent } from './types';

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
