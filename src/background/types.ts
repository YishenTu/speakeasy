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
  // Root node keeps content undefined. Message nodes keep a Gemini payload.
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
  // Active-branch linear snapshot used by Gemini interaction execution.
  contents: GeminiContent[];
  // Last assistant interaction id for the active branch.
  lastInteractionId?: string | undefined;
  // In-session conversation tree for fork/regen branch navigation.
  branchTree?: ChatBranchTree;
}
