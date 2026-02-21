import type { ChatMessage } from './messages';

export interface FileDataAttachmentPayload {
  name: string;
  mimeType: string;
  fileUri: string;
  fileName?: string;
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

export interface OpenOptionsPayload {
  opened: true;
}

export interface ChatStreamDeltaEvent {
  type: 'chat/stream-delta';
  requestId: string;
  textDelta?: string;
  thinkingDelta?: string;
}

export type RuntimePushEvent = ChatStreamDeltaEvent;
