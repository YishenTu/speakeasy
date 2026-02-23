import { encodeArrayBufferToBase64 } from './base64';
import type { ChatMessage } from './messages';
import type {
  ChatDeletePayload,
  ChatForkPayload,
  ChatListPayload,
  ChatLoadPayload,
  ChatNewPayload,
  ChatRegenPayload,
  ChatSendPayload,
  ChatSessionSummary,
  ChatSwitchBranchPayload,
  ChatUploadFilesPayload,
  FileDataAttachmentPayload,
  UploadFileTransportPayload,
} from './runtime';
import { sendRuntimeRequest } from './runtime-client';
import { ACTIVE_CHAT_STORAGE_KEY } from './settings';

export type { ChatMessage, MessageRole } from './messages';

async function readActiveChatId(): Promise<string | undefined> {
  const stored = await chrome.storage.local.get(ACTIVE_CHAT_STORAGE_KEY);
  const value = stored[ACTIVE_CHAT_STORAGE_KEY];
  return typeof value === 'string' && value ? value : undefined;
}

async function writeActiveChatId(chatId: string): Promise<void> {
  await chrome.storage.local.set({ [ACTIVE_CHAT_STORAGE_KEY]: chatId });
}

async function clearActiveChatId(): Promise<void> {
  await chrome.storage.local.remove(ACTIVE_CHAT_STORAGE_KEY);
}

export async function loadChatMessages(): Promise<ChatLoadPayload> {
  const chatId = await readActiveChatId();
  return loadChatMessagesById(chatId);
}

export async function loadChatMessagesById(chatId: string | undefined): Promise<ChatLoadPayload> {
  const payload = await sendRuntimeRequest<ChatLoadPayload>({
    type: 'chat/load',
    ...(chatId ? { chatId } : {}),
  });
  if (payload.chatId) {
    await writeActiveChatId(payload.chatId);
  } else {
    await clearActiveChatId();
  }

  return payload;
}

export async function createNewChat(): Promise<string> {
  const payload = await sendRuntimeRequest<ChatNewPayload>({ type: 'chat/new' });
  await writeActiveChatId(payload.chatId);
  return payload.chatId;
}

export async function sendMessage(
  userInput: string,
  model: string,
  thinkingLevel?: string,
  attachments?: FileDataAttachmentPayload[],
  streamRequestId?: string,
): Promise<ChatMessage> {
  const normalizedInput = userInput.trim();
  const normalizedStreamRequestId = streamRequestId?.trim();
  const normalizedAttachments = attachments?.filter(
    (attachment) => attachment.fileUri.trim().length > 0,
  );
  if (!normalizedInput && (!normalizedAttachments || normalizedAttachments.length === 0)) {
    throw new Error('Cannot send an empty message.');
  }

  const chatId = await readActiveChatId();
  const payload = await sendRuntimeRequest<ChatSendPayload>({
    type: 'chat/send',
    text: normalizedInput,
    model,
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(normalizedAttachments && normalizedAttachments.length > 0
      ? { attachments: normalizedAttachments }
      : {}),
    ...(normalizedStreamRequestId ? { streamRequestId: normalizedStreamRequestId } : {}),
    ...(chatId ? { chatId } : {}),
  });

  await writeActiveChatId(payload.chatId);
  return payload.assistantMessage;
}

export async function forkChat(previousInteractionId: string): Promise<string> {
  const chatId = await readActiveChatId();
  if (!chatId) {
    throw new Error('No active chat selected. Open a chat before forking.');
  }

  const normalizedInteractionId = previousInteractionId.trim();
  if (!normalizedInteractionId) {
    throw new Error('Cannot fork without a target message.');
  }

  const payload = await sendRuntimeRequest<ChatForkPayload>({
    type: 'chat/fork',
    chatId,
    previousInteractionId: normalizedInteractionId,
  });
  await writeActiveChatId(payload.chatId);
  return payload.chatId;
}

export async function regenerateAssistantMessage(
  previousInteractionId: string,
  model: string,
  thinkingLevel?: string,
  streamRequestId?: string,
): Promise<ChatMessage> {
  const chatId = await readActiveChatId();
  if (!chatId) {
    throw new Error('No active chat selected. Open a chat before regenerating.');
  }

  const normalizedInteractionId = previousInteractionId.trim();
  if (!normalizedInteractionId) {
    throw new Error('Cannot regenerate without a target interaction id.');
  }
  const normalizedStreamRequestId = streamRequestId?.trim();
  const payload = await sendRuntimeRequest<ChatRegenPayload>({
    type: 'chat/regen',
    chatId,
    model,
    previousInteractionId: normalizedInteractionId,
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(normalizedStreamRequestId ? { streamRequestId: normalizedStreamRequestId } : {}),
  });

  await writeActiveChatId(payload.chatId);
  return payload.assistantMessage;
}

export async function switchAssistantBranch(interactionId: string): Promise<string> {
  const chatId = await readActiveChatId();
  if (!chatId) {
    throw new Error('No active chat selected. Open a chat before switching branches.');
  }

  const normalizedInteractionId = interactionId.trim();
  if (!normalizedInteractionId) {
    throw new Error('Cannot switch branches without an interaction id.');
  }

  const payload = await sendRuntimeRequest<ChatSwitchBranchPayload>({
    type: 'chat/switch-branch',
    chatId,
    interactionId: normalizedInteractionId,
  });
  await writeActiveChatId(payload.chatId);
  return payload.chatId;
}

export async function deleteChatById(chatId: string): Promise<boolean> {
  const normalizedChatId = chatId.trim();
  if (!normalizedChatId) {
    return false;
  }

  const payload = await sendRuntimeRequest<ChatDeletePayload>({
    type: 'chat/delete',
    chatId: normalizedChatId,
  });
  const activeChatId = await readActiveChatId();
  if (payload.deleted && activeChatId === normalizedChatId) {
    await clearActiveChatId();
  }
  return payload.deleted;
}

export async function listChatSessions(): Promise<ChatSessionSummary[]> {
  const payload = await sendRuntimeRequest<ChatListPayload>({
    type: 'chat/list',
  });
  return payload.sessions;
}

export async function getActiveChatId(): Promise<string | undefined> {
  return readActiveChatId();
}

export interface UploadChatFilesOptions {
  uploadTimeoutMs?: number;
}

export async function uploadChatFiles(
  files: File[],
  options: UploadChatFilesOptions = {},
): Promise<ChatUploadFilesPayload> {
  if (files.length === 0) {
    return {
      attachments: [],
      failures: [],
    };
  }

  const payloadFiles: UploadFileTransportPayload[] = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      bytesBase64: encodeArrayBufferToBase64(await file.arrayBuffer()),
    })),
  );

  return sendRuntimeRequest<ChatUploadFilesPayload>({
    type: 'chat/upload-files',
    files: payloadFiles,
    ...(typeof options.uploadTimeoutMs === 'number'
      ? { uploadTimeoutMs: options.uploadTimeoutMs }
      : {}),
  });
}
