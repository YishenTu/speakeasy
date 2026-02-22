import type { AssistantResponseStats } from '../shared/messages';

export interface GeminiContent {
  id?: string;
  role: 'user' | 'model';
  parts: GeminiPart[];
  metadata?: GeminiContentMetadata;
}

export type GeminiPart = Record<string, unknown>;

export interface GeminiContentMetadata {
  responseStats?: AssistantResponseStats;
  interactionId?: string;
  sourceModel?: string;
  createdAt?: string;
}

export interface GeminiFunctionCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatBranchNode {
  id: string;
  parentNodeId?: string;
  childNodeIds: string[];
  content?: GeminiContent;
}

export interface ChatBranchTree {
  rootNodeId: string;
  activeLeafNodeId: string;
  nodes: Record<string, ChatBranchNode>;
}

export interface ChatSession {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  contents: GeminiContent[];
  lastInteractionId?: string | undefined;
  branchTree?: ChatBranchTree;
}
