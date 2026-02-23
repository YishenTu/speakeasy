import type { ChatMessage } from '../shared/chat';
import type { FileDataAttachmentPayload } from '../shared/runtime';

export interface OptimisticMessageFile {
  file: File;
  name: string;
  mimeType: string;
  uploadState?: 'uploading' | 'uploaded' | 'failed';
}

export function buildOptimisticUserMessage(
  text: string,
  files: readonly OptimisticMessageFile[],
  previousInteractionId?: string,
  uploadedAttachments: readonly FileDataAttachmentPayload[] = [],
): ChatMessage {
  const attachments =
    uploadedAttachments.length > 0
      ? uploadedAttachments.map((uploaded, index) => {
          const staged = files[index];
          const mimeType = uploaded.mimeType || staged?.mimeType || 'application/octet-stream';
          const name = uploaded.name || staged?.name || 'attachment';
          const isImage = mimeType.toLowerCase().startsWith('image/');
          const previewUrl = resolveUploadedPreviewUrl(uploaded, staged, isImage);
          return {
            name,
            mimeType,
            fileUri: uploaded.fileUri,
            ...(previewUrl ? { previewUrl } : {}),
          };
        })
      : files.map((staged) => {
          const isImage = staged.mimeType.toLowerCase().startsWith('image/');
          return {
            name: staged.name,
            mimeType: staged.mimeType,
            ...(isImage ? { previewUrl: URL.createObjectURL(staged.file) } : {}),
            ...(staged.uploadState ? { uploadState: staged.uploadState } : {}),
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

function resolveUploadedPreviewUrl(
  uploaded: FileDataAttachmentPayload,
  staged: OptimisticMessageFile | undefined,
  isImage: boolean,
): string | undefined {
  if (!isImage) {
    return undefined;
  }

  if (staged) {
    return URL.createObjectURL(staged.file);
  }

  return uploaded.previewDataUrl?.trim() || undefined;
}
