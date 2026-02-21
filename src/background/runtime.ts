import type {
  ChatLoadPayload,
  ChatNewPayload,
  ChatSendPayload,
  OpenOptionsPayload,
  RuntimeRequest,
  RuntimeResponse,
} from '../shared/runtime';
import {
  GEMINI_SETTINGS_STORAGE_KEY,
  type GeminiSettings,
  normalizeGeminiSettings,
} from '../shared/settings';
import { completeAssistantTurn } from './gemini';
import {
  createSession,
  getOrCreateSession,
  mapSessionToChatMessages,
  readSessions,
  toAssistantChatMessage,
  writeSessions,
} from './sessions';
import { assertNever, isRecord, toErrorMessage } from './utils';

export function registerBackgroundRuntimeHandlers(): void {
  chrome.runtime.onMessage.addListener((request: unknown, _sender, sendResponse) => {
    if (!isRuntimeRequest(request)) {
      return false;
    }

    void handleRuntimeRequest(request)
      .then((payload) => {
        const response: RuntimeResponse<typeof payload> = {
          ok: true,
          payload,
        };
        sendResponse(response);
      })
      .catch((error: unknown) => {
        const response: RuntimeResponse<never> = {
          ok: false,
          error: toErrorMessage(error),
        };
        sendResponse(response);
      });

    return true;
  });
}

function isRuntimeRequest(value: unknown): value is RuntimeRequest {
  if (!isRecord(value)) {
    return false;
  }

  const type = value.type;
  return (
    type === 'chat/send' ||
    type === 'chat/load' ||
    type === 'chat/new' ||
    type === 'app/open-options'
  );
}

async function handleRuntimeRequest(
  request: RuntimeRequest,
): Promise<ChatLoadPayload | ChatNewPayload | ChatSendPayload | OpenOptionsPayload> {
  switch (request.type) {
    case 'chat/load':
      return handleLoadChat(request.chatId);
    case 'chat/new':
      return handleNewChat();
    case 'chat/send':
      return handleSendMessage(request.text, request.chatId, request.model, request.thinkingLevel);
    case 'app/open-options':
      await openOptionsPage();
      return {
        opened: true,
      };
    default:
      return assertNever(request);
  }
}

async function handleLoadChat(chatId: string | undefined): Promise<ChatLoadPayload> {
  if (!chatId) {
    return {
      chatId: null,
      messages: [],
    };
  }

  const sessions = await readSessions();
  const session = sessions[chatId];
  if (!session) {
    return {
      chatId: null,
      messages: [],
    };
  }

  return {
    chatId: session.id,
    messages: mapSessionToChatMessages(session),
  };
}

async function handleNewChat(): Promise<ChatNewPayload> {
  const sessions = await readSessions();
  const session = createSession();
  sessions[session.id] = session;
  await writeSessions(sessions);
  return {
    chatId: session.id,
  };
}

async function handleSendMessage(
  text: string,
  chatId: string | undefined,
  model?: string,
  thinkingLevel?: string,
): Promise<ChatSendPayload> {
  const normalizedText = text.trim();
  if (!normalizedText) {
    throw new Error('Cannot send an empty message.');
  }

  const settings = await readGeminiSettings();
  if (!settings.apiKey) {
    throw new Error('Gemini API key is missing. Add it in Speakeasy Settings.');
  }

  if (model) {
    settings.model = model;
  }

  const sessions = await readSessions();
  const session = getOrCreateSession(sessions, chatId);
  session.contents.push({
    role: 'user',
    parts: [{ text: normalizedText }],
  });

  const assistantContent = await completeAssistantTurn(session, settings, thinkingLevel);
  session.updatedAt = new Date().toISOString();
  sessions[session.id] = session;
  await writeSessions(sessions);

  return {
    chatId: session.id,
    assistantMessage: toAssistantChatMessage(assistantContent),
  };
}

async function readGeminiSettings(): Promise<GeminiSettings> {
  const stored = await chrome.storage.local.get(GEMINI_SETTINGS_STORAGE_KEY);
  return normalizeGeminiSettings(stored[GEMINI_SETTINGS_STORAGE_KEY]);
}

function openOptionsPage(): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.runtime.openOptionsPage(() => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });
}
