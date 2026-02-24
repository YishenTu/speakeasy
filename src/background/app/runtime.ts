import { type RuntimeRequest, type RuntimeResponse, isRuntimeRequest } from '../../shared/runtime';
import {
  GEMINI_SETTINGS_STORAGE_KEY,
  type GeminiSettings,
  normalizeGeminiSettings,
} from '../../shared/settings';
import { toErrorMessage } from '../core/utils';
import { createChatRepository } from '../features/chat-storage/chat-repository';
import { bootstrapChatStorage } from '../features/chat-storage/chat-storage-bootstrap';
import {
  type GeminiStreamDelta,
  completeAssistantTurn,
  generateSessionTitle,
} from '../features/gemini/gemini';
import { createRuntimeBootstrapGate } from '../features/runtime/bootstrap';
import type {
  RuntimeDependencies,
  RuntimePayload,
  RuntimeRequestContext,
} from '../features/runtime/contracts';
import {
  handleForkChat,
  handleRegenerate,
  handleSwitchBranch,
} from '../features/runtime/handlers/chat-branch';
import {
  handleDeleteChat,
  handleGetChatTabContext,
  handleListChats,
  handleLoadChat,
  handleNewChat,
} from '../features/runtime/handlers/chat-crud';
import { handleSendMessage } from '../features/runtime/handlers/chat-send';
import { handleUploadFiles } from '../features/runtime/handlers/chat-upload';
import {
  handleCaptureFullPageScreenshot,
  handleCaptureFullPageScreenshotById,
  handleExtractTextById,
} from '../features/runtime/handlers/tab-capture';
import { handleListOpenTabs } from '../features/runtime/handlers/tab-list';
import { routeRuntimeRequest } from '../features/runtime/request-router';
import { generateAndPersistSessionTitle } from '../features/runtime/title-generation';
import { captureFullPageScreenshot } from '../features/tab/full-page-screenshot';
import { extractTabTextById } from '../features/tab/tab-text-extraction';
import { uploadFilesToGemini as uploadFilesToGeminiInBackground } from '../features/uploads/uploads';

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

const BOOTSTRAP_BYPASS_TYPES: ReadonlySet<string> = new Set([
  'app/open-options',
  'chat/get-tab-context',
  'tab/capture-full-page',
  'tab/capture-full-page-by-id',
  'tab/extract-text-by-id',
  'tab/list-open',
]);

export function createRuntimeRequestHandler(
  overrides: Partial<RuntimeDependencies> = {},
): (request: RuntimeRequest, context?: RuntimeRequestContext) => Promise<RuntimePayload> {
  const dependencies: RuntimeDependencies = {
    repository: createChatRepository(),
    bootstrapChatStorage,
    readGeminiSettings,
    completeAssistantTurn,
    generateSessionTitle,
    uploadFilesToGemini: (files, apiKey, uploadTimeoutMs) => {
      const options: Parameters<typeof uploadFilesToGeminiInBackground>[3] = {};
      if (typeof uploadTimeoutMs === 'number') {
        options.uploadTimeoutMs = uploadTimeoutMs;
      }

      return uploadFilesToGeminiInBackground(files, apiKey, {}, options);
    },
    captureFullPageScreenshot,
    extractTabTextById,
    openOptionsPage,
    now: () => new Date(),
    ...overrides,
  };

  let mutationQueue: Promise<void> = Promise.resolve();
  const enqueueMutation = <TPayload>(operation: () => Promise<TPayload>): Promise<TPayload> => {
    const task = mutationQueue.then(operation);
    mutationQueue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  };

  const bootstrapGate = createRuntimeBootstrapGate(dependencies);

  return async (
    request: RuntimeRequest,
    context?: RuntimeRequestContext,
  ): Promise<RuntimePayload> => {
    if (!BOOTSTRAP_BYPASS_TYPES.has(request.type)) {
      await bootstrapGate.ensureReady();
    }

    return routeRuntimeRequest({
      request,
      handleOpenOptions: async () => {
        await dependencies.openOptionsPage();
        return {
          opened: true,
        };
      },
      handleGetChatTabContext: async () => handleGetChatTabContext(context),
      handleLoadChat: async (chatId) => {
        await mutationQueue;
        return handleLoadChat(chatId, dependencies);
      },
      handleNewChat: () => enqueueMutation(() => handleNewChat(dependencies)),
      handleSendMessage: (sendRequest) =>
        enqueueMutation(async () => {
          const result = await handleSendMessage(
            sendRequest.text,
            sendRequest.chatId,
            sendRequest.model,
            sendRequest.thinkingLevel,
            sendRequest.streamRequestId,
            context?.sender,
            sendRequest.attachments,
            dependencies,
          );

          if (result.pendingTitleGeneration) {
            void generateAndPersistSessionTitle(
              result.pendingTitleGeneration,
              dependencies,
              enqueueMutation,
            ).catch((error: unknown) => {
              console.warn('Unexpected failure while generating chat session title.', error);
            });
          }

          return result.payload;
        }),
      handleRegenerate: (regenRequest) =>
        enqueueMutation(() =>
          handleRegenerate(
            regenRequest.chatId,
            regenRequest.model,
            regenRequest.previousInteractionId,
            regenRequest.thinkingLevel,
            regenRequest.streamRequestId,
            context?.sender,
            dependencies,
          ),
        ),
      handleForkChat: (forkRequest) =>
        enqueueMutation(() =>
          handleForkChat(forkRequest.chatId, forkRequest.previousInteractionId, dependencies),
        ),
      handleSwitchBranch: (switchRequest) =>
        enqueueMutation(() =>
          handleSwitchBranch(switchRequest.chatId, switchRequest.interactionId, dependencies),
        ),
      handleDeleteChat: (chatId) => enqueueMutation(() => handleDeleteChat(chatId, dependencies)),
      handleListChats: async () => {
        await mutationQueue;
        return handleListChats(dependencies);
      },
      handleUploadFiles: (uploadRequest) =>
        handleUploadFiles(uploadRequest.files, uploadRequest.uploadTimeoutMs, dependencies),
      handleListOpenTabs: () => handleListOpenTabs(),
      handleCaptureFullPageScreenshot: async () =>
        handleCaptureFullPageScreenshot(context, dependencies),
      handleCaptureFullPageScreenshotById: async (captureRequest) =>
        handleCaptureFullPageScreenshotById(captureRequest, dependencies),
      handleExtractTextById: async (extractRequest) =>
        handleExtractTextById(extractRequest, dependencies),
    });
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
