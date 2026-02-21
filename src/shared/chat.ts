import type { ChatMessage } from './messages';
import type {
  ChatDeletePayload,
  ChatListPayload,
  ChatLoadPayload,
  ChatNewPayload,
  ChatSendPayload,
  ChatSessionSummary,
  FileDataAttachmentPayload,
  RuntimeRequest,
} from './runtime';
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

async function sendRuntimeRequest<TPayload>(request: RuntimeRequest): Promise<TPayload> {
  const response = (await chrome.runtime.sendMessage(request)) as
    | { ok: true; payload: TPayload }
    | { ok: false; error: string }
    | undefined;

  if (!response) {
    throw new Error('Background service did not return a response.');
  }

  if (!response.ok) {
    throw new Error(response.error || 'Background service failed to handle the request.');
  }

  return response.payload;
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
): Promise<ChatMessage> {
  const normalizedInput = userInput.trim();
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
    ...(chatId ? { chatId } : {}),
  });

  await writeActiveChatId(payload.chatId);
  return payload.assistantMessage;
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
