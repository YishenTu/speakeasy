import { describe, expect, it } from 'bun:test';
import {
  appendContentsToBranch,
  createSession,
  ensureBranchTree,
  mapSessionToChatMessages,
  setActiveLeafNodeId,
  toAssistantChatMessage,
} from '../../../../../src/background/features/session/sessions';
import type { ChatSession } from '../../../../../src/background/features/session/types';

describe('sessions', () => {
  it('createSession returns independent session objects', () => {
    const first = createSession();
    const second = createSession();

    expect(first.id.length).toBeGreaterThan(0);
    expect(second.id.length).toBeGreaterThan(0);
    expect(first.id).not.toBe(second.id);
  });

  it('maps persisted content to chat messages and keeps attachment-only entries', () => {
    const session: ChatSession = {
      id: 'chat-1',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      contents: [
        {
          id: 'u1',
          role: 'user',
          parts: [{ text: 'Expanded prompt that should stay hidden from the UI.' }],
          metadata: { userDisplayText: '/summarize Question' },
        },
        {
          id: 'm1',
          role: 'model',
          parts: [{ text: 'Answer' }],
          metadata: { interactionId: 'interaction-1' },
        },
        {
          id: 'm2',
          role: 'model',
          parts: [{ text: 'Answer with stats' }],
          metadata: {
            interactionId: 'interaction-2',
            responseStats: {
              requestDurationMs: 800,
              timeToFirstTokenMs: 120,
              outputTokens: 40,
              totalTokens: 90,
              turnTokensPerSecond: 112.5,
              outputTokensPerSecond: 58.5,
              hasStreamingToken: true,
            },
          },
        },
        {
          id: 'm3',
          role: 'model',
          parts: [{ thoughtSummary: 'Compared two parsing strategies.' }],
        },
        {
          id: 'm4',
          role: 'model',
          parts: [
            {
              fileData: {
                fileUri: 'https://example.invalid/files/image.png',
                mimeType: 'image/png',
                displayName: 'image.png',
              },
            },
          ],
        },
        {
          id: 'm5',
          role: 'model',
          parts: [{ interactionOutput: { type: 'unknown_part' } }],
        },
      ],
    };

    const messages = mapSessionToChatMessages(session);

    expect(messages).toHaveLength(5);
    expect(messages[0]).toMatchObject({
      role: 'user',
      content: '/summarize Question',
    });
    expect(messages[0]?.previousInteractionId).toBeUndefined();
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: 'Answer',
      interactionId: 'interaction-1',
    });
    expect(messages[2]).toMatchObject({
      role: 'assistant',
      content: 'Answer with stats',
      interactionId: 'interaction-2',
      stats: {
        requestDurationMs: 800,
        timeToFirstTokenMs: 120,
        outputTokens: 40,
        totalTokens: 90,
        turnTokensPerSecond: 112.5,
        outputTokensPerSecond: 58.5,
        hasStreamingToken: true,
      },
    });
    expect(messages[3]).toMatchObject({
      role: 'assistant',
      content: '',
      thinkingSummary: 'Compared two parsing strategies.',
    });
    expect(messages[3]?.interactionId).toBeUndefined();
    expect(messages[4]).toMatchObject({
      role: 'assistant',
      content: '',
      attachments: [
        {
          name: 'image.png',
          mimeType: 'image/png',
          fileUri: 'https://example.invalid/files/image.png',
        },
      ],
    });
  });

  it('maps assistant branch option metadata for sibling responses', () => {
    const session = createSession();
    const rootNodeId = session.branchTree?.rootNodeId ?? '';
    session.branchTree = {
      rootNodeId,
      activeLeafNodeId: 'assistant-node-2',
      nodes: {
        [rootNodeId]: {
          id: rootNodeId,
          childNodeIds: ['user-node-1'],
        },
        'user-node-1': {
          id: 'user-node-1',
          parentNodeId: rootNodeId,
          childNodeIds: ['assistant-node-1', 'assistant-node-2'],
          content: {
            id: 'u1',
            role: 'user',
            parts: [{ text: 'Question' }],
          },
        },
        'assistant-node-1': {
          id: 'assistant-node-1',
          parentNodeId: 'user-node-1',
          childNodeIds: [],
          content: {
            id: 'm1',
            role: 'model',
            parts: [{ text: 'Answer A' }],
            metadata: { interactionId: 'interaction-a' },
          },
        },
        'assistant-node-2': {
          id: 'assistant-node-2',
          parentNodeId: 'user-node-1',
          childNodeIds: [],
          content: {
            id: 'm2',
            role: 'model',
            parts: [{ text: 'Answer B' }],
            metadata: { interactionId: 'interaction-b' },
          },
        },
      },
    };
    session.contents = [
      { id: 'u1', role: 'user', parts: [{ text: 'Question' }] },
      {
        id: 'm2',
        role: 'model',
        parts: [{ text: 'Answer B' }],
        metadata: { interactionId: 'interaction-b' },
      },
    ];
    session.lastInteractionId = 'interaction-b';

    const messages = mapSessionToChatMessages(session);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      interactionId: 'interaction-b',
      branchOptionCount: 2,
      branchOptionIndex: 2,
      branchOptionInteractionIds: ['interaction-a', 'interaction-b'],
    });
  });

  it('threads groundingSources in mapSessionToChatMessages for assistant entries', () => {
    const session: ChatSession = {
      id: 'chat-grounding',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      contents: [
        { id: 'u1', role: 'user', parts: [{ text: 'Question' }] },
        {
          id: 'm1',
          role: 'model',
          parts: [{ text: 'Answer' }],
          metadata: {
            groundingSources: [{ title: 'Example', url: 'https://example.com' }],
          },
        },
      ],
    };

    const messages = mapSessionToChatMessages(session);
    expect(messages).toHaveLength(2);
    expect(messages[1]?.groundingSources).toEqual([
      { title: 'Example', url: 'https://example.com' },
    ]);
  });

  it('keeps source-only assistant entries visible when grounding sources exist', () => {
    const session: ChatSession = {
      id: 'chat-source-only-grounding',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      contents: [
        { id: 'u1', role: 'user', parts: [{ text: 'Question' }] },
        {
          id: 'm1',
          role: 'model',
          parts: [{ interactionOutput: { type: 'google_search_result' } }],
          metadata: {
            groundingSources: [{ title: 'Example', url: 'https://example.com' }],
          },
        },
      ],
    };

    const messages = mapSessionToChatMessages(session);
    expect(messages).toHaveLength(2);
    expect(messages[1]?.content).toBe('Gemini returned a response with no displayable text.');
    expect(messages[1]?.groundingSources).toEqual([
      { title: 'Example', url: 'https://example.com' },
    ]);
  });

  it('keeps assistant branch options visible when one branch has tool-call intermediary nodes', () => {
    const session = createSession();
    const rootNodeId = session.branchTree?.rootNodeId ?? '';
    session.branchTree = {
      rootNodeId,
      activeLeafNodeId: 'assistant-branch-a-final',
      nodes: {
        [rootNodeId]: {
          id: rootNodeId,
          childNodeIds: ['user-prompt'],
        },
        'user-prompt': {
          id: 'user-prompt',
          parentNodeId: rootNodeId,
          childNodeIds: ['assistant-branch-a-call', 'assistant-branch-b'],
          content: {
            id: 'u1',
            role: 'user',
            parts: [{ text: 'Compare two options' }],
          },
        },
        'assistant-branch-a-call': {
          id: 'assistant-branch-a-call',
          parentNodeId: 'user-prompt',
          childNodeIds: ['tool-user-branch-a'],
          content: {
            id: 'm-a-call',
            role: 'model',
            parts: [{ functionCall: { name: 'lookup', args: '{}' } }],
            metadata: { interactionId: 'interaction-a-call' },
          },
        },
        'tool-user-branch-a': {
          id: 'tool-user-branch-a',
          parentNodeId: 'assistant-branch-a-call',
          childNodeIds: ['assistant-branch-a-final'],
          content: {
            id: 'u-a-tool',
            role: 'user',
            parts: [{ functionResponse: { name: 'lookup', response: { ok: true } } }],
          },
        },
        'assistant-branch-a-final': {
          id: 'assistant-branch-a-final',
          parentNodeId: 'tool-user-branch-a',
          childNodeIds: [],
          content: {
            id: 'm-a-final',
            role: 'model',
            parts: [{ text: 'Answer from tool-assisted path' }],
            metadata: { interactionId: 'interaction-a-final' },
          },
        },
        'assistant-branch-b': {
          id: 'assistant-branch-b',
          parentNodeId: 'user-prompt',
          childNodeIds: [],
          content: {
            id: 'm-b',
            role: 'model',
            parts: [{ text: 'Answer from direct path' }],
            metadata: { interactionId: 'interaction-b' },
          },
        },
      },
    };
    session.contents = [
      { id: 'u1', role: 'user', parts: [{ text: 'Compare two options' }] },
      {
        id: 'm-a-call',
        role: 'model',
        parts: [{ functionCall: { name: 'lookup', args: '{}' } }],
        metadata: { interactionId: 'interaction-a-call' },
      },
      {
        id: 'u-a-tool',
        role: 'user',
        parts: [{ functionResponse: { name: 'lookup', response: { ok: true } } }],
      },
      {
        id: 'm-a-final',
        role: 'model',
        parts: [{ text: 'Answer from tool-assisted path' }],
        metadata: { interactionId: 'interaction-a-final' },
      },
    ];
    session.lastInteractionId = 'interaction-a-final';

    const messages = mapSessionToChatMessages(session);
    const finalAssistant = messages.at(-1);
    expect(finalAssistant).toMatchObject({
      role: 'assistant',
      interactionId: 'interaction-a-final',
      branchOptionCount: 2,
      branchOptionIndex: 1,
      branchOptionInteractionIds: ['interaction-a-final', 'interaction-b'],
    });
  });

  it('surfaces branch options for forked prompt variants under the same prior assistant', () => {
    const session = createSession();
    const rootNodeId = session.branchTree?.rootNodeId ?? '';
    session.branchTree = {
      rootNodeId,
      activeLeafNodeId: 'assistant-fork-branch',
      nodes: {
        [rootNodeId]: {
          id: rootNodeId,
          childNodeIds: ['user-root'],
        },
        'user-root': {
          id: 'user-root',
          parentNodeId: rootNodeId,
          childNodeIds: ['assistant-root'],
          content: {
            id: 'u1',
            role: 'user',
            parts: [{ text: 'Initial prompt' }],
          },
        },
        'assistant-root': {
          id: 'assistant-root',
          parentNodeId: 'user-root',
          childNodeIds: ['user-original-followup', 'user-fork-followup'],
          content: {
            id: 'm1',
            role: 'model',
            parts: [{ text: 'Initial answer' }],
            metadata: { interactionId: 'interaction-root' },
          },
        },
        'user-original-followup': {
          id: 'user-original-followup',
          parentNodeId: 'assistant-root',
          childNodeIds: ['assistant-original-branch'],
          content: {
            id: 'u2',
            role: 'user',
            parts: [{ text: 'Original follow-up prompt' }],
          },
        },
        'assistant-original-branch': {
          id: 'assistant-original-branch',
          parentNodeId: 'user-original-followup',
          childNodeIds: [],
          content: {
            id: 'm2',
            role: 'model',
            parts: [{ text: 'Original follow-up answer' }],
            metadata: { interactionId: 'interaction-original-branch' },
          },
        },
        'user-fork-followup': {
          id: 'user-fork-followup',
          parentNodeId: 'assistant-root',
          childNodeIds: ['assistant-fork-branch'],
          content: {
            id: 'u2-fork',
            role: 'user',
            parts: [{ text: 'Edited follow-up prompt' }],
          },
        },
        'assistant-fork-branch': {
          id: 'assistant-fork-branch',
          parentNodeId: 'user-fork-followup',
          childNodeIds: [],
          content: {
            id: 'm2-fork',
            role: 'model',
            parts: [{ text: 'Edited follow-up answer' }],
            metadata: { interactionId: 'interaction-fork-branch' },
          },
        },
      },
    };
    session.contents = [
      { id: 'u1', role: 'user', parts: [{ text: 'Initial prompt' }] },
      {
        id: 'm1',
        role: 'model',
        parts: [{ text: 'Initial answer' }],
        metadata: { interactionId: 'interaction-root' },
      },
      { id: 'u2-fork', role: 'user', parts: [{ text: 'Edited follow-up prompt' }] },
      {
        id: 'm2-fork',
        role: 'model',
        parts: [{ text: 'Edited follow-up answer' }],
        metadata: { interactionId: 'interaction-fork-branch' },
      },
    ];
    session.lastInteractionId = 'interaction-fork-branch';

    const messages = mapSessionToChatMessages(session);
    const forkedPrompt = messages.find(
      (message) => message.role === 'user' && message.content === 'Edited follow-up prompt',
    );
    const finalAssistant = messages.at(-1);
    expect(forkedPrompt).toMatchObject({
      role: 'user',
      branchOptionCount: 2,
      branchOptionIndex: 2,
      branchOptionInteractionIds: ['interaction-original-branch', 'interaction-fork-branch'],
    });
    expect(finalAssistant).toMatchObject({
      role: 'assistant',
      interactionId: 'interaction-fork-branch',
    });
    expect(finalAssistant?.branchOptionCount).toBeUndefined();
  });

  it('provides a fallback assistant message when content is not displayable', () => {
    const message = toAssistantChatMessage({
      role: 'model',
      parts: [{ interactionOutput: { type: 'opaque_payload' } }],
    });

    expect(message.role).toBe('assistant');
    expect(message.content).toBe('Gemini returned a response with no displayable text.');
  });

  it('does not use fallback content when thinking summary exists', () => {
    const message = toAssistantChatMessage({
      role: 'model',
      parts: [{ thoughtSummary: 'Validated boundary behavior.' }],
    });

    expect(message.role).toBe('assistant');
    expect(message.content).toBe('');
    expect(message.thinkingSummary).toBe('Validated boundary behavior.');
  });

  it('returns attachment metadata for attachment-only assistant responses', () => {
    const message = toAssistantChatMessage({
      role: 'model',
      parts: [
        {
          fileData: {
            fileUri: 'https://example.invalid/files/report.pdf',
            mimeType: 'application/pdf',
            displayName: 'report.pdf',
          },
        },
      ],
    });

    expect(message.role).toBe('assistant');
    expect(message.content).toBe('');
    expect(message.attachments).toEqual([
      {
        name: 'report.pdf',
        mimeType: 'application/pdf',
        fileUri: 'https://example.invalid/files/report.pdf',
      },
    ]);
  });

  it('maps persisted attachment preview metadata to rendered message previews', () => {
    const session: ChatSession = {
      id: 'chat-preview-meta',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      contents: [
        {
          id: 'u1',
          role: 'user',
          parts: [
            {
              fileData: {
                fileUri: 'https://example.invalid/files/image.png',
                mimeType: 'image/png',
                displayName: 'image.png',
              },
            },
          ],
          metadata: {
            attachmentPreviewByFileUri: {
              'https://example.invalid/files/image.png': 'data:image/png;base64,aGVsbG8=',
            },
            attachmentPreviewTextByFileUri: {
              'https://example.invalid/files/image.png': '# image note',
            },
          },
        },
      ],
    };

    const messages = mapSessionToChatMessages(session);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.attachments).toEqual([
      {
        name: 'image.png',
        mimeType: 'image/png',
        fileUri: 'https://example.invalid/files/image.png',
        previewUrl: 'data:image/png;base64,aGVsbG8=',
        previewText: '# image note',
      },
    ]);
  });

  it('maps assistant response stats and interaction id from content metadata', () => {
    const message = toAssistantChatMessage({
      id: 'assistant-content-1',
      role: 'model',
      parts: [{ text: 'Measured answer' }],
      metadata: {
        interactionId: 'interaction-stats-1',
        responseStats: {
          requestDurationMs: 950,
          timeToFirstTokenMs: 140,
          inputTokens: 21,
          outputTokens: 44,
          totalTokens: 95,
          outputTokensPerSecond: 54.32,
          hasStreamingToken: true,
        },
      },
    });

    expect(message.stats).toEqual({
      requestDurationMs: 950,
      timeToFirstTokenMs: 140,
      inputTokens: 21,
      outputTokens: 44,
      totalTokens: 95,
      outputTokensPerSecond: 54.32,
      hasStreamingToken: true,
    });
    expect(message.interactionId).toBe('interaction-stats-1');
  });

  it('threads groundingSources from assistant metadata to ChatMessage', () => {
    const message = toAssistantChatMessage({
      id: 'assistant-grounding-1',
      role: 'model',
      parts: [{ text: 'Measured answer' }],
      metadata: {
        groundingSources: [{ title: 'Example', url: 'https://example.com' }],
      },
    });

    expect(message.groundingSources).toEqual([{ title: 'Example', url: 'https://example.com' }]);
  });

  it('omits groundingSources when assistant metadata has none', () => {
    const message = toAssistantChatMessage({
      id: 'assistant-grounding-none',
      role: 'model',
      parts: [{ text: 'Measured answer' }],
    });

    expect(message.groundingSources).toBeUndefined();
  });

  it('createSession produces empty content history', () => {
    const session = createSession();
    expect(session.contents).toEqual([]);
    expect(session.createdAt).toBe(session.updatedAt);
  });

  it('reconstructs branch tree from legacy flat contents when branchTree is missing', () => {
    const session: ChatSession = {
      id: 'legacy-chat',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      contents: [
        { id: 'u1', role: 'user', parts: [{ text: 'Question' }] },
        {
          id: 'm1',
          role: 'model',
          parts: [{ text: 'Answer' }],
          metadata: { interactionId: 'interaction-1' },
        },
      ],
    };

    const branchTree = ensureBranchTree(session);
    expect(Object.keys(branchTree.nodes).length).toBe(3);
    expect(branchTree.nodes[branchTree.rootNodeId]?.content).toBeUndefined();

    const messages = mapSessionToChatMessages(session);
    expect(messages).toHaveLength(2);
    expect(messages[1]?.interactionId).toBe('interaction-1');
  });

  it('throws when appending contents to an unknown branch parent node', () => {
    const session = createSession();
    const content = {
      id: 'user-next',
      role: 'user' as const,
      parts: [{ text: 'Follow-up' }],
    };

    expect(() => appendContentsToBranch(session, 'missing-node-id', [content])).toThrow(
      /does not exist/i,
    );
  });

  it('sets active leaf directly when followLatestDescendant is false', () => {
    const session = createSession();
    const rootNodeId = session.branchTree?.rootNodeId ?? '';
    session.branchTree = {
      rootNodeId,
      activeLeafNodeId: 'assistant-node',
      nodes: {
        [rootNodeId]: {
          id: rootNodeId,
          childNodeIds: ['user-node'],
        },
        'user-node': {
          id: 'user-node',
          parentNodeId: rootNodeId,
          childNodeIds: ['assistant-node'],
          content: {
            id: 'u1',
            role: 'user',
            parts: [{ text: 'Question' }],
          },
        },
        'assistant-node': {
          id: 'assistant-node',
          parentNodeId: 'user-node',
          childNodeIds: ['user-followup'],
          content: {
            id: 'm1',
            role: 'model',
            parts: [{ text: 'Answer' }],
            metadata: { interactionId: 'interaction-1' },
          },
        },
        'user-followup': {
          id: 'user-followup',
          parentNodeId: 'assistant-node',
          childNodeIds: [],
          content: {
            id: 'u2',
            role: 'user',
            parts: [{ text: 'Follow-up' }],
          },
        },
      },
    };
    session.contents = [
      { id: 'u1', role: 'user', parts: [{ text: 'Question' }] },
      {
        id: 'm1',
        role: 'model',
        parts: [{ text: 'Answer' }],
        metadata: { interactionId: 'interaction-1' },
      },
      { id: 'u2', role: 'user', parts: [{ text: 'Follow-up' }] },
    ];
    session.lastInteractionId = 'interaction-1';

    const switched = setActiveLeafNodeId(session, 'assistant-node', false);

    expect(switched).toBe(true);
    expect(session.branchTree?.activeLeafNodeId).toBe('assistant-node');
    expect(session.contents.map((content) => content.id)).toEqual(['u1', 'm1']);
    expect(session.lastInteractionId).toBe('interaction-1');
  });
});
