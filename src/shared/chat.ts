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
  ChatTabContextPayload,
  ChatUploadFilesPayload,
  FileDataAttachmentPayload,
  TabCaptureFullPagePayload,
  TabExtractTextPayload,
  TabListOpenPayload,
  UploadFileTransportPayload,
} from './runtime';
import { sendRuntimeRequest } from './runtime-client';
import { ACTIVE_CHAT_FALLBACK_TAB_SCOPE, ACTIVE_CHAT_STORAGE_KEY } from './settings';

export type { ChatMessage, MessageRole } from './messages';

export interface ChatTabContext {
  tabId?: number | null;
}

type ActiveChatByScope = Record<string, string>;

function normalizeTabScope(tabContext?: ChatTabContext): string {
  const tabId = tabContext?.tabId;
  if (typeof tabId !== 'number' || !Number.isInteger(tabId) || tabId <= 0) {
    return ACTIVE_CHAT_FALLBACK_TAB_SCOPE;
  }

  return String(tabId);
}

function sanitizeActiveChatMap(value: unknown): ActiveChatByScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const nextMap: ActiveChatByScope = {};
  for (const [scope, chatId] of Object.entries(value)) {
    const normalizedScope = scope.trim();
    const normalizedChatId = typeof chatId === 'string' ? chatId.trim() : '';
    if (!normalizedScope || !normalizedChatId) {
      continue;
    }

    nextMap[normalizedScope] = normalizedChatId;
  }

  return nextMap;
}

async function readStoredActiveChatMap(): Promise<ActiveChatByScope> {
  const stored = await chrome.storage.local.get(ACTIVE_CHAT_STORAGE_KEY);
  const raw = stored[ACTIVE_CHAT_STORAGE_KEY];
  if (typeof raw === 'string') {
    // Older installs stored a single global active chat id. Keep reading it as fallback scope.
    const legacyChatId = raw.trim();
    if (!legacyChatId) {
      return {};
    }

    return {
      [ACTIVE_CHAT_FALLBACK_TAB_SCOPE]: legacyChatId,
    };
  }

  return sanitizeActiveChatMap(raw);
}

async function persistActiveChatMap(map: ActiveChatByScope): Promise<void> {
  if (Object.keys(map).length === 0) {
    await chrome.storage.local.remove(ACTIVE_CHAT_STORAGE_KEY);
    return;
  }

  await chrome.storage.local.set({ [ACTIVE_CHAT_STORAGE_KEY]: map });
}

async function readActiveChatId(tabContext?: ChatTabContext): Promise<string | undefined> {
  const map = await readStoredActiveChatMap();
  const scope = normalizeTabScope(tabContext);
  const chatId = map[scope];
  if (chatId) {
    return chatId;
  }

  if (scope === ACTIVE_CHAT_FALLBACK_TAB_SCOPE) {
    return undefined;
  }

  // Tabs without an explicit slot still inherit the fallback scope until they write their own id.
  return map[ACTIVE_CHAT_FALLBACK_TAB_SCOPE];
}

async function writeActiveChatId(chatId: string, tabContext?: ChatTabContext): Promise<void> {
  const normalizedChatId = chatId.trim();
  if (!normalizedChatId) {
    await clearActiveChatId(tabContext);
    return;
  }

  const map = await readStoredActiveChatMap();
  const scope = normalizeTabScope(tabContext);
  map[scope] = normalizedChatId;
  if (
    scope !== ACTIVE_CHAT_FALLBACK_TAB_SCOPE &&
    map[ACTIVE_CHAT_FALLBACK_TAB_SCOPE] === normalizedChatId
  ) {
    // Once a tab writes its own slot, drop duplicate fallback data from legacy global state.
    delete map[ACTIVE_CHAT_FALLBACK_TAB_SCOPE];
  }
  await persistActiveChatMap(map);
}

async function clearActiveChatId(tabContext?: ChatTabContext): Promise<void> {
  const scope = normalizeTabScope(tabContext);
  const map = await readStoredActiveChatMap();
  if (!map[scope]) {
    return;
  }

  delete map[scope];
  await persistActiveChatMap(map);
}

export async function resolveChatTabContext(): Promise<ChatTabContext> {
  try {
    const payload = await sendRuntimeRequest<ChatTabContextPayload>({
      type: 'chat/get-tab-context',
    });
    const tabId = payload.tabId;
    if (typeof tabId !== 'number' || !Number.isInteger(tabId) || tabId <= 0) {
      return {};
    }

    return { tabId };
  } catch {
    return {};
  }
}

export async function loadChatMessages(tabContext?: ChatTabContext): Promise<ChatLoadPayload> {
  const chatId = await readActiveChatId(tabContext);
  return loadChatMessagesById(chatId, tabContext);
}

export async function loadChatMessagesById(
  chatId: string | undefined,
  tabContext?: ChatTabContext,
): Promise<ChatLoadPayload> {
  const payload = await sendRuntimeRequest<ChatLoadPayload>({
    type: 'chat/load',
    ...(chatId ? { chatId } : {}),
  });
  if (payload.chatId) {
    await writeActiveChatId(payload.chatId, tabContext);
  } else {
    await clearActiveChatId(tabContext);
  }

  return payload;
}

export async function createNewChat(tabContext?: ChatTabContext): Promise<string> {
  const payload = await sendRuntimeRequest<ChatNewPayload>({ type: 'chat/new' });
  await writeActiveChatId(payload.chatId, tabContext);
  return payload.chatId;
}

export async function sendMessage(
  userInput: string,
  model: string,
  thinkingLevel?: string,
  attachments?: FileDataAttachmentPayload[],
  streamRequestId?: string,
  tabContext?: ChatTabContext,
): Promise<ChatMessage> {
  const normalizedInput = userInput.trim();
  const normalizedStreamRequestId = streamRequestId?.trim();
  const normalizedAttachments = attachments?.filter(
    (attachment) => attachment.fileUri.trim().length > 0,
  );
  if (!normalizedInput && (!normalizedAttachments || normalizedAttachments.length === 0)) {
    throw new Error('Cannot send an empty message.');
  }

  const chatId = await readActiveChatId(tabContext);
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

  await writeActiveChatId(payload.chatId, tabContext);
  return payload.assistantMessage;
}

export async function forkChat(
  previousInteractionId: string,
  tabContext?: ChatTabContext,
): Promise<string> {
  const chatId = await readActiveChatId(tabContext);
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
  await writeActiveChatId(payload.chatId, tabContext);
  return payload.chatId;
}

export async function regenerateAssistantMessage(
  previousInteractionId: string,
  model: string,
  thinkingLevel?: string,
  streamRequestId?: string,
  tabContext?: ChatTabContext,
): Promise<ChatMessage> {
  const chatId = await readActiveChatId(tabContext);
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

  await writeActiveChatId(payload.chatId, tabContext);
  return payload.assistantMessage;
}

export async function switchAssistantBranch(
  interactionId: string,
  tabContext?: ChatTabContext,
): Promise<string> {
  const chatId = await readActiveChatId(tabContext);
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
  await writeActiveChatId(payload.chatId, tabContext);
  return payload.chatId;
}

export async function deleteChatById(
  chatId: string,
  tabContext?: ChatTabContext,
): Promise<boolean> {
  const normalizedChatId = chatId.trim();
  if (!normalizedChatId) {
    return false;
  }

  const payload = await sendRuntimeRequest<ChatDeletePayload>({
    type: 'chat/delete',
    chatId: normalizedChatId,
  });
  const activeChatId = await readActiveChatId(tabContext);
  if (payload.deleted && activeChatId === normalizedChatId) {
    await clearActiveChatId(tabContext);
  }
  return payload.deleted;
}

export async function listChatSessions(): Promise<ChatSessionSummary[]> {
  const payload = await sendRuntimeRequest<ChatListPayload>({
    type: 'chat/list',
  });
  return payload.sessions;
}

export async function getActiveChatId(tabContext?: ChatTabContext): Promise<string | undefined> {
  return readActiveChatId(tabContext);
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

export async function captureCurrentTabFullPageScreenshot(): Promise<TabCaptureFullPagePayload> {
  return sendRuntimeRequest<TabCaptureFullPagePayload>({
    type: 'tab/capture-full-page',
  });
}

export async function listOpenTabsForMention(): Promise<TabListOpenPayload> {
  return sendRuntimeRequest<TabListOpenPayload>({
    type: 'tab/list-open',
  });
}

export async function captureTabFullPageScreenshotById(
  tabId: number,
): Promise<TabCaptureFullPagePayload> {
  return sendRuntimeRequest<TabCaptureFullPagePayload>({
    type: 'tab/capture-full-page-by-id',
    tabId,
  });
}

export async function extractTabTextById(tabId: number): Promise<TabExtractTextPayload> {
  return sendRuntimeRequest<TabExtractTextPayload>({
    type: 'tab/extract-text-by-id',
    tabId,
  });
}
