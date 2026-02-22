import type { ChatMessage } from '../shared/chat';

export interface OptimisticMessageFile {
  file: File;
  name: string;
  mimeType: string;
}

export function buildOptimisticUserMessage(
  text: string,
  files: readonly OptimisticMessageFile[],
  previousInteractionId?: string,
): ChatMessage {
  const attachments = files.map((staged) => {
    const isImage = staged.mimeType.toLowerCase().startsWith('image/');
    return {
      name: staged.name,
      mimeType: staged.mimeType,
      ...(isImage ? { previewUrl: URL.createObjectURL(staged.file) } : {}),
    };
  });
  const normalizedPreviousInteractionId = normalizeInteractionId(previousInteractionId);

  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: text,
    ...(normalizedPreviousInteractionId
      ? { previousInteractionId: normalizedPreviousInteractionId }
      : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

export function findLatestAssistantInteractionId(
  messages: readonly ChatMessage[],
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'assistant') {
      continue;
    }

    const normalizedInteractionId = normalizeInteractionId(message.interactionId);
    if (normalizedInteractionId) {
      return normalizedInteractionId;
    }
  }

  return undefined;
}

function normalizeInteractionId(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}
