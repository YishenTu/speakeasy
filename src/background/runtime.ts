import type {
  ChatDeletePayload,
  ChatForkPayload,
  ChatListPayload,
  ChatLoadPayload,
  ChatNewPayload,
  ChatRegenPayload,
  ChatSendPayload,
  ChatSessionSummary,
  ChatStreamDeltaEvent,
  ChatSwitchBranchPayload,
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
import {
  appendContentsToBranch,
  createSession,
  ensureBranchTree,
  findLastModelInteractionId,
  findNodeIdByInteractionId,
  getActiveBranchContents,
  getBranchContentsToNode,
  isUserPromptContent,
  mapSessionToChatMessages,
  setActiveLeafNodeId,
  toAssistantChatMessage,
} from './sessions';
import type { ChatBranchNode, ChatSession, GeminiContent } from './types';
import { assertNever, isRecord, toErrorMessage } from './utils';

type RuntimePayload =
  | ChatLoadPayload
  | ChatNewPayload
  | ChatSendPayload
  | ChatRegenPayload
  | ChatForkPayload
  | ChatSwitchBranchPayload
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
  generateSessionTitle: (
    apiKey: string,
    firstUserQuery: string,
    attachments?: FileDataAttachmentPayload[],
  ) => Promise<string>;
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
  attachments?: FileDataAttachmentPayload[];
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
      case 'chat/regen':
        return enqueueMutation(() =>
          handleRegenerate(
            request.chatId,
            request.model,
            request.previousInteractionId,
            request.thinkingLevel,
            request.streamRequestId,
            context?.sender,
            dependencies,
          ),
        );
      case 'chat/fork':
        return enqueueMutation(() =>
          handleForkChat(request.chatId, request.previousInteractionId, dependencies),
        );
      case 'chat/switch-branch':
        return enqueueMutation(() =>
          handleSwitchBranch(request.chatId, request.interactionId, dependencies),
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
    type === 'chat/regen' ||
    type === 'chat/fork' ||
    type === 'chat/switch-branch' ||
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
  ensureBranchTree(baseSession);
  const shouldGenerateTitle =
    countUserPromptNodes(baseSession) === 0 &&
    !baseSession.title &&
    (normalizedText.length > 0 || normalizedAttachments.length > 0);
  const workingSession: ChatSession = structuredClone(baseSession);
  ensureBranchTree(workingSession);
  const continuationInteractionId = workingSession.lastInteractionId;

  const userParts = [
    ...(normalizedText ? [{ text: normalizedText }] : []),
    ...normalizedAttachments.map((attachment) => ({
      fileData: {
        fileUri: attachment.fileUri,
        mimeType: attachment.mimeType,
      },
    })),
  ];

  const userContent: GeminiContent = {
    id: crypto.randomUUID(),
    role: 'user',
    parts: userParts,
  };
  const branchStartNodeId = workingSession.branchTree?.activeLeafNodeId;
  if (!branchStartNodeId) {
    throw new Error('Failed to resolve active branch state.');
  }
  const userNodeId = appendContentsToBranch(workingSession, branchStartNodeId, [userContent]);
  if (!userNodeId) {
    throw new Error('Failed to append user message to active branch.');
  }

  const streamDeltaEmitter = createStreamDeltaEmitter(streamRequestId, sender);
  let assistantContent: GeminiContent;
  try {
    assistantContent = await completeAssistantTurnOnBranchNode({
      session: workingSession,
      targetNodeId: userNodeId,
      previousInteractionId: continuationInteractionId,
      settings,
      thinkingLevel,
      streamDeltaEmitter,
      dependencies,
    });
  } catch (error: unknown) {
    if (isInvalidPreviousInteractionIdError(error)) {
      if (baseSession.lastInteractionId) {
        const resetSession: ChatSession = structuredClone(baseSession);
        resetSession.lastInteractionId = undefined;
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
      ...(normalizedAttachments.length > 0 ? { attachments: normalizedAttachments } : {}),
    },
  };
}

async function handleForkChat(
  chatId: string,
  previousInteractionId: string,
  dependencies: RuntimeDependencies,
): Promise<ChatForkPayload> {
  const normalizedChatId = chatId.trim();
  const normalizedInteractionId = (previousInteractionId ?? '').trim();
  if (!normalizedChatId || !normalizedInteractionId) {
    throw new Error('Fork requires both a chat id and a target interaction id.');
  }

  const session = await dependencies.repository.getSession(normalizedChatId);
  if (!session) {
    throw new Error('Cannot fork a chat that does not exist.');
  }
  ensureBranchTree(session);
  const targetAssistantNodeId = findNodeIdByInteractionId(session, normalizedInteractionId);
  if (!targetAssistantNodeId) {
    throw new Error('Cannot fork: target assistant message was not found in this chat.');
  }
  if (!setActiveLeafNodeId(session, targetAssistantNodeId, false)) {
    throw new Error('Cannot fork: failed to activate target branch point.');
  }

  const now = dependencies.now();
  session.updatedAt = now.toISOString();
  await dependencies.repository.upsertSession(session, now.getTime());
  await pruneExpiredSessionsBestEffort(dependencies, now.getTime());
  return {
    chatId: session.id,
  };
}

async function handleSwitchBranch(
  chatId: string,
  interactionId: string,
  dependencies: RuntimeDependencies,
): Promise<ChatSwitchBranchPayload> {
  const normalizedChatId = chatId.trim();
  const normalizedInteractionId = interactionId.trim();
  if (!normalizedChatId || !normalizedInteractionId) {
    throw new Error('Branch switch requires both a chat id and an interaction id.');
  }

  const session = await dependencies.repository.getSession(normalizedChatId);
  if (!session) {
    throw new Error('Cannot switch branches in a chat that does not exist.');
  }

  ensureBranchTree(session);
  const targetAssistantNodeId = findNodeIdByInteractionId(session, normalizedInteractionId);
  if (!targetAssistantNodeId) {
    throw new Error('Cannot switch branch: target assistant message was not found in this chat.');
  }
  if (!setActiveLeafNodeId(session, targetAssistantNodeId, true)) {
    throw new Error('Cannot switch branch: failed to activate selected branch.');
  }

  const now = dependencies.now();
  session.updatedAt = now.toISOString();
  await dependencies.repository.upsertSession(session, now.getTime());
  await pruneExpiredSessionsBestEffort(dependencies, now.getTime());

  return {
    chatId: session.id,
  };
}

async function handleRegenerate(
  chatId: string,
  model: string,
  previousInteractionId: string,
  thinkingLevel: string | undefined,
  streamRequestId: string | undefined,
  sender: chrome.runtime.MessageSender | undefined,
  dependencies: RuntimeDependencies,
): Promise<ChatRegenPayload> {
  const normalizedChatId = chatId.trim();
  if (!normalizedChatId) {
    throw new Error('Regenerate requires a chat id.');
  }
  const normalizedInteractionId = (previousInteractionId ?? '').trim();
  if (!normalizedInteractionId) {
    throw new Error('Regenerate requires a target interaction id.');
  }

  const sourceSession = await dependencies.repository.getSession(normalizedChatId);
  if (!sourceSession) {
    throw new Error('Cannot regenerate in a chat that does not exist.');
  }
  ensureBranchTree(sourceSession);
  const targetAssistantNodeId = findNodeIdByInteractionId(sourceSession, normalizedInteractionId);
  if (!targetAssistantNodeId) {
    throw new Error('Cannot regenerate: target assistant message was not found.');
  }
  const promptUserNodeId = findRegeneratePromptUserNodeId(sourceSession, targetAssistantNodeId);
  if (!promptUserNodeId) {
    throw new Error('Cannot regenerate: no originating user prompt was found.');
  }

  const workingSession: ChatSession = structuredClone(sourceSession);
  ensureBranchTree(workingSession);
  const promptPrefixContents = getBranchContentsToNode(workingSession, promptUserNodeId);
  const promptContinuationInteractionId = findLastModelInteractionId(promptPrefixContents);

  const settings = await dependencies.readGeminiSettings();
  if (!settings.apiKey) {
    throw new Error('Gemini API key is missing. Add it in Speakeasy Settings.');
  }
  settings.model = model;

  const streamDeltaEmitter = createStreamDeltaEmitter(streamRequestId, sender);
  let assistantContent: GeminiContent;
  try {
    assistantContent = await completeAssistantTurnOnBranchNode({
      session: workingSession,
      targetNodeId: promptUserNodeId,
      previousInteractionId: promptContinuationInteractionId,
      settings,
      thinkingLevel,
      streamDeltaEmitter,
      dependencies,
    });
  } catch (error: unknown) {
    if (isInvalidPreviousInteractionIdError(error)) {
      throw new Error(EXPIRED_INTERACTION_MESSAGE);
    }
    throw error;
  }

  const now = dependencies.now();
  workingSession.updatedAt = now.toISOString();
  await dependencies.repository.upsertSession(workingSession, now.getTime());
  await pruneExpiredSessionsBestEffort(dependencies, now.getTime());

  return {
    chatId: workingSession.id,
    assistantMessage: toAssistantChatMessage(assistantContent),
  };
}

async function completeAssistantTurnOnBranchNode(input: {
  session: ChatSession;
  targetNodeId: string;
  previousInteractionId: string | undefined;
  settings: GeminiSettings;
  thinkingLevel: string | undefined;
  streamDeltaEmitter: ((delta: GeminiStreamDelta) => void) | undefined;
  dependencies: RuntimeDependencies;
}): Promise<GeminiContent> {
  const prefixContents = getBranchContentsToNode(input.session, input.targetNodeId);
  const workingSession: ChatSession = {
    id: input.session.id,
    ...(input.session.title ? { title: input.session.title } : {}),
    createdAt: input.session.createdAt,
    updatedAt: input.session.updatedAt,
    contents: prefixContents,
    ...(input.previousInteractionId ? { lastInteractionId: input.previousInteractionId } : {}),
  };

  const prefixLength = prefixContents.length;
  const assistantContent = await input.dependencies.completeAssistantTurn(
    workingSession,
    input.settings,
    input.thinkingLevel,
    input.streamDeltaEmitter,
  );
  const appendedContents = workingSession.contents.slice(prefixLength);
  if (appendedContents.length === 0) {
    throw new Error('Gemini did not append assistant output for branch continuation.');
  }

  appendContentsToBranch(input.session, input.targetNodeId, appendedContents);
  input.session.lastInteractionId = workingSession.lastInteractionId;
  input.session.contents = getActiveBranchContents(input.session);

  return assistantContent;
}

function countUserPromptNodes(session: ChatSession): number {
  const tree = ensureBranchTree(session);
  let count = 0;
  for (const node of Object.values(tree.nodes)) {
    if (node.content?.role === 'user' && isUserPromptContent(node.content)) {
      count += 1;
    }
  }
  return count;
}

function findRegeneratePromptUserNodeId(
  session: ChatSession,
  assistantNodeId: string,
): string | undefined {
  const tree = ensureBranchTree(session);
  const startNode = tree.nodes[assistantNodeId];
  if (!startNode || !startNode.parentNodeId) {
    return undefined;
  }

  let firstUserAncestor: string | undefined;
  let currentNodeId: string | undefined = startNode.parentNodeId;
  const visited = new Set<string>();
  while (currentNodeId && !visited.has(currentNodeId)) {
    visited.add(currentNodeId);
    const node: ChatBranchNode | undefined = tree.nodes[currentNodeId];
    if (!node) {
      break;
    }
    const content = node.content;
    if (content?.role === 'user') {
      firstUserAncestor ??= node.id;
      if (isUserPromptContent(content)) {
        return node.id;
      }
    }
    currentNodeId = node.parentNodeId;
  }

  return firstUserAncestor;
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
      pending.attachments,
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

  const sendOptions = typeof sender?.frameId === 'number' ? { frameId: sender.frameId } : undefined;
  const swallowDisconnect = () => {
    void chrome.runtime.lastError;
  };

  return (delta: GeminiStreamDelta) => {
    if (!delta.textDelta && !delta.thinkingDelta) {
      return;
    }

    const payload: ChatStreamDeltaEvent = {
      type: 'chat/stream-delta',
      requestId,
      ...(delta.textDelta ? { textDelta: delta.textDelta } : {}),
      ...(delta.thinkingDelta ? { thinkingDelta: delta.thinkingDelta } : {}),
    };

    try {
      if (sendOptions) {
        chrome.tabs.sendMessage(tabId, payload, sendOptions, swallowDisconnect);
      } else {
        chrome.tabs.sendMessage(tabId, payload, swallowDisconnect);
      }
    } catch {
      // Best-effort: don't fail the chat request lifecycle.
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
