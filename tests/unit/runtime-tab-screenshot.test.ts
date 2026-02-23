import { describe, expect, it } from 'bun:test';
import type { ChatRepository } from '../../src/background/chat-repository';
import { createRuntimeRequestHandler } from '../../src/background/runtime';
import type { RuntimeRequestContext } from '../../src/background/runtime/contracts';
import type { TabCaptureFullPagePayload } from '../../src/shared/runtime';

const CAPTURE_PAYLOAD: TabCaptureFullPagePayload = {
  dataUrl: 'data:image/png;base64,AAAA',
  mimeType: 'image/png',
  fileName: 'speakeasy-full-page.png',
  width: 1400,
  height: 3200,
};

function createSenderContext(tabId: number): RuntimeRequestContext {
  return {
    sender: {
      tab: {
        id: tabId,
      } as chrome.tabs.Tab,
    } as chrome.runtime.MessageSender,
  };
}

function createRepositoryStub(): ChatRepository {
  return {
    getSession: async () => null,
    listSessions: async () => [],
    upsertSession: async () => {},
    deleteSession: async () => false,
    pruneExpiredSessions: async () => 0,
  };
}

describe('runtime tab screenshot handler', () => {
  it('captures full-page screenshot for the sender tab without waiting for bootstrap', async () => {
    const captureCalls: number[] = [];
    const handler = createRuntimeRequestHandler({
      repository: createRepositoryStub(),
      bootstrapChatStorage: () => new Promise<void>(() => {}),
      captureFullPageScreenshot: async (tabId) => {
        captureCalls.push(tabId);
        return CAPTURE_PAYLOAD;
      },
    });

    const payload = await handler({ type: 'tab/capture-full-page' }, createSenderContext(88));

    expect(captureCalls).toEqual([88]);
    expect(payload).toEqual(CAPTURE_PAYLOAD);
  });

  it('rejects full-page screenshot requests outside tab message contexts', async () => {
    const handler = createRuntimeRequestHandler({
      repository: createRepositoryStub(),
      bootstrapChatStorage: async () => {},
      captureFullPageScreenshot: async () => CAPTURE_PAYLOAD,
    });

    await expect(handler({ type: 'tab/capture-full-page' })).rejects.toThrow(/active browser tab/i);
  });
});
