import type {
  ChatDeletePayload,
  ChatForkPayload,
  ChatListPayload,
  ChatLoadPayload,
  ChatNewPayload,
  ChatRegenPayload,
  ChatSendPayload,
  ChatSwitchBranchPayload,
  ChatTabContextPayload,
  ChatUploadFilesPayload,
  FileDataAttachmentPayload,
  OpenOptionsPayload,
  RuntimeRequest,
  TabCaptureFullPagePayload,
  TabListOpenPayload,
  UploadFilePayload,
} from '../../shared/runtime';
import type { GeminiSettings } from '../../shared/settings';
import type { ChatRepository } from '../chat-repository';
import type { GeminiStreamDelta } from '../gemini';
import type { ChatSession, GeminiContent } from '../types';

export type RuntimePayload =
  | ChatTabContextPayload
  | ChatLoadPayload
  | ChatNewPayload
  | ChatSendPayload
  | ChatRegenPayload
  | ChatForkPayload
  | ChatSwitchBranchPayload
  | ChatDeletePayload
  | ChatListPayload
  | ChatUploadFilesPayload
  | TabCaptureFullPagePayload
  | TabListOpenPayload
  | OpenOptionsPayload;

export interface RuntimeDependencies {
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
  uploadFilesToGemini: (
    files: UploadFilePayload[],
    apiKey: string,
    uploadTimeoutMs?: number,
  ) => Promise<ChatUploadFilesPayload>;
  captureFullPageScreenshot: (tabId: number) => Promise<TabCaptureFullPagePayload>;
  openOptionsPage: () => Promise<void>;
  now: () => Date;
}

export interface RuntimeRequestContext {
  sender?: chrome.runtime.MessageSender;
}

export interface PendingSessionTitleGeneration {
  chatId: string;
  apiKey: string;
  firstUserQuery: string;
  attachments?: FileDataAttachmentPayload[];
}

export interface SendMessageResult {
  payload: ChatSendPayload;
  pendingTitleGeneration?: PendingSessionTitleGeneration;
}

export type MutationEnqueuer = <TPayload>(operation: () => Promise<TPayload>) => Promise<TPayload>;

export interface RuntimeRequestRoutingInput {
  request: RuntimeRequest;
  handleOpenOptions: () => Promise<OpenOptionsPayload>;
  handleGetChatTabContext: () => Promise<ChatTabContextPayload>;
  handleLoadChat: (chatId: string | undefined) => Promise<ChatLoadPayload>;
  handleNewChat: () => Promise<ChatNewPayload>;
  handleSendMessage: (
    request: Extract<RuntimeRequest, { type: 'chat/send' }>,
  ) => Promise<ChatSendPayload>;
  handleRegenerate: (
    request: Extract<RuntimeRequest, { type: 'chat/regen' }>,
  ) => Promise<ChatRegenPayload>;
  handleForkChat: (
    request: Extract<RuntimeRequest, { type: 'chat/fork' }>,
  ) => Promise<ChatForkPayload>;
  handleSwitchBranch: (
    request: Extract<RuntimeRequest, { type: 'chat/switch-branch' }>,
  ) => Promise<ChatSwitchBranchPayload>;
  handleDeleteChat: (chatId: string) => Promise<ChatDeletePayload>;
  handleListChats: () => Promise<ChatListPayload>;
  handleUploadFiles: (
    request: Extract<RuntimeRequest, { type: 'chat/upload-files' }>,
  ) => Promise<ChatUploadFilesPayload>;
  handleListOpenTabs: () => Promise<TabListOpenPayload>;
  handleCaptureFullPageScreenshot: () => Promise<TabCaptureFullPagePayload>;
  handleCaptureFullPageScreenshotById: (
    request: Extract<RuntimeRequest, { type: 'tab/capture-full-page-by-id' }>,
  ) => Promise<TabCaptureFullPagePayload>;
}
