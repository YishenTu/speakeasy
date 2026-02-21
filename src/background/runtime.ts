import type {
  ChatDeletePayload,
  ChatListPayload,
  ChatLoadPayload,
  ChatNewPayload,
  ChatSendPayload,
  ChatSessionSummary,
  ChatStreamDeltaEvent,
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
import {
  type GeminiStreamDelta,
  completeAssistantTurn,
  generateSessionTitle,
  isInvalidPreviousInteractionIdError,
} from './gemini';
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
    onStreamDelta?: (delta: GeminiStreamDelta) => void,
  ) => Promise<GeminiContent>;
  generateSessionTitle: (apiKey: string, firstUserQuery: string) => Promise<string>;
  openOptionsPage: () => Promise<void>;
  now: () => Date;
}

interface RuntimeRequestContext {
  sender?: chrome.runtime.MessageSender;
}

interface PendingSessionTitleGeneration {
  chatId: string;
  apiKey: string;
  firstUserQuery: string;
}

interface SendMessageResult {
  payload: ChatSendPayload;
  pendingTitleGeneration?: PendingSessionTitleGeneration;
}

type MutationEnqueuer = <TPayload>(operation: () => Promise<TPayload>) => Promise<TPayload>;

const EXPIRED_INTERACTION_MESSAGE =
  'Conversation context expired. Please resend your last message to continue.';

export function registerBackgroundRuntimeHandlers(): void {
  const handleRuntimeRequest = createRuntimeRequestHandler();

  chrome.runtime.onMessage.addListener((request: unknown, sender, sendResponse) => {
    if (!isRuntimeRequest(request)) {
      return false;
    }

    void handleRuntimeRequest(request, { sender })
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
): (request: RuntimeRequest, context?: RuntimeRequestContext) => Promise<RuntimePayload> {
  const dependencies: RuntimeDependencies = {
    repository: createChatRepository(),
    bootstrapChatStorage,
    readGeminiSettings,
    completeAssistantTurn,
    generateSessionTitle,
    openOptionsPage,
    now: () => new Date(),
    ...overrides,
  };

  let mutationQueue: Promise<void> = Promise.resolve();
  const ready = (async () => {
    try {
      await dependencies.bootstrapChatStorage();
      await pruneExpiredSessionsBestEffort(dependencies, dependencies.now().getTime());
    } catch (error: unknown) {
      console.error('Failed to initialize chat storage bootstrap.', error);
    }
  })();

  const enqueueMutation = <TPayload>(operation: () => Promise<TPayload>): Promise<TPayload> => {
    const task = mutationQueue.then(operation);
    mutationQueue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  };

  return async (
    request: RuntimeRequest,
    context?: RuntimeRequestContext,
  ): Promise<RuntimePayload> => {
    await ready;

    switch (request.type) {
      case 'chat/load':
        await mutationQueue;
        return handleLoadChat(request.chatId, dependencies);
      case 'chat/new':
        return enqueueMutation(() => handleNewChat(dependencies));
      case 'chat/send':
        return enqueueMutation(async () => {
          const result = await handleSendMessage(
            request.text,
            request.chatId,
            request.model,
            request.thinkingLevel,
            request.streamRequestId,
            context?.sender,
            request.attachments,
            dependencies,
          );

          if (result.pendingTitleGeneration) {
            void generateAndPersistSessionTitle(
              result.pendingTitleGeneration,
              dependencies,
              enqueueMutation,
            );
          }

          return result.payload;
        });
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
  await pruneExpiredSessionsBestEffort(dependencies, now.getTime());
  return {
    chatId: session.id,
  };
}

async function handleSendMessage(
  text: string,
  chatId: string | undefined,
  model: string | undefined,
  thinkingLevel: string | undefined,
  streamRequestId: string | undefined,
  sender: chrome.runtime.MessageSender | undefined,
  attachments: FileDataAttachmentPayload[] | undefined,
  dependencies: RuntimeDependencies,
): Promise<SendMessageResult> {
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
  const shouldGenerateTitle =
    baseSession.contents.length === 0 && !baseSession.title && normalizedText.length > 0;
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

  const streamDeltaEmitter = createStreamDeltaEmitter(streamRequestId, sender);
  let assistantContent: GeminiContent;
  try {
    assistantContent = await dependencies.completeAssistantTurn(
      workingSession,
      settings,
      thinkingLevel,
      streamDeltaEmitter,
    );
  } catch (error: unknown) {
    if (isInvalidPreviousInteractionIdError(error)) {
      if (baseSession.lastInteractionId) {
        const { lastInteractionId: _ignored, ...resetSession } = structuredClone(baseSession);
        const now = dependencies.now();
        try {
          await dependencies.repository.upsertSession(resetSession, now.getTime());
        } catch (resetError: unknown) {
          throw new Error('Failed to reset expired conversation context.', { cause: resetError });
        }
        await pruneExpiredSessionsBestEffort(dependencies, now.getTime());
      }
      throw new Error(EXPIRED_INTERACTION_MESSAGE);
    }
    throw error;
  }

  const now = dependencies.now();
  workingSession.updatedAt = now.toISOString();
  await dependencies.repository.upsertSession(workingSession, now.getTime());
  await pruneExpiredSessionsBestEffort(dependencies, now.getTime());

  const payload = {
    chatId: workingSession.id,
    assistantMessage: toAssistantChatMessage(assistantContent),
  };

  if (!shouldGenerateTitle) {
    return { payload };
  }

  return {
    payload,
    pendingTitleGeneration: {
      chatId: workingSession.id,
      apiKey: settings.apiKey,
      firstUserQuery: normalizedText,
    },
  };
}

async function handleDeleteChat(
  chatId: string,
  dependencies: RuntimeDependencies,
): Promise<ChatDeletePayload> {
  const deleted = await dependencies.repository.deleteSession(chatId);
  await pruneExpiredSessionsBestEffort(dependencies, dependencies.now().getTime());

  return {
    deleted,
    chatId: null,
  };
}

async function handleListChats(dependencies: RuntimeDependencies): Promise<ChatListPayload> {
  const nowMs = dependencies.now().getTime();
  await pruneExpiredSessionsBestEffort(dependencies, nowMs);
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

async function generateAndPersistSessionTitle(
  pending: PendingSessionTitleGeneration,
  dependencies: RuntimeDependencies,
  enqueueMutation: MutationEnqueuer,
): Promise<void> {
  try {
    const generatedTitle = await dependencies.generateSessionTitle(
      pending.apiKey,
      pending.firstUserQuery,
    );
    if (!generatedTitle) {
      return;
    }

    void enqueueMutation(async () => {
      const session = await dependencies.repository.getSession(pending.chatId);
      if (!session || session.title?.trim()) {
        return;
      }
      session.title = generatedTitle;
      await dependencies.repository.upsertSession(session, dependencies.now().getTime());
    });
  } catch (error: unknown) {
    console.warn('Failed to generate chat session title.', error);
  }
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

function createStreamDeltaEmitter(
  streamRequestId: string | undefined,
  sender: chrome.runtime.MessageSender | undefined,
): ((delta: GeminiStreamDelta) => void) | undefined {
  const requestId = typeof streamRequestId === 'string' ? streamRequestId.trim() : '';
  if (!requestId) {
    return undefined;
  }

  const tabId = sender?.tab?.id;
  if (typeof tabId !== 'number') {
    return undefined;
  }

  const frameId = typeof sender?.frameId === 'number' ? sender.frameId : undefined;
  return (delta: GeminiStreamDelta) => {
    const hasText = typeof delta.textDelta === 'string' && delta.textDelta.length > 0;
    const hasThinking = typeof delta.thinkingDelta === 'string' && delta.thinkingDelta.length > 0;
    if (!hasText && !hasThinking) {
      return;
    }

    const payload: ChatStreamDeltaEvent = {
      type: 'chat/stream-delta',
      requestId,
      ...(hasText ? { textDelta: delta.textDelta } : {}),
      ...(hasThinking ? { thinkingDelta: delta.thinkingDelta } : {}),
    };

    try {
      if (frameId !== undefined) {
        chrome.tabs.sendMessage(tabId, payload, { frameId }, () => {
          void chrome.runtime.lastError;
        });
        return;
      }

      chrome.tabs.sendMessage(tabId, payload, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // Best-effort stream updates should not fail the chat request lifecycle.
    }
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

function summarizeSessionTitle(session: ChatSession): string {
  const title = session.title?.trim();
  if (title) {
    return title;
  }

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

async function pruneExpiredSessionsBestEffort(
  dependencies: RuntimeDependencies,
  nowMs: number,
): Promise<void> {
  try {
    await dependencies.repository.pruneExpiredSessions(nowMs);
  } catch (error: unknown) {
    console.warn('Failed to prune expired chat sessions.', error);
  }
}
