export type MessageRole = 'assistant' | 'user';

export interface ChatAttachment {
  name: string;
  mimeType: string;
  fileUri?: string;
  previewUrl?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  thinkingSummary?: string;
  attachments?: ChatAttachment[];
}
