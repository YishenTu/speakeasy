import type { ChatMessage } from './messages';
import { isRecord } from './utils';

export interface FileDataAttachmentPayload {
  name: string;
  mimeType: string;
  fileUri: string;
  fileName?: string;
  previewDataUrl?: string;
}

export interface UploadFilePayload {
  name: string;
  mimeType: string;
  bytes: ArrayBuffer;
}

export interface UploadFileTransportPayload {
  name: string;
  mimeType: string;
  bytesBase64: string;
}

export interface ChatUploadFailurePayload {
  index: number;
  fileName: string;
  message: string;
}

export type RuntimeRequest =
  | {
      type: 'chat/send';
      text: string;
      chatId?: string;
      model: string;
      thinkingLevel?: string;
      streamRequestId?: string;
      attachments?: FileDataAttachmentPayload[];
    }
  | {
      type: 'chat/regen';
      chatId: string;
      model: string;
      previousInteractionId: string;
      thinkingLevel?: string;
      streamRequestId?: string;
    }
  | {
      type: 'chat/fork';
      chatId: string;
      previousInteractionId: string;
    }
  | {
      type: 'chat/switch-branch';
      chatId: string;
      interactionId: string;
    }
  | {
      type: 'chat/load';
      chatId?: string;
    }
  | {
      type: 'chat/new';
    }
  | {
      type: 'chat/delete';
      chatId: string;
    }
  | {
      type: 'chat/list';
    }
  | {
      type: 'chat/upload-files';
      files: UploadFileTransportPayload[];
      uploadTimeoutMs?: number;
    }
  | {
      type: 'app/open-options';
    };

const RUNTIME_REQUEST_TYPE_LOOKUP: Record<RuntimeRequest['type'], true> = {
  'chat/send': true,
  'chat/regen': true,
  'chat/fork': true,
  'chat/switch-branch': true,
  'chat/load': true,
  'chat/new': true,
  'chat/delete': true,
  'chat/list': true,
  'chat/upload-files': true,
  'app/open-options': true,
};

export function isRuntimeRequestType(value: unknown): value is RuntimeRequest['type'] {
  return typeof value === 'string' && value in RUNTIME_REQUEST_TYPE_LOOKUP;
}

export function isRuntimeRequest(value: unknown): value is RuntimeRequest {
  return isRecord(value) && isRuntimeRequestType(value.type);
}

export interface RuntimeSuccess<TPayload> {
  ok: true;
  payload: TPayload;
}

export interface RuntimeFailure {
  ok: false;
  error: string;
}

export type RuntimeResponse<TPayload> = RuntimeSuccess<TPayload> | RuntimeFailure;

export interface ChatSendPayload {
  chatId: string;
  assistantMessage: ChatMessage;
}

export interface ChatRegenPayload {
  chatId: string;
  assistantMessage: ChatMessage;
}

export interface ChatForkPayload {
  chatId: string;
}

export interface ChatSwitchBranchPayload {
  chatId: string;
}

export interface ChatLoadPayload {
  chatId: string | null;
  messages: ChatMessage[];
}

export interface ChatNewPayload {
  chatId: string;
}

export interface ChatDeletePayload {
  deleted: boolean;
  chatId: null;
}

export interface ChatSessionSummary {
  chatId: string;
  title: string;
  updatedAt: string;
}

export interface ChatListPayload {
  sessions: ChatSessionSummary[];
}

export interface ChatUploadFilesPayload {
  attachments: FileDataAttachmentPayload[];
  failures: ChatUploadFailurePayload[];
}

export interface OpenOptionsPayload {
  opened: true;
}

export interface ChatStreamDeltaEvent {
  type: 'chat/stream-delta';
  requestId: string;
  textDelta?: string;
  thinkingDelta?: string;
}
