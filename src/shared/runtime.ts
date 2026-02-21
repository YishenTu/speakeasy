import type { ChatMessage } from './chat';

export type RuntimeRequest =
  | {
      type: 'chat/send';
      text: string;
      chatId?: string;
    }
  | {
      type: 'chat/load';
      chatId?: string;
    }
  | {
      type: 'chat/new';
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

export interface OpenOptionsPayload {
  opened: true;
}
