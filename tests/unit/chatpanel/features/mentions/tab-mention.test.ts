import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import {
  type MentionTabAction,
  type MentionTokenRange,
  type MentionableTab,
  createTabMentionController,
  removeMentionTokenFromInputText,
} from '../../../../../src/chatpanel/features/mentions/tab-mention';
import {
  type InstalledDomEnvironment,
  installDomTestEnvironment,
} from '../../../helpers/dom-test-env';

const TABS: MentionableTab[] = [
  {
    tabId: 11,
    title: 'Example Docs',
    url: 'https://example.com/docs',
    hostname: 'example.com',
  },
  {
    tabId: 22,
    title: 'Beta Workspace',
    url: 'https://workspace.example.com/repo',
    hostname: 'workspace.example.com',
  },
  {
    tabId: 33,
    title: 'Release Notes',
    url: 'https://updates.example.net/changelog',
    hostname: 'updates.example.net',
  },
];

type SelectedMention = {
  tab: MentionableTab;
  token: MentionTokenRange;
  action: MentionTabAction;
};

type MentionFixtureOptions = {
  listTabs?: () => Promise<MentionableTab[]>;
};

async function flushMicrotasks(iterations = 16): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

describe('chatpanel tab mention controller', () => {
  let dom: InstalledDomEnvironment | null = null;

  beforeEach(() => {
    dom = installDomTestEnvironment();
  });

  afterEach(() => {
    dom?.restore();
    dom = null;
  });

  it('detects active @ mention tokens at the current caret position', async () => {
    const fixture = createMentionFixture();
    const controller = fixture.createController();

    fixture.setInputValue('Review @docs next', 12);
    controller.onInputOrCaretChange();
    await flushMicrotasks();

    expect(fixture.menu.hidden).toBe(false);
    expect(fixture.getRenderedTabIds()).toEqual([11]);
  });

  it('ignores @ characters that are in the middle of a word', async () => {
    const fixture = createMentionFixture();
    const controller = fixture.createController();

    fixture.setInputValue('email@test.com', 10);
    controller.onInputOrCaretChange();
    await flushMicrotasks();

    expect(fixture.menu.hidden).toBe(true);
    expect(fixture.listTabCalls).toBe(0);
  });

  it('shows all tabs when the mention query is empty', async () => {
    const fixture = createMentionFixture();
    const controller = fixture.createController();

    fixture.setInputValue('@', 1);
    controller.onInputOrCaretChange();
    await flushMicrotasks();

    expect(fixture.menu.hidden).toBe(false);
    expect(fixture.getRenderedTabIds()).toEqual([11, 22, 33]);
  });

  it('filters by title, url, and hostname using case-insensitive matching', async () => {
    const fixture = createMentionFixture();
    const controller = fixture.createController();

    fixture.setInputValue('@WORK', 5);
    controller.onInputOrCaretChange();
    await flushMicrotasks();
    expect(fixture.getRenderedTabIds()).toEqual([22]);

    fixture.setInputValue('@docs', 5);
    controller.onInputOrCaretChange();
    await flushMicrotasks();
    expect(fixture.getRenderedTabIds()).toEqual([11]);

    fixture.setInputValue('@updates', 8);
    controller.onInputOrCaretChange();
    await flushMicrotasks();
    expect(fixture.getRenderedTabIds()).toEqual([33]);
  });

  it('keeps keyboard navigation indices within bounds', async () => {
    const fixture = createMentionFixture();
    const controller = fixture.createController();
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    fixture.setInputValue('@', 1);
    controller.onInputOrCaretChange();
    await flushMicrotasks();

    const arrowUpHandled = controller.onKeyDown(
      new testWindow.KeyboardEvent('keydown', {
        key: 'ArrowUp',
        cancelable: true,
      }),
    );
    expect(arrowUpHandled).toBe(true);
    expect(fixture.getSelectedTabId()).toBe(11);

    controller.onKeyDown(
      new testWindow.KeyboardEvent('keydown', {
        key: 'ArrowDown',
        cancelable: true,
      }),
    );
    controller.onKeyDown(
      new testWindow.KeyboardEvent('keydown', {
        key: 'ArrowDown',
        cancelable: true,
      }),
    );
    controller.onKeyDown(
      new testWindow.KeyboardEvent('keydown', {
        key: 'ArrowDown',
        cancelable: true,
      }),
    );

    expect(fixture.getSelectedTabId()).toBe(33);
  });

  it('keeps native scroll behavior enabled for ArrowUp and ArrowDown', async () => {
    const fixture = createMentionFixture();
    const controller = fixture.createController();
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    fixture.setInputValue('@', 1);
    controller.onInputOrCaretChange();
    await flushMicrotasks();

    const arrowDownEvent = new testWindow.KeyboardEvent('keydown', {
      key: 'ArrowDown',
      cancelable: true,
    });
    const arrowDownHandled = controller.onKeyDown(arrowDownEvent);
    expect(arrowDownHandled).toBe(true);
    expect(arrowDownEvent.defaultPrevented).toBe(false);

    const arrowUpEvent = new testWindow.KeyboardEvent('keydown', {
      key: 'ArrowUp',
      cancelable: true,
    });
    const arrowUpHandled = controller.onKeyDown(arrowUpEvent);
    expect(arrowUpHandled).toBe(true);
    expect(arrowUpEvent.defaultPrevented).toBe(false);
  });

  it('scrolls the active mention row into view during Arrow navigation', async () => {
    const fixture = createMentionFixture();
    const controller = fixture.createController();
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    fixture.setInputValue('@', 1);
    controller.onInputOrCaretChange();
    await flushMicrotasks();

    const scrollIntoViewSpy = spyOn(
      testWindow.HTMLElement.prototype,
      'scrollIntoView',
    ).mockImplementation(() => {});

    controller.onKeyDown(
      new testWindow.KeyboardEvent('keydown', {
        key: 'ArrowDown',
        cancelable: true,
      }),
    );

    expect(scrollIntoViewSpy).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('preserves the active row when the mention token is unchanged across refreshes', async () => {
    const fixture = createMentionFixture();
    const controller = fixture.createController();
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    fixture.setInputValue('@', 1);
    controller.onInputOrCaretChange();
    await flushMicrotasks();

    controller.onKeyDown(
      new testWindow.KeyboardEvent('keydown', {
        key: 'ArrowDown',
        cancelable: true,
      }),
    );
    expect(fixture.getSelectedTabId()).toBe(22);

    // Simulate the chatpanel keyup refresh path after keyboard navigation.
    controller.onInputOrCaretChange();
    await flushMicrotasks();
    expect(fixture.getSelectedTabId()).toBe(22);
  });

  it('reloads open tabs when mention mode is triggered again', async () => {
    let mockCallCount = 0;
    const fixture = createMentionFixture({
      listTabs: async () => {
        mockCallCount += 1;
        return mockCallCount === 1 ? [TABS[0]] : [TABS[2]];
      },
    });
    const controller = fixture.createController();

    fixture.setInputValue('@', 1);
    controller.onInputOrCaretChange();
    await flushMicrotasks();
    expect(fixture.listTabCalls).toBe(1);
    expect(fixture.getRenderedTabIds()).toEqual([11]);

    fixture.setInputValue('plain text', 10);
    controller.onInputOrCaretChange();
    await flushMicrotasks();
    expect(fixture.menu.hidden).toBe(true);

    fixture.setInputValue('@', 1);
    controller.onInputOrCaretChange();
    await flushMicrotasks();
    expect(fixture.listTabCalls).toBe(2);
    expect(fixture.getRenderedTabIds()).toEqual([33]);
  });

  it('opens action choices on Enter, then selects the highlighted action on Enter', async () => {
    const fixture = createMentionFixture();
    const controller = fixture.createController();
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    fixture.setInputValue('@', 1);
    controller.onInputOrCaretChange();
    await flushMicrotasks();

    controller.onKeyDown(
      new testWindow.KeyboardEvent('keydown', {
        key: 'ArrowDown',
        cancelable: true,
      }),
    );

    const enterEvent = new testWindow.KeyboardEvent('keydown', {
      key: 'Enter',
      cancelable: true,
    });
    const handled = controller.onKeyDown(enterEvent);
    await flushMicrotasks();

    expect(handled).toBe(true);
    expect(enterEvent.defaultPrevented).toBe(true);
    expect(fixture.selected).toHaveLength(0);
    expect(fixture.getRenderedMentionActions()).toEqual(['extract-text', 'screenshot']);

    controller.onKeyDown(
      new testWindow.KeyboardEvent('keydown', {
        key: 'Enter',
        cancelable: true,
      }),
    );
    await flushMicrotasks();

    expect(fixture.selected).toHaveLength(1);
    expect(fixture.selected[0]?.tab.tabId).toBe(22);
    expect(fixture.selected[0]?.token).toEqual({
      tokenStart: 0,
      tokenEnd: 1,
      query: '',
    });
    expect(fixture.selected[0]?.action).toBe('extract-text');
  });

  it('opens action choices on Tab, then selects the highlighted action on Tab', async () => {
    const fixture = createMentionFixture();
    const controller = fixture.createController();
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    fixture.setInputValue('@', 1);
    controller.onInputOrCaretChange();
    await flushMicrotasks();

    const tabEvent = new testWindow.KeyboardEvent('keydown', {
      key: 'Tab',
      cancelable: true,
    });
    const handled = controller.onKeyDown(tabEvent);
    await flushMicrotasks();

    expect(handled).toBe(true);
    expect(tabEvent.defaultPrevented).toBe(true);
    expect(fixture.selected).toHaveLength(0);
    expect(fixture.getRenderedMentionActions()).toEqual(['extract-text', 'screenshot']);

    controller.onKeyDown(
      new testWindow.KeyboardEvent('keydown', {
        key: 'Tab',
        cancelable: true,
      }),
    );
    await flushMicrotasks();

    expect(fixture.selected).toHaveLength(1);
    expect(fixture.selected[0]?.tab.tabId).toBe(11);
    expect(fixture.selected[0]?.action).toBe('extract-text');
  });

  it('returns to the tab list when Escape is pressed from action selection mode', async () => {
    const fixture = createMentionFixture();
    const controller = fixture.createController();
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    fixture.setInputValue('@', 1);
    controller.onInputOrCaretChange();
    await flushMicrotasks();

    controller.onKeyDown(
      new testWindow.KeyboardEvent('keydown', {
        key: 'Enter',
        cancelable: true,
      }),
    );
    await flushMicrotasks();
    expect(fixture.getRenderedMentionActions()).toEqual(['extract-text', 'screenshot']);

    const escapeEvent = new testWindow.KeyboardEvent('keydown', {
      key: 'Escape',
      cancelable: true,
    });
    const handled = controller.onKeyDown(escapeEvent);
    await flushMicrotasks();

    expect(handled).toBe(true);
    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(fixture.menu.hidden).toBe(false);
    expect(fixture.getRenderedTabIds()).toEqual([11, 22, 33]);
    expect(fixture.selected).toHaveLength(0);
  });

  it('closes mention mode on Escape without selecting a tab', async () => {
    const fixture = createMentionFixture();
    const controller = fixture.createController();
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    fixture.setInputValue('@', 1);
    controller.onInputOrCaretChange();
    await flushMicrotasks();

    const escapeEvent = new testWindow.KeyboardEvent('keydown', {
      key: 'Escape',
      cancelable: true,
    });
    const handled = controller.onKeyDown(escapeEvent);

    expect(handled).toBe(true);
    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(fixture.menu.hidden).toBe(true);
    expect(fixture.selected).toHaveLength(0);
  });

  it('passes the selected tab and mention token range to the callback', async () => {
    const fixture = createMentionFixture();
    const controller = fixture.createController();
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    fixture.setInputValue('prefix @bet suffix', 11);
    controller.onInputOrCaretChange();
    await flushMicrotasks();

    controller.onKeyDown(
      new testWindow.KeyboardEvent('keydown', {
        key: 'Enter',
        cancelable: true,
      }),
    );
    await flushMicrotasks();
    controller.onKeyDown(
      new testWindow.KeyboardEvent('keydown', {
        key: 'Enter',
        cancelable: true,
      }),
    );
    await flushMicrotasks();

    expect(fixture.selected).toHaveLength(1);
    expect(fixture.selected[0]?.tab.tabId).toBe(22);
    expect(fixture.selected[0]?.token).toEqual({
      tokenStart: 7,
      tokenEnd: 11,
      query: 'bet',
    });
    expect(fixture.selected[0]?.action).toBe('extract-text');
  });

  it('removes mention tokens correctly at start, middle, and end positions', () => {
    expect(
      removeMentionTokenFromInputText('@repo rest', {
        tokenStart: 0,
        tokenEnd: 5,
        query: 'repo',
      }),
    ).toEqual({
      text: ' rest',
      caret: 0,
    });

    expect(
      removeMentionTokenFromInputText('find @repo now', {
        tokenStart: 5,
        tokenEnd: 10,
        query: 'repo',
      }),
    ).toEqual({
      text: 'find  now',
      caret: 5,
    });

    expect(
      removeMentionTokenFromInputText('find @repo', {
        tokenStart: 5,
        tokenEnd: 10,
        query: 'repo',
      }),
    ).toEqual({
      text: 'find ',
      caret: 5,
    });
  });

  function createMentionFixture(options: MentionFixtureOptions = {}) {
    const input = document.createElement('textarea');
    const menu = document.createElement('div');
    menu.hidden = true;
    const list = document.createElement('div');
    const emptyState = document.createElement('div');
    emptyState.hidden = true;
    menu.append(list, emptyState);
    document.body.append(input, menu);

    const selected: SelectedMention[] = [];
    let listTabCalls = 0;
    const listTabs = options.listTabs ?? (async () => TABS);

    return {
      input,
      menu,
      list,
      emptyState,
      selected,
      get listTabCalls() {
        return listTabCalls;
      },
      setInputValue(value: string, caret: number) {
        input.value = value;
        input.setSelectionRange(caret, caret);
      },
      getRenderedTabIds(): number[] {
        return Array.from(list.querySelectorAll<HTMLElement>('.mention-item'))
          .map((row) => Number(row.dataset.tabId))
          .filter((id) => Number.isInteger(id));
      },
      getRenderedMentionActions(): MentionTabAction[] {
        return Array.from(list.querySelectorAll<HTMLElement>('.mention-item'))
          .map((row) => row.dataset.action)
          .filter(
            (action): action is MentionTabAction =>
              action === 'extract-text' || action === 'screenshot',
          );
      },
      getSelectedTabId(): number | null {
        const selectedItem = list.querySelector<HTMLElement>('.mention-item[aria-selected="true"]');
        if (!selectedItem) {
          return null;
        }

        const tabId = Number(selectedItem.dataset.tabId);
        return Number.isInteger(tabId) ? tabId : null;
      },
      createController() {
        return createTabMentionController({
          input,
          menu,
          list,
          emptyState,
          onSelectTabAction: async (tab, token, action) => {
            selected.push({ tab, token, action });
          },
          listTabs: async () => {
            listTabCalls += 1;
            return listTabs();
          },
          onError: () => {},
          isBusy: () => false,
        });
      },
    };
  }
});
