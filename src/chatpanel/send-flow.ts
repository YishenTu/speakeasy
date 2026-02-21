import type { ChatMessage } from '../shared/chat';
import type { ChatAttachment } from '../shared/messages';
import type { FileDataAttachmentPayload } from '../shared/runtime';

export interface StagedMessageFile {
  file: File;
  name: string;
  mimeType: string;
}

interface SendFlowInput {
  text: string;
  stagedFiles: StagedMessageFile[];
  model: string;
  thinkingLevel?: string;
}

interface SendFlowDependencies {
  appendMessage: (message: ChatMessage) => void;
  onUserMessageAppended?: () => void;
  uploadFiles: (files: File[]) => Promise<FileDataAttachmentPayload[]>;
  sendMessage: (
    text: string,
    model: string,
    thinkingLevel?: string,
    attachments?: FileDataAttachmentPayload[],
  ) => Promise<ChatMessage>;
  createMessageId?: () => string;
  createObjectUrl?: (file: File) => string;
}

export async function sendChatTurnWithOptimisticUserMessage(
  input: SendFlowInput,
  dependencies: SendFlowDependencies,
): Promise<ChatMessage> {
  const createMessageId = dependencies.createMessageId ?? (() => crypto.randomUUID());
  const createObjectUrl =
    dependencies.createObjectUrl ?? ((file: File) => URL.createObjectURL(file));

  const userMessageAttachments = buildUserMessageAttachments(input.stagedFiles, createObjectUrl);
  dependencies.appendMessage({
    id: createMessageId(),
    role: 'user',
    content: input.text,
    ...(userMessageAttachments.length > 0 ? { attachments: userMessageAttachments } : {}),
  });
  dependencies.onUserMessageAppended?.();

  const uploadedAttachments = await dependencies.uploadFiles(
    input.stagedFiles.map((staged) => staged.file),
  );
  return dependencies.sendMessage(
    input.text,
    input.model,
    input.thinkingLevel,
    uploadedAttachments,
  );
}

function buildUserMessageAttachments(
  stagedFiles: StagedMessageFile[],
  createObjectUrl: (file: File) => string,
): ChatAttachment[] {
  return stagedFiles.map((staged) => {
    const isImage = staged.mimeType.toLowerCase().startsWith('image/');
    return {
      name: staged.name,
      mimeType: staged.mimeType,
      ...(isImage ? { previewUrl: createObjectUrl(staged.file) } : {}),
    };
  });
}
