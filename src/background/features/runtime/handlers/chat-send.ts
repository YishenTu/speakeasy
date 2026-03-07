import type { FileDataAttachmentPayload } from '../../../../shared/runtime';
import { resolveSlashCommandText } from '../../../../shared/slash-commands';
import { isInvalidPreviousInteractionIdError } from '../../gemini/gemini';
import {
  appendContentsToBranch,
  createSession,
  ensureBranchTree,
  toAssistantChatMessage,
} from '../../session/sessions';
import type { ChatSession, GeminiContent } from '../../session/types';
import { completeAssistantTurnOnBranchNode } from '../assistant-branch';
import {
  buildAttachmentPreviewByFileUri,
  buildAttachmentPreviewTextByFileUri,
  normalizeFileDataAttachments,
} from '../attachments';
import { pruneExpiredSessionsBestEffort } from '../bootstrap';
import type {
  PendingSessionTitleGeneration,
  RuntimeDependencies,
  SendMessageResult,
} from '../contracts';
import { createStreamDeltaEmitter } from '../stream-delta';
import { EXPIRED_INTERACTION_MESSAGE, countUserPromptNodes } from './chat-branch';

export async function handleSendMessage(
  text: string,
  chatId: string | undefined,
  model: string | undefined,
  thinkingLevel: string | undefined,
  streamRequestId: string | undefined,
  sender: chrome.runtime.MessageSender | undefined,
  attachments: FileDataAttachmentPayload[] | undefined,
  dependencies: RuntimeDependencies,
): Promise<SendMessageResult> {
  const normalizedDisplayText = text.trim();
  const normalizedAttachments = normalizeFileDataAttachments(attachments);

  const settings = await dependencies.readGeminiSettings();
  if (!settings.apiKey) {
    throw new Error('Gemini API key is missing. Add it in Speakeasy Settings.');
  }

  const resolvedUserText = resolveSlashCommandText(normalizedDisplayText, settings.slashCommands);
  const normalizedText = resolvedUserText.resolvedText.trim();
  if (!normalizedText && normalizedAttachments.length === 0) {
    throw new Error('Cannot send an empty message.');
  }

  if (model) {
    settings.model = model;
  }

  const persistedSession = chatId ? await dependencies.repository.getSession(chatId) : null;
  const baseSession = persistedSession ?? createSession();
  ensureBranchTree(baseSession);
  const shouldGenerateTitle = countUserPromptNodes(baseSession) === 0 && !baseSession.title;
  const workingSession: ChatSession = structuredClone(baseSession);
  ensureBranchTree(workingSession);
  const continuationInteractionId = workingSession.lastInteractionId;

  const userParts = [
    ...(normalizedText ? [{ text: normalizedText }] : []),
    ...normalizedAttachments.map((attachment) => ({
      fileData: {
        fileUri: attachment.fileUri,
        mimeType: attachment.mimeType,
        displayName: attachment.name,
      },
    })),
  ];

  const userContent: GeminiContent = {
    id: crypto.randomUUID(),
    role: 'user',
    parts: userParts,
  };
  const shouldPersistDisplayText =
    !!resolvedUserText.command && normalizedDisplayText !== normalizedText;
  const userMetadata: NonNullable<GeminiContent['metadata']> = {};
  if (shouldPersistDisplayText) {
    userMetadata.userDisplayText = normalizedDisplayText;
  }
  const attachmentPreviewByFileUri = buildAttachmentPreviewByFileUri(normalizedAttachments);
  const attachmentPreviewTextByFileUri = buildAttachmentPreviewTextByFileUri(normalizedAttachments);
  const hasImagePreviews = Object.keys(attachmentPreviewByFileUri).length > 0;
  const hasTextPreviews = Object.keys(attachmentPreviewTextByFileUri).length > 0;
  if (hasImagePreviews) {
    userMetadata.attachmentPreviewByFileUri = attachmentPreviewByFileUri;
  }
  if (hasTextPreviews) {
    userMetadata.attachmentPreviewTextByFileUri = attachmentPreviewTextByFileUri;
  }
  if (Object.keys(userMetadata).length > 0) {
    userContent.metadata = userMetadata;
  }
  const branchStartNodeId = workingSession.branchTree?.activeLeafNodeId;
  if (!branchStartNodeId) {
    throw new Error('Failed to resolve active branch state.');
  }
  const userNodeId = appendContentsToBranch(workingSession, branchStartNodeId, [userContent]);
  if (!userNodeId) {
    throw new Error('Failed to append user message to active branch.');
  }

  const streamDeltaEmitter = createStreamDeltaEmitter(streamRequestId, sender);
  let assistantContent: GeminiContent;
  try {
    assistantContent = await completeAssistantTurnOnBranchNode({
      session: workingSession,
      targetNodeId: userNodeId,
      previousInteractionId: continuationInteractionId,
      settings,
      thinkingLevel,
      streamDeltaEmitter,
      dependencies,
    });
  } catch (error: unknown) {
    if (isInvalidPreviousInteractionIdError(error)) {
      if (baseSession.lastInteractionId) {
        const resetSession: ChatSession = structuredClone(baseSession);
        resetSession.lastInteractionId = undefined;
        const now = dependencies.now();
        try {
          await dependencies.repository.upsertSession(resetSession, now.getTime());
        } catch (resetError: unknown) {
          throw new Error('Failed to reset expired conversation context.', { cause: resetError });
        }
        await pruneExpiredSessionsBestEffort(dependencies, now.getTime());
      }
      throw new Error(EXPIRED_INTERACTION_MESSAGE);
    }
    throw error;
  }

  const now = dependencies.now();
  workingSession.updatedAt = now.toISOString();
  await dependencies.repository.upsertSession(workingSession, now.getTime());
  await pruneExpiredSessionsBestEffort(dependencies, now.getTime());

  const payload = {
    chatId: workingSession.id,
    assistantMessage: toAssistantChatMessage(assistantContent),
  };

  if (!shouldGenerateTitle) {
    return { payload };
  }

  const pendingTitleGeneration: PendingSessionTitleGeneration = {
    chatId: workingSession.id,
    apiKey: settings.apiKey,
    firstUserQuery: normalizedDisplayText || normalizedText,
  };
  if (normalizedAttachments.length > 0) {
    pendingTitleGeneration.attachments = normalizedAttachments;
  }

  return {
    payload,
    pendingTitleGeneration,
  };
}
