export type MessageRole = 'assistant' | 'user';

export interface ChatAttachment {
  name: string;
  mimeType: string;
  fileUri?: string;
  previewUrl?: string;
  previewText?: string;
  uploadState?: 'uploading' | 'uploaded' | 'failed';
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
  turnTokensPerSecond?: number;
  outputTokensPerSecond?: number;
  hasStreamingToken: boolean;
}

export interface GroundingSource {
  title: string;
  url: string;
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
  groundingSources?: GroundingSource[];
  timestamp?: number;
}
