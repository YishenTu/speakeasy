import type { GeminiSettings } from '../../shared/settings';
import type { GeminiStreamDelta } from '../gemini';
import {
  appendContentsToBranch,
  getActiveBranchContents,
  getBranchContentsToNode,
} from '../sessions';
import type { ChatSession, GeminiContent } from '../types';
import type { RuntimeDependencies } from './contracts';

export async function completeAssistantTurnOnBranchNode(input: {
  session: ChatSession;
  targetNodeId: string;
  previousInteractionId: string | undefined;
  settings: GeminiSettings;
  thinkingLevel: string | undefined;
  streamDeltaEmitter: ((delta: GeminiStreamDelta) => void) | undefined;
  dependencies: RuntimeDependencies;
}): Promise<GeminiContent> {
  const prefixContents = getBranchContentsToNode(input.session, input.targetNodeId);
  const workingSession: ChatSession = {
    id: input.session.id,
    createdAt: input.session.createdAt,
    updatedAt: input.session.updatedAt,
    contents: prefixContents,
  };
  if (input.session.title) {
    workingSession.title = input.session.title;
  }
  if (input.previousInteractionId) {
    workingSession.lastInteractionId = input.previousInteractionId;
  }

  const prefixLength = prefixContents.length;
  const assistantContent = await input.dependencies.completeAssistantTurn(
    workingSession,
    input.settings,
    input.thinkingLevel,
    input.streamDeltaEmitter,
  );
  const appendedContents = workingSession.contents.slice(prefixLength);
  if (appendedContents.length === 0) {
    throw new Error('Gemini did not append assistant output for branch continuation.');
  }

  appendContentsToBranch(input.session, input.targetNodeId, appendedContents);
  input.session.lastInteractionId = workingSession.lastInteractionId;
  input.session.contents = getActiveBranchContents(input.session);

  return assistantContent;
}
