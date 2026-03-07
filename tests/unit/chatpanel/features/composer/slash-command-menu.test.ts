import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createSlashCommandMenuController } from '../../../../../src/chatpanel/features/composer/slash-command-menu';
import { GEMINI_SETTINGS_STORAGE_KEY } from '../../../../../src/shared/settings';
import {
  type ChromeStorageChange,
  createChromeStorageLocalMock,
  createChromeStorageOnChangedMock,
} from '../../../helpers/chrome-mock';
import {
  type InstalledDomEnvironment,
  installDomTestEnvironment,
} from '../../../helpers/dom-test-env';

let emitChanged: ((changes: Record<string, ChromeStorageChange>) => void) | null = null;

describe('chatpanel slash command menu', () => {
  let dom: InstalledDomEnvironment | null = null;

  beforeEach(() => {
    dom = installDomTestEnvironment();
    emitChanged = null;
  });

  afterEach(() => {
    dom?.restore();
    dom = null;
    emitChanged = null;
    (globalThis as { chrome?: unknown }).chrome = undefined;
  });

  it('opens for a leading slash query and filters matching commands', async () => {
    installChromeStorageMock({
      [GEMINI_SETTINGS_STORAGE_KEY]: {
        slashCommands: [
          { name: 'summarize', prompt: 'Summarize this.' },
          { name: 'rewrite', prompt: 'Rewrite this.' },
        ],
      },
    });

    const fixture = createFixture();
    const controller = createSlashCommandMenuController({
      input: fixture.input,
      menu: fixture.menu,
      list: fixture.list,
      emptyState: fixture.emptyState,
      isBusy: () => false,
    });
    await Promise.resolve();

    fixture.setInputValue('/su', 3);
    controller.onInputOrCaretChange();

    expect(fixture.menu.hidden).toBe(false);
    expect(fixture.getRenderedCommandNames()).toEqual(['/summarize']);
  });

  it('shows the empty state when typing a leading slash with no configured commands', async () => {
    installChromeStorageMock({
      [GEMINI_SETTINGS_STORAGE_KEY]: {
        slashCommands: [],
      },
    });

    const fixture = createFixture();
    const controller = createSlashCommandMenuController({
      input: fixture.input,
      menu: fixture.menu,
      list: fixture.list,
      emptyState: fixture.emptyState,
      isBusy: () => false,
    });
    await Promise.resolve();

    fixture.setInputValue('/', 1);
    controller.onInputOrCaretChange();

    expect(fixture.menu.hidden).toBe(false);
    expect(fixture.emptyState.hidden).toBe(false);
    expect(fixture.getRenderedCommandNames()).toEqual([]);
  });

  it('selects the highlighted command from the keyboard and reacts to settings changes', async () => {
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    installChromeStorageMock({
      [GEMINI_SETTINGS_STORAGE_KEY]: {
        slashCommands: [{ name: 'summarize', prompt: 'Summarize this.' }],
      },
    });

    const fixture = createFixture();
    const controller = createSlashCommandMenuController({
      input: fixture.input,
      menu: fixture.menu,
      list: fixture.list,
      emptyState: fixture.emptyState,
      isBusy: () => false,
    });
    await Promise.resolve();

    emitChanged?.({
      [GEMINI_SETTINGS_STORAGE_KEY]: {
        newValue: {
          slashCommands: [
            { name: 'summarize', prompt: 'Summarize this.' },
            { name: 'translate', prompt: 'Translate this.' },
          ],
        },
      },
    });

    fixture.setInputValue('/', 1);
    controller.onInputOrCaretChange();
    expect(fixture.getRenderedCommandNames()).toEqual(['/summarize', '/translate']);

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

    expect(handled).toBe(true);
    expect(enterEvent.defaultPrevented).toBe(true);
    expect(fixture.input.value).toBe('/translate ');
    expect(fixture.menu.hidden).toBe(true);
    expect(fixture.input.selectionStart).toBe(fixture.input.value.length);
  });

  it('keeps the highlighted command selected across caret refreshes while navigating with arrow keys', async () => {
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    installChromeStorageMock({
      [GEMINI_SETTINGS_STORAGE_KEY]: {
        slashCommands: [
          { name: 'comment', prompt: 'Summarize comments.' },
          { name: 'summarize', prompt: 'Summarize this.' },
          { name: 'translate', prompt: 'Translate this.' },
        ],
      },
    });

    const fixture = createFixture();
    const controller = createSlashCommandMenuController({
      input: fixture.input,
      menu: fixture.menu,
      list: fixture.list,
      emptyState: fixture.emptyState,
      isBusy: () => false,
    });
    await Promise.resolve();

    fixture.setInputValue('/', 1);
    controller.onInputOrCaretChange();

    controller.onKeyDown(
      new testWindow.KeyboardEvent('keydown', {
        key: 'ArrowDown',
        cancelable: true,
      }),
    );

    controller.onInputOrCaretChange();

    const enterEvent = new testWindow.KeyboardEvent('keydown', {
      key: 'Enter',
      cancelable: true,
    });
    const handled = controller.onKeyDown(enterEvent);

    expect(handled).toBe(true);
    expect(fixture.input.value).toBe('/summarize ');
  });
});

function installChromeStorageMock(storageState: Record<string, unknown>): void {
  const onChangedMock = createChromeStorageOnChangedMock();
  emitChanged = (changes) => {
    onChangedMock.emitChanged(changes);
  };

  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: createChromeStorageLocalMock(storageState),
      onChanged: onChangedMock.onChanged,
    },
  };
}

function createFixture(): {
  input: HTMLTextAreaElement;
  menu: HTMLElement;
  list: HTMLElement;
  emptyState: HTMLElement;
  setInputValue: (value: string, caret: number) => void;
  getRenderedCommandNames: () => string[];
} {
  document.body.innerHTML = `
    <textarea id="input"></textarea>
    <div id="menu" hidden>
      <div id="empty" hidden></div>
      <div id="list"></div>
    </div>
  `;

  const input = document.getElementById('input') as HTMLTextAreaElement;
  const menu = document.getElementById('menu') as HTMLElement;
  const list = document.getElementById('list') as HTMLElement;
  const emptyState = document.getElementById('empty') as HTMLElement;

  return {
    input,
    menu,
    list,
    emptyState,
    setInputValue: (value, caret) => {
      input.value = value;
      input.setSelectionRange(caret, caret);
    },
    getRenderedCommandNames: () =>
      Array.from(list.querySelectorAll<HTMLElement>('[data-slash-command-name]')).map(
        (node) => node.textContent ?? '',
      ),
  };
}
