import type {
  ChatDeletePayload,
  ChatListPayload,
  ChatLoadPayload,
  ChatNewPayload,
  ChatSendPayload,
  ChatSessionSummary,
  FileDataAttachmentPayload,
  OpenOptionsPayload,
  RuntimeRequest,
  RuntimeResponse,
} from '../shared/runtime';
import {
  GEMINI_SETTINGS_STORAGE_KEY,
  type GeminiSettings,
  normalizeGeminiSettings,
} from '../shared/settings';
import { type ChatRepository, createChatRepository } from './chat-repository';
import { bootstrapChatStorage } from './chat-storage-bootstrap';
import { completeAssistantTurn, isInvalidPreviousInteractionIdError } from './gemini';
import { createSession, mapSessionToChatMessages, toAssistantChatMessage } from './sessions';
import type { ChatSession, GeminiContent } from './types';
import { assertNever, isRecord, toErrorMessage } from './utils';

type RuntimePayload =
  | ChatLoadPayload
  | ChatNewPayload
  | ChatSendPayload
  | ChatDeletePayload
  | ChatListPayload
  | OpenOptionsPayload;

interface RuntimeDependencies {
  repository: ChatRepository;
  bootstrapChatStorage: () => Promise<void>;
  readGeminiSettings: () => Promise<GeminiSettings>;
  completeAssistantTurn: (
    session: ChatSession,
    settings: GeminiSettings,
    thinkingLevel?: string,
  ) => Promise<GeminiContent>;
  openOptionsPage: () => Promise<void>;
  now: () => Date;
}

const EXPIRED_INTERACTION_MESSAGE =
  'Conversation context expired. Please resend your last message to continue.';

export function registerBackgroundRuntimeHandlers(): void {
  const handleRuntimeRequest = createRuntimeRequestHandler();

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

export function createRuntimeRequestHandler(
  overrides: Partial<RuntimeDependencies> = {},
): (request: RuntimeRequest) => Promise<RuntimePayload> {
  const dependencies: RuntimeDependencies = {
    repository: createChatRepository(),
    bootstrapChatStorage,
    readGeminiSettings,
    completeAssistantTurn,
    openOptionsPage,
    now: () => new Date(),
    ...overrides,
  };

  let mutationQueue: Promise<void> = Promise.resolve();
  const ready = (async () => {
    await dependencies.bootstrapChatStorage();
    await dependencies.repository.pruneExpiredSessions(dependencies.now().getTime());
  })();

  const enqueueMutation = <TPayload>(operation: () => Promise<TPayload>): Promise<TPayload> => {
    const task = mutationQueue.then(operation);
    mutationQueue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  };

  return async (request: RuntimeRequest): Promise<RuntimePayload> => {
    await ready;

    switch (request.type) {
      case 'chat/load':
        await mutationQueue;
        return handleLoadChat(request.chatId, dependencies);
      case 'chat/new':
        return enqueueMutation(() => handleNewChat(dependencies));
      case 'chat/send':
        return enqueueMutation(() =>
          handleSendMessage(
            request.text,
            request.chatId,
            request.model,
            request.thinkingLevel,
            request.attachments,
            dependencies,
          ),
        );
      case 'chat/delete':
        return enqueueMutation(() => handleDeleteChat(request.chatId, dependencies));
      case 'chat/list':
        await mutationQueue;
        return handleListChats(dependencies);
      case 'app/open-options':
        await dependencies.openOptionsPage();
        return {
          opened: true,
        };
      default:
        return assertNever(request);
    }
  };
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
    type === 'chat/delete' ||
    type === 'chat/list' ||
    type === 'app/open-options'
  );
}

async function handleLoadChat(
  chatId: string | undefined,
  dependencies: RuntimeDependencies,
): Promise<ChatLoadPayload> {
  if (!chatId) {
    return {
      chatId: null,
      messages: [],
    };
  }

  const session = await dependencies.repository.getSession(chatId);
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

async function handleNewChat(dependencies: RuntimeDependencies): Promise<ChatNewPayload> {
  const session = createSession();
  const now = dependencies.now();
  await dependencies.repository.upsertSession(session, now.getTime());
  await dependencies.repository.pruneExpiredSessions(now.getTime());
  return {
    chatId: session.id,
  };
}

async function handleSendMessage(
  text: string,
  chatId: string | undefined,
  model: string | undefined,
  thinkingLevel: string | undefined,
  attachments: FileDataAttachmentPayload[] | undefined,
  dependencies: RuntimeDependencies,
): Promise<ChatSendPayload> {
  const normalizedText = text.trim();
  const normalizedAttachments = normalizeFileDataAttachments(attachments);
  if (!normalizedText && normalizedAttachments.length === 0) {
    throw new Error('Cannot send an empty message.');
  }

  const settings = await dependencies.readGeminiSettings();
  if (!settings.apiKey) {
    throw new Error('Gemini API key is missing. Add it in Speakeasy Settings.');
  }

  if (model) {
    settings.model = model;
  }

  const persistedSession = chatId ? await dependencies.repository.getSession(chatId) : null;
  const baseSession = persistedSession ?? createSession();
  const workingSession: ChatSession = structuredClone(baseSession);

  const userParts = [
    ...(normalizedText ? [{ text: normalizedText }] : []),
    ...normalizedAttachments.map((attachment) => ({
      fileData: {
        fileUri: attachment.fileUri,
        mimeType: attachment.mimeType,
      },
    })),
  ];

  workingSession.contents.push({
    role: 'user',
    parts: userParts,
  });

  let assistantContent: GeminiContent;
  try {
    assistantContent = await dependencies.completeAssistantTurn(
      workingSession,
      settings,
      thinkingLevel,
    );
  } catch (error: unknown) {
    if (isInvalidPreviousInteractionIdError(error)) {
      if (baseSession.lastInteractionId) {
        const { lastInteractionId: _lastInteractionId, ...sessionWithoutInteractionId } =
          baseSession;
        const resetSession: ChatSession = {
          ...sessionWithoutInteractionId,
          contents: baseSession.contents.map((content) => ({
            role: content.role,
            parts: content.parts.map((part) => ({ ...part })),
          })),
        };
        const now = dependencies.now();
        await dependencies.repository.upsertSession(resetSession, now.getTime());
        await dependencies.repository.pruneExpiredSessions(now.getTime());
      }
      throw new Error(EXPIRED_INTERACTION_MESSAGE);
    }
    throw error;
  }

  const now = dependencies.now();
  workingSession.updatedAt = now.toISOString();
  await dependencies.repository.upsertSession(workingSession, now.getTime());
  await dependencies.repository.pruneExpiredSessions(now.getTime());

  return {
    chatId: workingSession.id,
    assistantMessage: toAssistantChatMessage(assistantContent),
  };
}

async function handleDeleteChat(
  chatId: string,
  dependencies: RuntimeDependencies,
): Promise<ChatDeletePayload> {
  const deleted = await dependencies.repository.deleteSession(chatId);
  await dependencies.repository.pruneExpiredSessions(dependencies.now().getTime());

  return {
    deleted,
    chatId: null,
  };
}

async function handleListChats(dependencies: RuntimeDependencies): Promise<ChatListPayload> {
  const nowMs = dependencies.now().getTime();
  await dependencies.repository.pruneExpiredSessions(nowMs);
  const sessions = await dependencies.repository.listSessions();
  const summaries: ChatSessionSummary[] = sessions.map((session) => ({
    chatId: session.id,
    title: summarizeSessionTitle(session),
    updatedAt: session.updatedAt,
  }));

  return {
    sessions: summaries,
  };
}

function normalizeFileDataAttachments(
  attachments: FileDataAttachmentPayload[] | undefined,
): FileDataAttachmentPayload[] {
  if (!attachments) {
    return [];
  }

  const normalized: FileDataAttachmentPayload[] = [];
  for (const attachment of attachments) {
    const fileUri = typeof attachment.fileUri === 'string' ? attachment.fileUri.trim() : '';
    const mimeType = typeof attachment.mimeType === 'string' ? attachment.mimeType.trim() : '';
    const name = typeof attachment.name === 'string' ? attachment.name.trim() : '';
    if (!fileUri || !mimeType || !name) {
      continue;
    }

    const fileName =
      typeof attachment.fileName === 'string' && attachment.fileName.trim()
        ? attachment.fileName.trim()
        : undefined;

    normalized.push({
      name,
      mimeType,
      fileUri,
      ...(fileName ? { fileName } : {}),
    });
  }

  return normalized;
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

function summarizeSessionTitle(session: ChatSession): string {
  const latestUserText = findLatestContentText(session, 'user');
  if (latestUserText) {
    return truncateForLabel(latestUserText, 48);
  }

  const latestAssistantText = findLatestContentText(session, 'model');
  if (latestAssistantText) {
    return truncateForLabel(latestAssistantText, 48);
  }

  const timestamp = session.updatedAt.replace('T', ' ').slice(0, 16);
  return `Chat ${timestamp || session.id.slice(0, 8)}`;
}

function findLatestContentText(session: ChatSession, role: 'user' | 'model'): string {
  for (let index = session.contents.length - 1; index >= 0; index -= 1) {
    const content = session.contents[index];
    if (!content || content.role !== role) {
      continue;
    }

    for (const part of content.parts) {
      const text = typeof part.text === 'string' ? part.text.trim() : '';
      if (text) {
        return text;
      }
    }
  }

  return '';
}

function truncateForLabel(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}
