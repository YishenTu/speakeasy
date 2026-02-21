import type { ChatMessage } from './messages';
import type { ChatLoadPayload, ChatNewPayload, ChatSendPayload, RuntimeRequest } from './runtime';
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
  const payload = await sendRuntimeRequest<ChatLoadPayload>(
    chatId ? { type: 'chat/load', chatId } : { type: 'chat/load' },
  );
  if (payload.chatId) {
    await writeActiveChatId(payload.chatId);
  }

  return payload;
}

export async function createNewChat(): Promise<string> {
  const payload = await sendRuntimeRequest<ChatNewPayload>({ type: 'chat/new' });
  await writeActiveChatId(payload.chatId);
  return payload.chatId;
}

export async function sendMessage(userInput: string): Promise<ChatMessage> {
  const normalizedInput = userInput.trim();
  if (!normalizedInput) {
    throw new Error('Cannot send an empty message.');
  }

  const chatId = await readActiveChatId();
  const payload = await sendRuntimeRequest<ChatSendPayload>(
    chatId
      ? {
          type: 'chat/send',
          text: normalizedInput,
          chatId,
        }
      : {
          type: 'chat/send',
          text: normalizedInput,
        },
  );

  await writeActiveChatId(payload.chatId);
  return payload.assistantMessage;
}
