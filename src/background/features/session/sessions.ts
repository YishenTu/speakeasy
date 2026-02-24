import type { ChatMessage } from '../../../shared/chat';
import type { ChatAttachment } from '../../../shared/messages';
import { isRecord } from '../../core/utils';
import {
  extractAttachments,
  renderContentForChat,
  renderThinkingSummaryForChat,
} from '../gemini/gemini';
import type { ChatBranchNode, ChatBranchTree, ChatSession, GeminiContent } from './types';

export function createSession(): ChatSession {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const rootNodeId = crypto.randomUUID();

  return {
    id,
    createdAt: now,
    updatedAt: now,
    contents: [],
    branchTree: {
      rootNodeId,
      activeLeafNodeId: rootNodeId,
      nodes: {
        [rootNodeId]: {
          id: rootNodeId,
          childNodeIds: [],
        },
      },
    },
  };
}

export function ensureBranchTree(session: ChatSession): ChatBranchTree {
  const existing = session.branchTree;
  if (existing && isValidBranchTree(existing)) {
    normalizeBranchTree(existing);
    return existing;
  }

  const rootNodeId = crypto.randomUUID();
  const nodes: Record<string, ChatBranchNode> = {
    [rootNodeId]: {
      id: rootNodeId,
      childNodeIds: [],
    },
  };

  let parentNodeId = rootNodeId;
  for (const content of session.contents) {
    const nodeId = crypto.randomUUID();
    nodes[nodeId] = {
      id: nodeId,
      parentNodeId,
      childNodeIds: [],
      content: cloneGeminiContent(content),
    };
    nodes[parentNodeId]?.childNodeIds.push(nodeId);
    parentNodeId = nodeId;
  }

  session.branchTree = {
    rootNodeId,
    activeLeafNodeId: parentNodeId,
    nodes,
  };
  return session.branchTree;
}

export function cloneGeminiContent(content: GeminiContent): GeminiContent {
  const cloned: GeminiContent = {
    role: content.role,
    parts: content.parts.map((part) => ({ ...part })),
  };
  if (content.id) {
    cloned.id = content.id;
  }
  if (content.metadata) {
    cloned.metadata = structuredClone(content.metadata);
  }

  return cloned;
}

export function appendContentsToBranch(
  session: ChatSession,
  parentNodeId: string,
  contents: readonly GeminiContent[],
): string | undefined {
  const tree = ensureBranchTree(session);
  if (!tree.nodes[parentNodeId]) {
    throw new Error('Cannot append to a branch node that does not exist.');
  }

  if (contents.length === 0) {
    return undefined;
  }

  let currentParentNodeId = parentNodeId;
  for (const content of contents) {
    const nodeId = crypto.randomUUID();
    tree.nodes[nodeId] = {
      id: nodeId,
      parentNodeId: currentParentNodeId,
      childNodeIds: [],
      content: cloneGeminiContent(content),
    };
    tree.nodes[currentParentNodeId]?.childNodeIds.push(nodeId);
    currentParentNodeId = nodeId;
  }

  tree.activeLeafNodeId = currentParentNodeId;
  rebuildActiveBranchSnapshot(session);
  return currentParentNodeId;
}

export function setActiveLeafNodeId(
  session: ChatSession,
  nodeId: string,
  followLatestDescendant = true,
): boolean {
  const tree = ensureBranchTree(session);
  const normalizedNodeId = nodeId.trim();
  if (!normalizedNodeId || !tree.nodes[normalizedNodeId]) {
    return false;
  }

  const activeLeafNodeId = followLatestDescendant
    ? findDeepestLeafNodeId(tree, normalizedNodeId)
    : normalizedNodeId;
  tree.activeLeafNodeId = activeLeafNodeId;
  rebuildActiveBranchSnapshot(session);
  return true;
}

export function findNodeIdByInteractionId(
  session: ChatSession,
  interactionId: string,
): string | undefined {
  const normalizedInteractionId = interactionId.trim();
  if (!normalizedInteractionId) {
    return undefined;
  }

  const tree = ensureBranchTree(session);
  for (const node of Object.values(tree.nodes)) {
    if (node.content?.role !== 'model') {
      continue;
    }

    const nodeInteractionId = node.content.metadata?.interactionId?.trim();
    if (nodeInteractionId === normalizedInteractionId) {
      return node.id;
    }
  }

  return undefined;
}

export function getActiveBranchContents(session: ChatSession): GeminiContent[] {
  const tree = ensureBranchTree(session);
  return getBranchContentsToNode(session, tree.activeLeafNodeId);
}

export function getBranchContentsToNode(session: ChatSession, nodeId: string): GeminiContent[] {
  const tree = ensureBranchTree(session);
  const pathNodeIds = getPathNodeIdsToLeaf(tree, nodeId);
  const contents: GeminiContent[] = [];
  for (const pathNodeId of pathNodeIds) {
    const content = tree.nodes[pathNodeId]?.content;
    if (content) {
      contents.push(cloneGeminiContent(content));
    }
  }

  return contents;
}

export function findLastModelInteractionId(contents: readonly GeminiContent[]): string | undefined {
  for (let index = contents.length - 1; index >= 0; index -= 1) {
    const content = contents[index];
    if (content?.role !== 'model') {
      continue;
    }

    const interactionId = content.metadata?.interactionId;
    const normalized = typeof interactionId === 'string' ? interactionId.trim() : '';
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

export function rebuildActiveBranchSnapshot(session: ChatSession): void {
  const contents = getActiveBranchContents(session);
  session.contents = contents;
  session.lastInteractionId = findLastModelInteractionId(contents);
}

export function mapSessionToChatMessages(session: ChatSession): ChatMessage[] {
  const tree = ensureBranchTree(session);
  const pathNodeIds = getPathNodeIdsToLeaf(tree, tree.activeLeafNodeId);
  const messages: ChatMessage[] = [];
  let lastAssistantInteractionId: string | undefined;

  for (const nodeId of pathNodeIds) {
    const node = tree.nodes[nodeId];
    const content = node?.content;
    if (!content) {
      continue;
    }

    if (content.role === 'model') {
      const interactionId = content.metadata?.interactionId?.trim();
      if (interactionId) {
        lastAssistantInteractionId = interactionId;
      }
    }

    const text = renderContentForChat(content).trim();
    const thinkingSummary = renderThinkingSummaryForChat(content).trim();
    const attachments = applyAttachmentPreviewMetadata(
      extractAttachments(content),
      content.metadata?.attachmentPreviewByFileUri,
      content.metadata?.attachmentPreviewTextByFileUri,
    );
    if (!text && !thinkingSummary && attachments.length === 0) {
      continue;
    }

    const role = content.role === 'user' ? 'user' : 'assistant';
    const stats = role === 'assistant' ? content.metadata?.responseStats : undefined;
    const interactionId =
      role === 'assistant' ? content.metadata?.interactionId?.trim() || undefined : undefined;
    const previousInteractionId = role === 'user' ? lastAssistantInteractionId : undefined;
    const sourceModel = role === 'assistant' ? content.metadata?.sourceModel?.trim() : '';
    const timestamp = parseTimestamp(content.metadata?.createdAt);

    let branchContext: AssistantBranchContext | undefined;
    if (role === 'assistant' && interactionId) {
      branchContext = resolveAssistantBranchContext(tree, node.id, interactionId);
    } else if (role === 'user') {
      branchContext = resolveUserForkBranchContext(tree, node.id);
    }
    const branchOptionInteractionIds = branchContext?.interactionIds ?? [];
    const branchOptionCount = branchContext?.count ?? 0;
    const branchOptionIndex = branchContext?.selectedIndex ?? 0;

    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role,
      content: text,
    };
    if (interactionId) {
      message.interactionId = interactionId;
    }
    if (previousInteractionId) {
      message.previousInteractionId = previousInteractionId;
    }
    if (thinkingSummary) {
      message.thinkingSummary = thinkingSummary;
    }
    if (stats) {
      message.stats = stats;
    }
    if (attachments.length > 0) {
      message.attachments = attachments;
    }
    if (sourceModel) {
      message.sourceModel = sourceModel;
    }
    if (timestamp) {
      message.timestamp = timestamp;
    }
    if (branchOptionCount > 1) {
      message.branchOptionInteractionIds = branchOptionInteractionIds;
      message.branchOptionCount = branchOptionCount;
    }
    if (branchOptionIndex > 0) {
      message.branchOptionIndex = branchOptionIndex;
    }

    messages.push(message);
  }

  return messages;
}

export function toAssistantChatMessage(content: GeminiContent): ChatMessage {
  const rendered = renderContentForChat(content).trim();
  const thinkingSummary = renderThinkingSummaryForChat(content).trim();
  const attachments = applyAttachmentPreviewMetadata(
    extractAttachments(content),
    content.metadata?.attachmentPreviewByFileUri,
    content.metadata?.attachmentPreviewTextByFileUri,
  );
  const stats = content.metadata?.responseStats;
  const interactionId = content.metadata?.interactionId?.trim() || undefined;
  const sourceModel = content.metadata?.sourceModel?.trim();
  const timestamp = parseTimestamp(content.metadata?.createdAt);
  const message: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'assistant',
    content:
      rendered ||
      (!thinkingSummary && attachments.length === 0
        ? 'Gemini returned a response with no displayable text.'
        : ''),
  };
  if (interactionId) {
    message.interactionId = interactionId;
  }
  if (thinkingSummary) {
    message.thinkingSummary = thinkingSummary;
  }
  if (stats) {
    message.stats = stats;
  }
  if (attachments.length > 0) {
    message.attachments = attachments;
  }
  if (sourceModel) {
    message.sourceModel = sourceModel;
  }
  if (timestamp) {
    message.timestamp = timestamp;
  }

  return message;
}

function applyAttachmentPreviewMetadata(
  attachments: ChatAttachment[],
  previewByFileUri: Record<string, string> | undefined,
  previewTextByFileUri: Record<string, string> | undefined,
): ChatAttachment[] {
  if ((!previewByFileUri && !previewTextByFileUri) || attachments.length === 0) {
    return attachments;
  }

  let changed = false;
  const nextAttachments = attachments.map((attachment) => {
    const fileUri = attachment.fileUri?.trim() ?? '';
    if (!fileUri) {
      return attachment;
    }

    const previewUrl = !attachment.previewUrl
      ? previewByFileUri?.[fileUri]?.trim() || undefined
      : undefined;
    const previewText = !attachment.previewText
      ? previewTextByFileUri?.[fileUri]?.trim() || undefined
      : undefined;
    if (!previewUrl && !previewText) {
      return attachment;
    }

    changed = true;
    return {
      ...attachment,
      ...(previewUrl ? { previewUrl } : {}),
      ...(previewText ? { previewText } : {}),
    };
  });

  return changed ? nextAttachments : attachments;
}

interface AssistantBranchContext {
  interactionIds: string[];
  count: number;
  selectedIndex: number;
}

function resolveAssistantBranchContext(
  tree: ChatBranchTree,
  assistantNodeId: string,
  interactionId: string,
): AssistantBranchContext | undefined {
  const promptUserNodeId = findPromptUserAncestorNodeId(tree, assistantNodeId);
  if (!promptUserNodeId) {
    return undefined;
  }

  const promptBranchChildNodeId = findAnchorBranchChildNodeId(
    tree,
    assistantNodeId,
    promptUserNodeId,
  );
  if (!promptBranchChildNodeId) {
    return undefined;
  }

  const selectedRepresentativeInteractionId = findRepresentativeInteractionIdForBranch(
    tree,
    promptBranchChildNodeId,
    promptUserNodeId,
  );
  if (
    !selectedRepresentativeInteractionId ||
    selectedRepresentativeInteractionId !== interactionId
  ) {
    return undefined;
  }

  const interactionIds = collectBranchRepresentativeInteractionIds(tree, promptUserNodeId);
  if (interactionIds.length <= 1) {
    return undefined;
  }

  const selectedIndex = interactionIds.indexOf(selectedRepresentativeInteractionId) + 1;
  if (selectedIndex <= 0) {
    return undefined;
  }

  return {
    interactionIds,
    count: interactionIds.length,
    selectedIndex,
  };
}

function resolveUserForkBranchContext(
  tree: ChatBranchTree,
  userNodeId: string,
): AssistantBranchContext | undefined {
  const userNode = tree.nodes[userNodeId];
  const userContent = userNode?.content;
  if (!userNode || userContent?.role !== 'user' || !isUserPromptContent(userContent)) {
    return undefined;
  }

  const assistantAnchorNodeId = userNode.parentNodeId;
  if (!assistantAnchorNodeId) {
    return undefined;
  }

  const assistantAnchorNode = tree.nodes[assistantAnchorNodeId];
  if (!assistantAnchorNode || assistantAnchorNode.content?.role !== 'model') {
    return undefined;
  }

  const assistantAnchorInteractionId = assistantAnchorNode.content.metadata?.interactionId?.trim();
  if (!assistantAnchorInteractionId) {
    return undefined;
  }

  const promptBranchChildNodeId = findAnchorBranchChildNodeId(
    tree,
    userNodeId,
    assistantAnchorNodeId,
  );
  if (!promptBranchChildNodeId) {
    return undefined;
  }

  const selectedRepresentativeInteractionId = findRepresentativeInteractionIdForBranch(
    tree,
    promptBranchChildNodeId,
    assistantAnchorNodeId,
  );
  if (
    !selectedRepresentativeInteractionId ||
    !assistantAnchorNode.childNodeIds.includes(promptBranchChildNodeId)
  ) {
    return undefined;
  }

  const interactionIds: string[] = [];
  for (const siblingNodeId of assistantAnchorNode.childNodeIds) {
    const siblingNode = tree.nodes[siblingNodeId];
    const siblingContent = siblingNode?.content;
    if (!siblingNode || siblingContent?.role !== 'user' || !isUserPromptContent(siblingContent)) {
      continue;
    }

    const representativeInteractionId = findRepresentativeInteractionIdForBranch(
      tree,
      siblingNodeId,
      assistantAnchorNodeId,
    );
    if (!representativeInteractionId || interactionIds.includes(representativeInteractionId)) {
      continue;
    }

    interactionIds.push(representativeInteractionId);
  }

  if (interactionIds.length <= 1) {
    return undefined;
  }

  const selectedIndex = interactionIds.indexOf(selectedRepresentativeInteractionId) + 1;
  if (selectedIndex <= 0) {
    return undefined;
  }

  return {
    interactionIds,
    count: interactionIds.length,
    selectedIndex,
  };
}

function findPromptUserAncestorNodeId(tree: ChatBranchTree, nodeId: string): string | undefined {
  const visited = new Set<string>();
  let currentNodeId: string | undefined = tree.nodes[nodeId]?.parentNodeId;

  while (currentNodeId && !visited.has(currentNodeId)) {
    visited.add(currentNodeId);
    const node = tree.nodes[currentNodeId];
    if (!node) {
      return undefined;
    }

    const content = node.content;
    if (content?.role === 'user' && isUserPromptContent(content)) {
      return node.id;
    }

    currentNodeId = node.parentNodeId;
  }

  return undefined;
}

function findAnchorBranchChildNodeId(
  tree: ChatBranchTree,
  nodeId: string,
  anchorNodeId: string,
): string | undefined {
  const visited = new Set<string>();
  let currentNodeId: string | undefined = nodeId;

  while (currentNodeId && !visited.has(currentNodeId)) {
    visited.add(currentNodeId);
    const currentNode: ChatBranchNode | undefined = tree.nodes[currentNodeId];
    if (!currentNode || !currentNode.parentNodeId) {
      return undefined;
    }

    if (currentNode.parentNodeId === anchorNodeId) {
      return currentNodeId;
    }

    currentNodeId = currentNode.parentNodeId;
  }

  return undefined;
}

function collectBranchRepresentativeInteractionIds(
  tree: ChatBranchTree,
  anchorNodeId: string,
): string[] {
  const anchorNode = tree.nodes[anchorNodeId];
  if (!anchorNode) {
    return [];
  }

  const interactionIds: string[] = [];
  for (const childNodeId of anchorNode.childNodeIds) {
    const representativeInteractionId = findRepresentativeInteractionIdForBranch(
      tree,
      childNodeId,
      anchorNodeId,
    );
    if (!representativeInteractionId || interactionIds.includes(representativeInteractionId)) {
      continue;
    }

    interactionIds.push(representativeInteractionId);
  }

  return interactionIds;
}

function findRepresentativeInteractionIdForBranch(
  tree: ChatBranchTree,
  startNodeId: string,
  promptUserNodeId: string,
): string | undefined {
  const representatives: string[] = [];

  const collect = (
    nodeId: string,
    latestAssistantInteractionId: string | undefined,
    path: Set<string>,
  ): void => {
    if (path.has(nodeId)) {
      if (latestAssistantInteractionId) {
        representatives.push(latestAssistantInteractionId);
      }
      return;
    }

    const node = tree.nodes[nodeId];
    if (!node) {
      if (latestAssistantInteractionId) {
        representatives.push(latestAssistantInteractionId);
      }
      return;
    }

    const nextPath = new Set(path);
    nextPath.add(nodeId);

    let nextAssistantInteractionId = latestAssistantInteractionId;
    const interactionId =
      node.content?.role === 'model' ? node.content.metadata?.interactionId?.trim() : '';
    if (interactionId) {
      nextAssistantInteractionId = interactionId;
    }

    const traversableChildren = node.childNodeIds.filter((childNodeId) => {
      const childNode = tree.nodes[childNodeId];
      if (!childNode || childNode.id === promptUserNodeId) {
        return false;
      }

      const childContent = childNode.content;
      return !(childContent?.role === 'user' && isUserPromptContent(childContent));
    });

    if (traversableChildren.length === 0) {
      if (nextAssistantInteractionId) {
        representatives.push(nextAssistantInteractionId);
      }
      return;
    }

    for (const childNodeId of traversableChildren) {
      collect(childNodeId, nextAssistantInteractionId, nextPath);
    }
  };

  collect(startNodeId, undefined, new Set());
  return representatives[representatives.length - 1];
}

export function isUserPromptContent(content: GeminiContent): boolean {
  for (const part of content.parts) {
    if (typeof part.text === 'string' && part.text.trim()) {
      return true;
    }

    const fileData = part.fileData;
    if (
      isRecord(fileData) &&
      typeof fileData.fileUri === 'string' &&
      fileData.fileUri.trim() &&
      typeof fileData.mimeType === 'string' &&
      fileData.mimeType.trim()
    ) {
      return true;
    }

    const inlineData = part.inlineData;
    if (
      isRecord(inlineData) &&
      typeof inlineData.mimeType === 'string' &&
      inlineData.mimeType.trim()
    ) {
      return true;
    }
  }

  return false;
}

function isValidBranchTree(value: ChatBranchTree): boolean {
  return (
    typeof value.rootNodeId === 'string' &&
    value.rootNodeId.trim().length > 0 &&
    typeof value.activeLeafNodeId === 'string' &&
    value.activeLeafNodeId.trim().length > 0 &&
    typeof value.nodes === 'object' &&
    value.nodes !== null
  );
}

function normalizeBranchTree(tree: ChatBranchTree): void {
  const normalizedRootNodeId = tree.rootNodeId.trim() || crypto.randomUUID();
  const normalizedNodes: Record<string, ChatBranchNode> = {};

  for (const node of Object.values(tree.nodes)) {
    const normalizedNodeId = node.id.trim();
    if (!normalizedNodeId) {
      continue;
    }

    const normalizedParentNodeId = node.parentNodeId?.trim() || undefined;
    const childNodeIds = Array.from(
      new Set(
        node.childNodeIds
          .map((childNodeId) => childNodeId.trim())
          .filter((childNodeId) => childNodeId.length > 0),
      ),
    );
    const normalizedNode: ChatBranchNode = {
      id: normalizedNodeId,
      childNodeIds,
    };
    if (normalizedParentNodeId) {
      normalizedNode.parentNodeId = normalizedParentNodeId;
    }
    if (node.content) {
      normalizedNode.content = cloneGeminiContent(node.content);
    }

    normalizedNodes[normalizedNodeId] = normalizedNode;
  }

  if (!normalizedNodes[normalizedRootNodeId]) {
    normalizedNodes[normalizedRootNodeId] = {
      id: normalizedRootNodeId,
      childNodeIds: [],
    };
  }

  for (const node of Object.values(normalizedNodes)) {
    node.childNodeIds = node.childNodeIds.filter((childNodeId) => !!normalizedNodes[childNodeId]);
    for (const childNodeId of node.childNodeIds) {
      const child = normalizedNodes[childNodeId];
      if (child) {
        child.parentNodeId = node.id;
      }
    }
  }

  const normalizedActiveLeafNodeId =
    normalizedNodes[tree.activeLeafNodeId]?.id || normalizedRootNodeId;

  tree.rootNodeId = normalizedRootNodeId;
  tree.activeLeafNodeId = normalizedActiveLeafNodeId;
  tree.nodes = normalizedNodes;
}

function getPathNodeIdsToLeaf(tree: ChatBranchTree, leafNodeId: string): string[] {
  const targetLeafNodeId = tree.nodes[leafNodeId] ? leafNodeId : tree.rootNodeId;
  const visited = new Set<string>();
  const pathNodeIds: string[] = [];
  let currentNodeId: string | undefined = targetLeafNodeId;

  while (currentNodeId) {
    if (visited.has(currentNodeId)) {
      break;
    }

    visited.add(currentNodeId);
    pathNodeIds.push(currentNodeId);
    currentNodeId = tree.nodes[currentNodeId]?.parentNodeId;
  }

  if (!pathNodeIds.includes(tree.rootNodeId)) {
    pathNodeIds.push(tree.rootNodeId);
  }

  pathNodeIds.reverse();
  return pathNodeIds;
}

function findDeepestLeafNodeId(tree: ChatBranchTree, startNodeId: string): string {
  const visited = new Set<string>();
  let currentNodeId = startNodeId;

  while (!visited.has(currentNodeId)) {
    visited.add(currentNodeId);
    const node = tree.nodes[currentNodeId];
    if (!node || node.childNodeIds.length === 0) {
      return currentNodeId;
    }
    const nextNodeId = node.childNodeIds[node.childNodeIds.length - 1];
    if (!nextNodeId || !tree.nodes[nextNodeId]) {
      return currentNodeId;
    }
    currentNodeId = nextNodeId;
  }

  return currentNodeId;
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}
