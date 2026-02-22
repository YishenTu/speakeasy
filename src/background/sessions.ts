import type { ChatMessage } from '../shared/chat';
import { extractAttachments, renderContentForChat, renderThinkingSummaryForChat } from './gemini';
import type { ChatSession, GeminiContent } from './types';

export function createSession(): ChatSession {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  return {
    id,
    rootChatId: id,
    createdAt: now,
    updatedAt: now,
    contents: [],
  };
}

export function toAssistantChatMessage(content: GeminiContent): ChatMessage {
  const rendered = renderContentForChat(content).trim();
  const thinkingSummary = renderThinkingSummaryForChat(content).trim();
  const attachments = extractAttachments(content);
  const stats = content.metadata?.responseStats;
  const interactionId = content.metadata?.interactionId?.trim() || undefined;
  const sourceModel = content.metadata?.sourceModel?.trim();
  const timestamp = parseTimestamp(content.metadata?.createdAt);
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content:
      rendered ||
      (!thinkingSummary && attachments.length === 0
        ? 'Gemini returned a response with no displayable text.'
        : ''),
    ...(interactionId ? { interactionId } : {}),
    ...(thinkingSummary ? { thinkingSummary } : {}),
    ...(stats ? { stats } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(sourceModel ? { sourceModel } : {}),
    ...(timestamp ? { timestamp } : {}),
  };
}

export function mapSessionToChatMessages(session: ChatSession): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let lastAssistantInteractionId: string | undefined;

  for (const content of session.contents) {
    if (content.role === 'model') {
      const interactionId = content.metadata?.interactionId?.trim();
      if (interactionId) {
        lastAssistantInteractionId = interactionId;
      }
    }

    const text = renderContentForChat(content).trim();
    const thinkingSummary = renderThinkingSummaryForChat(content).trim();
    const attachments = extractAttachments(content);
    if (!text && !thinkingSummary && attachments.length === 0) {
      continue;
    }

    const role = content.role === 'user' ? 'user' : 'assistant';
    const stats = role === 'assistant' ? content.metadata?.responseStats : undefined;
    const interactionId =
      role === 'assistant' ? content.metadata?.interactionId?.trim() || undefined : undefined;
    const previousInteractionId = role === 'user' ? lastAssistantInteractionId : undefined;
    const sourceModel = role === 'assistant' ? content.metadata?.sourceModel?.trim() : '';
    const timestamp = parseTimestamp(content.metadata?.createdAt);
    messages.push({
      id: crypto.randomUUID(),
      role,
      content: text,
      ...(interactionId ? { interactionId } : {}),
      ...(previousInteractionId ? { previousInteractionId } : {}),
      ...(thinkingSummary ? { thinkingSummary } : {}),
      ...(stats ? { stats } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(sourceModel ? { sourceModel } : {}),
      ...(timestamp ? { timestamp } : {}),
    });
  }

  return messages;
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}
