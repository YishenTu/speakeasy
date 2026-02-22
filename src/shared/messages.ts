export type MessageRole = 'assistant' | 'user';

export interface ChatAttachment {
  name: string;
  mimeType: string;
  fileUri?: string;
  previewUrl?: string;
}

export interface AssistantResponseStats {
  requestDurationMs: number;
  timeToFirstTokenMs: number;
  outputTokens?: number;
  inputTokens?: number;
  thoughtTokens?: number;
  toolUseTokens?: number;
  cachedTokens?: number;
  totalTokens?: number;
  outputTokensPerSecond?: number;
  totalTokensPerSecond?: number;
  hasStreamingToken: boolean;
}

export interface ChatMessage {
  id: string;
  interactionId?: string;
  previousInteractionId?: string;
  branchOptionInteractionIds?: string[];
  branchOptionIndex?: number;
  branchOptionCount?: number;
  role: MessageRole;
  content: string;
  thinkingSummary?: string;
  stats?: AssistantResponseStats;
  attachments?: ChatAttachment[];
  sourceModel?: string;
  timestamp?: number;
}
