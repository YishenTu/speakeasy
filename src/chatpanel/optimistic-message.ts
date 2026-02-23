import type { ChatMessage } from '../shared/chat';
import type { FileDataAttachmentPayload } from '../shared/runtime';
import { isMarkdownPreviewCandidate } from './text-preview';

export interface OptimisticMessageFile {
  file: File;
  name: string;
  mimeType: string;
  previewText?: string;
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
      ? buildUploadedAttachments(uploadedAttachments, files)
      : buildStagedAttachments(files);
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

function buildUploadedAttachments(
  uploadedAttachments: readonly FileDataAttachmentPayload[],
  files: readonly OptimisticMessageFile[],
): NonNullable<ChatMessage['attachments']> {
  return uploadedAttachments.map((uploaded, index) => {
    const staged = files[index];
    const mimeType = uploaded.mimeType || staged?.mimeType || 'application/octet-stream';
    const name = uploaded.name || staged?.name || 'attachment';
    const isImage = mimeType.toLowerCase().startsWith('image/');
    const previewUrl = resolveUploadedPreviewUrl(uploaded, staged, isImage);
    const previewText = resolvePreviewText(name, mimeType, staged?.previewText);
    return {
      name,
      mimeType,
      fileUri: uploaded.fileUri,
      ...(previewUrl ? { previewUrl } : {}),
      ...(previewText ? { previewText } : {}),
    };
  });
}

function buildStagedAttachments(
  files: readonly OptimisticMessageFile[],
): NonNullable<ChatMessage['attachments']> {
  return files.map((staged) => {
    const isImage = staged.mimeType.toLowerCase().startsWith('image/');
    const previewText = resolvePreviewText(staged.name, staged.mimeType, staged.previewText);
    return {
      name: staged.name,
      mimeType: staged.mimeType,
      ...(isImage ? { previewUrl: URL.createObjectURL(staged.file) } : {}),
      ...(previewText ? { previewText } : {}),
      ...(staged.uploadState ? { uploadState: staged.uploadState } : {}),
    };
  });
}

function resolvePreviewText(
  name: string,
  mimeType: string,
  rawPreviewText: string | undefined,
): string | undefined {
  if (!isMarkdownPreviewCandidate(name, mimeType)) {
    return undefined;
  }

  return rawPreviewText?.trim() || undefined;
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
