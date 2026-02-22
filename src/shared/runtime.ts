import type { ChatMessage } from './messages';

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
