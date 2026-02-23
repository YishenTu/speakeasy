import { afterEach, describe, expect, it } from 'bun:test';
import type { ChatRepository } from '../../src/background/chat-repository';
import { createRuntimeRequestHandler } from '../../src/background/runtime';
import type { RuntimeRequest } from '../../src/shared/runtime';

function createRepositoryStub(): ChatRepository {
  return {
    getSession: async () => null,
    listSessions: async () => [],
    upsertSession: async () => {},
    deleteSession: async () => false,
    pruneExpiredSessions: async () => 0,
  };
}

function installChromeTabsQueryMock(tabs: chrome.tabs.Tab[]): chrome.tabs.QueryInfo[] {
  const calls: chrome.tabs.QueryInfo[] = [];
  (globalThis as { chrome?: unknown }).chrome = {
    tabs: {
      query: async (queryInfo: chrome.tabs.QueryInfo) => {
        calls.push(queryInfo);
        return tabs;
      },
    },
  };

  return calls;
}

describe('runtime tab list handler', () => {
  afterEach(() => {
    (globalThis as { chrome?: unknown }).chrome = undefined;
  });

  it('returns normalized tab summaries in deterministic order', async () => {
    const queryCalls = installChromeTabsQueryMock([
      {
        id: 31,
        windowId: 3,
        active: false,
        title: 'Bravo tab',
        url: 'https://bravo.example.com/docs',
      },
      {
        id: 12,
        windowId: 2,
        active: false,
        title: '  Alpha tab  ',
        url: 'https://alpha.example.com/path',
      },
      {
        id: 11,
        windowId: 2,
        active: true,
        title: 'Zeta tab',
        url: 'https://zeta.example.com',
      },
      {
        id: 13,
        windowId: 2,
        active: false,
        title: '   ',
        url: 'http://[::1',
      },
      {
        id: 32,
        windowId: 3,
        active: false,
        title: 'File page',
        url: 'file:///Users/example/Desktop/demo.html',
      },
    ] as chrome.tabs.Tab[]);
    const handler = createRuntimeRequestHandler({
      repository: createRepositoryStub(),
      bootstrapChatStorage: () => new Promise<void>(() => {}),
    });

    const payload = await handler({ type: 'tab/list-open' } as RuntimeRequest);

    expect(queryCalls).toEqual([{}]);
    expect(payload).toEqual({
      tabs: [
        {
          tabId: 11,
          windowId: 2,
          active: true,
          title: 'Zeta tab',
          url: 'https://zeta.example.com',
          hostname: 'zeta.example.com',
        },
        {
          tabId: 12,
          windowId: 2,
          active: false,
          title: 'Alpha tab',
          url: 'https://alpha.example.com/path',
          hostname: 'alpha.example.com',
        },
        {
          tabId: 13,
          windowId: 2,
          active: false,
          title: 'Untitled tab',
          url: 'http://[::1',
          hostname: '',
        },
        {
          tabId: 31,
          windowId: 3,
          active: false,
          title: 'Bravo tab',
          url: 'https://bravo.example.com/docs',
          hostname: 'bravo.example.com',
        },
        {
          tabId: 32,
          windowId: 3,
          active: false,
          title: 'File page',
          url: 'file:///Users/example/Desktop/demo.html',
          hostname: '',
        },
      ],
    });
  });

  it('filters unsupported schemes before returning mention candidates', async () => {
    installChromeTabsQueryMock([
      { id: 1, windowId: 1, url: 'chrome://settings' },
      { id: 2, windowId: 1, url: 'chrome-extension://id/options.html' },
      { id: 3, windowId: 1, url: 'edge://settings' },
      { id: 4, windowId: 1, url: 'about:blank' },
      { id: 5, windowId: 1, url: 'devtools://devtools/bundled/inspector.html' },
      { id: 6, windowId: 1, url: 'view-source:https://example.com' },
      { id: 7, windowId: 1, title: 'Allowed', url: 'https://allowed.example.com' },
    ] as chrome.tabs.Tab[]);
    const handler = createRuntimeRequestHandler({
      repository: createRepositoryStub(),
      bootstrapChatStorage: async () => {},
    });

    const payload = await handler({ type: 'tab/list-open' } as RuntimeRequest);

    expect(payload).toEqual({
      tabs: [
        {
          tabId: 7,
          windowId: 1,
          active: false,
          title: 'Allowed',
          url: 'https://allowed.example.com',
          hostname: 'allowed.example.com',
        },
      ],
    });
  });

  it('filters entries that are missing valid tab ids', async () => {
    installChromeTabsQueryMock([
      { id: undefined, windowId: 1, url: 'https://missing-id.example.com' },
      { id: 0, windowId: 1, url: 'https://zero-id.example.com' },
      { id: -1, windowId: 1, url: 'https://negative-id.example.com' },
      { id: 9, windowId: 1, title: 'Valid', url: 'https://valid-id.example.com' },
    ] as chrome.tabs.Tab[]);
    const handler = createRuntimeRequestHandler({
      repository: createRepositoryStub(),
      bootstrapChatStorage: async () => {},
    });

    const payload = await handler({ type: 'tab/list-open' } as RuntimeRequest);

    expect(payload).toEqual({
      tabs: [
        {
          tabId: 9,
          windowId: 1,
          active: false,
          title: 'Valid',
          url: 'https://valid-id.example.com',
          hostname: 'valid-id.example.com',
        },
      ],
    });
  });

  it('throws when chrome.tabs.query is unavailable', async () => {
    (globalThis as { chrome?: unknown }).chrome = {
      tabs: {},
    };
    const handler = createRuntimeRequestHandler({
      repository: createRepositoryStub(),
      bootstrapChatStorage: async () => {},
    });

    await expect(handler({ type: 'tab/list-open' } as RuntimeRequest)).rejects.toThrow(
      'Chrome tabs API is unavailable.',
    );
  });

  it('surfaces chrome.tabs.query rejections', async () => {
    (globalThis as { chrome?: unknown }).chrome = {
      tabs: {
        query: async () => {
          throw new Error('tabs query failed');
        },
      },
    };
    const handler = createRuntimeRequestHandler({
      repository: createRepositoryStub(),
      bootstrapChatStorage: async () => {},
    });

    await expect(handler({ type: 'tab/list-open' } as RuntimeRequest)).rejects.toThrow(
      'tabs query failed',
    );
  });
});
