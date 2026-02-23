import { type RuntimeRequest, type RuntimeResponse, isRuntimeRequest } from '../shared/runtime';
import {
  GEMINI_SETTINGS_STORAGE_KEY,
  type GeminiSettings,
  normalizeGeminiSettings,
} from '../shared/settings';
import { createChatRepository } from './chat-repository';
import { bootstrapChatStorage } from './chat-storage-bootstrap';
import { captureFullPageScreenshot } from './full-page-screenshot';
import { type GeminiStreamDelta, completeAssistantTurn, generateSessionTitle } from './gemini';
import { createRuntimeBootstrapGate } from './runtime/bootstrap';
import type {
  RuntimeDependencies,
  RuntimePayload,
  RuntimeRequestContext,
} from './runtime/contracts';
import {
  handleForkChat,
  handleRegenerate,
  handleSwitchBranch,
} from './runtime/handlers/chat-branch';
import {
  handleDeleteChat,
  handleGetChatTabContext,
  handleListChats,
  handleLoadChat,
  handleNewChat,
} from './runtime/handlers/chat-crud';
import { handleSendMessage } from './runtime/handlers/chat-send';
import { handleUploadFiles } from './runtime/handlers/chat-upload';
import { routeRuntimeRequest } from './runtime/request-router';
import { generateAndPersistSessionTitle } from './runtime/title-generation';
import { uploadFilesToGemini as uploadFilesToGeminiInBackground } from './uploads';
import { toErrorMessage } from './utils';

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
    uploadFilesToGemini: (files, apiKey, uploadTimeoutMs) => {
      const options: Parameters<typeof uploadFilesToGeminiInBackground>[3] = {};
      if (typeof uploadTimeoutMs === 'number') {
        options.uploadTimeoutMs = uploadTimeoutMs;
      }

      return uploadFilesToGeminiInBackground(files, apiKey, {}, options);
    },
    captureFullPageScreenshot,
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
    if (
      request.type !== 'app/open-options' &&
      request.type !== 'tab/capture-full-page' &&
      request.type !== 'chat/get-tab-context'
    ) {
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
      handleCaptureFullPageScreenshot: async () => {
        const tabId = context?.sender?.tab?.id;
        if (!Number.isInteger(tabId) || !tabId || tabId <= 0) {
          throw new Error('Full-page screenshot capture requires an active browser tab.');
        }
        return dependencies.captureFullPageScreenshot(tabId);
      },
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
