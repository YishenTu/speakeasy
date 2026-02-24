import type {
  ChatForkPayload,
  ChatRegenPayload,
  ChatSwitchBranchPayload,
} from '../../../../shared/runtime';
import { isInvalidPreviousInteractionIdError } from '../../gemini/gemini';
import {
  ensureBranchTree,
  findLastModelInteractionId,
  findNodeIdByInteractionId,
  getBranchContentsToNode,
  isUserPromptContent,
  setActiveLeafNodeId,
  toAssistantChatMessage,
} from '../../session/sessions';
import type { ChatBranchNode, ChatSession, GeminiContent } from '../../session/types';
import { completeAssistantTurnOnBranchNode } from '../assistant-branch';
import { pruneExpiredSessionsBestEffort } from '../bootstrap';
import type { RuntimeDependencies } from '../contracts';
import { createStreamDeltaEmitter } from '../stream-delta';

export const EXPIRED_INTERACTION_MESSAGE =
  'Conversation context expired. Please resend your last message to continue.';

export async function handleForkChat(
  chatId: string,
  previousInteractionId: string,
  dependencies: RuntimeDependencies,
): Promise<ChatForkPayload> {
  const normalizedChatId = chatId.trim();
  const normalizedInteractionId = (previousInteractionId ?? '').trim();
  if (!normalizedChatId || !normalizedInteractionId) {
    throw new Error('Fork requires both a chat id and a target interaction id.');
  }

  const session = await dependencies.repository.getSession(normalizedChatId);
  if (!session) {
    throw new Error('Cannot fork a chat that does not exist.');
  }
  ensureBranchTree(session);
  const targetAssistantNodeId = findNodeIdByInteractionId(session, normalizedInteractionId);
  if (!targetAssistantNodeId) {
    throw new Error('Cannot fork: target assistant message was not found in this chat.');
  }
  if (!setActiveLeafNodeId(session, targetAssistantNodeId, false)) {
    throw new Error('Cannot fork: failed to activate target branch point.');
  }

  const now = dependencies.now();
  session.updatedAt = now.toISOString();
  await dependencies.repository.upsertSession(session, now.getTime());
  await pruneExpiredSessionsBestEffort(dependencies, now.getTime());
  return {
    chatId: session.id,
  };
}

export async function handleSwitchBranch(
  chatId: string,
  interactionId: string,
  dependencies: RuntimeDependencies,
): Promise<ChatSwitchBranchPayload> {
  const normalizedChatId = chatId.trim();
  const normalizedInteractionId = interactionId.trim();
  if (!normalizedChatId || !normalizedInteractionId) {
    throw new Error('Branch switch requires both a chat id and an interaction id.');
  }

  const session = await dependencies.repository.getSession(normalizedChatId);
  if (!session) {
    throw new Error('Cannot switch branches in a chat that does not exist.');
  }

  ensureBranchTree(session);
  const targetAssistantNodeId = findNodeIdByInteractionId(session, normalizedInteractionId);
  if (!targetAssistantNodeId) {
    throw new Error('Cannot switch branch: target assistant message was not found in this chat.');
  }
  if (!setActiveLeafNodeId(session, targetAssistantNodeId, true)) {
    throw new Error('Cannot switch branch: failed to activate selected branch.');
  }

  const now = dependencies.now();
  session.updatedAt = now.toISOString();
  await dependencies.repository.upsertSession(session, now.getTime());
  await pruneExpiredSessionsBestEffort(dependencies, now.getTime());

  return {
    chatId: session.id,
  };
}

export async function handleRegenerate(
  chatId: string,
  model: string,
  previousInteractionId: string,
  thinkingLevel: string | undefined,
  streamRequestId: string | undefined,
  sender: chrome.runtime.MessageSender | undefined,
  dependencies: RuntimeDependencies,
): Promise<ChatRegenPayload> {
  const normalizedChatId = chatId.trim();
  if (!normalizedChatId) {
    throw new Error('Regenerate requires a chat id.');
  }
  const normalizedInteractionId = (previousInteractionId ?? '').trim();
  if (!normalizedInteractionId) {
    throw new Error('Regenerate requires a target interaction id.');
  }

  const sourceSession = await dependencies.repository.getSession(normalizedChatId);
  if (!sourceSession) {
    throw new Error('Cannot regenerate in a chat that does not exist.');
  }
  ensureBranchTree(sourceSession);
  const targetAssistantNodeId = findNodeIdByInteractionId(sourceSession, normalizedInteractionId);
  if (!targetAssistantNodeId) {
    throw new Error('Cannot regenerate: target assistant message was not found.');
  }
  const promptUserNodeId = findRegeneratePromptUserNodeId(sourceSession, targetAssistantNodeId);
  if (!promptUserNodeId) {
    throw new Error('Cannot regenerate: no originating user prompt was found.');
  }

  const workingSession: ChatSession = structuredClone(sourceSession);
  ensureBranchTree(workingSession);
  const promptPrefixContents = getBranchContentsToNode(workingSession, promptUserNodeId);
  const promptContinuationInteractionId = findLastModelInteractionId(promptPrefixContents);

  const settings = await dependencies.readGeminiSettings();
  if (!settings.apiKey) {
    throw new Error('Gemini API key is missing. Add it in Speakeasy Settings.');
  }
  settings.model = model;

  const streamDeltaEmitter = createStreamDeltaEmitter(streamRequestId, sender);
  let assistantContent: GeminiContent;
  try {
    assistantContent = await completeAssistantTurnOnBranchNode({
      session: workingSession,
      targetNodeId: promptUserNodeId,
      previousInteractionId: promptContinuationInteractionId,
      settings,
      thinkingLevel,
      streamDeltaEmitter,
      dependencies,
    });
  } catch (error: unknown) {
    if (isInvalidPreviousInteractionIdError(error)) {
      throw new Error(EXPIRED_INTERACTION_MESSAGE);
    }
    throw error;
  }

  const now = dependencies.now();
  workingSession.updatedAt = now.toISOString();
  await dependencies.repository.upsertSession(workingSession, now.getTime());
  await pruneExpiredSessionsBestEffort(dependencies, now.getTime());

  return {
    chatId: workingSession.id,
    assistantMessage: toAssistantChatMessage(assistantContent),
  };
}

export function countUserPromptNodes(session: ChatSession): number {
  const tree = ensureBranchTree(session);
  let count = 0;
  for (const node of Object.values(tree.nodes)) {
    if (node.content?.role === 'user' && isUserPromptContent(node.content)) {
      count += 1;
    }
  }
  return count;
}

export function findRegeneratePromptUserNodeId(
  session: ChatSession,
  assistantNodeId: string,
): string | undefined {
  const tree = ensureBranchTree(session);
  const startNode = tree.nodes[assistantNodeId];
  if (!startNode || !startNode.parentNodeId) {
    return undefined;
  }

  let firstUserAncestor: string | undefined;
  let currentNodeId: string | undefined = startNode.parentNodeId;
  const visited = new Set<string>();
  while (currentNodeId && !visited.has(currentNodeId)) {
    visited.add(currentNodeId);
    const node: ChatBranchNode | undefined = tree.nodes[currentNodeId];
    if (!node) {
      break;
    }
    const content = node.content;
    if (content?.role === 'user') {
      firstUserAncestor ??= node.id;
      if (isUserPromptContent(content)) {
        return node.id;
      }
    }
    currentNodeId = node.parentNodeId;
  }

  return firstUserAncestor;
}
