import { toErrorMessage } from '../shared/error-message';

export interface MentionableTab {
  tabId: number;
  title: string;
  url: string;
  hostname: string;
}

export interface MentionTokenRange {
  tokenStart: number;
  tokenEnd: number;
  query: string;
}

export interface RemoveMentionTokenResult {
  text: string;
  caret: number;
}

export interface TabMentionControllerDeps {
  input: HTMLTextAreaElement;
  menu: HTMLElement;
  list: HTMLElement;
  emptyState: HTMLElement;
  onSelectTab: (tab: MentionableTab, token: MentionTokenRange) => Promise<void>;
  listTabs: () => Promise<MentionableTab[]>;
  onError: (message: string) => void;
  isBusy: () => boolean;
}

export interface TabMentionController {
  onInputOrCaretChange(): void;
  onKeyDown(event: KeyboardEvent): boolean;
  close(): void;
  dispose(): void;
}

export function createTabMentionController(deps: TabMentionControllerDeps): TabMentionController {
  let mentionToken: MentionTokenRange | null = null;
  let filteredTabs: MentionableTab[] = [];
  let activeIndex = -1;
  let isSelecting = false;
  let isDisposed = false;
  let listRequestVersion = 0;

  const handleListClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const row = target.closest<HTMLElement>('.mention-item');
    if (!row || !deps.list.contains(row)) {
      return;
    }

    const rowIndex = Number.parseInt(row.dataset.index ?? '', 10);
    if (!Number.isInteger(rowIndex)) {
      return;
    }

    void selectTabAtIndex(rowIndex);
  };

  deps.list.addEventListener('click', handleListClick);

  function onInputOrCaretChange(): void {
    if (isDisposed) {
      return;
    }

    const caretIndex = deps.input.selectionStart ?? 0;
    const nextMentionToken = findMentionTokenAtCaret(deps.input.value, caretIndex);
    if (!nextMentionToken) {
      close();
      return;
    }

    mentionToken = nextMentionToken;

    const requestVersion = listRequestVersion + 1;
    listRequestVersion = requestVersion;
    void deps
      .listTabs()
      .then((nextTabs) => {
        if (isDisposed || requestVersion !== listRequestVersion) {
          return;
        }

        const latestToken = findMentionTokenAtCaret(
          deps.input.value,
          deps.input.selectionStart ?? 0,
        );
        if (!latestToken) {
          close();
          return;
        }
        const resetActiveIndex =
          !mentionToken ||
          mentionToken.tokenStart !== latestToken.tokenStart ||
          mentionToken.tokenEnd !== latestToken.tokenEnd ||
          mentionToken.query !== latestToken.query;
        mentionToken = latestToken;
        renderForToken(nextTabs, latestToken, resetActiveIndex);
      })
      .catch((error: unknown) => {
        if (isDisposed || requestVersion !== listRequestVersion) {
          return;
        }

        close();
        deps.onError(toErrorMessage(error));
      });
  }

  function onKeyDown(event: KeyboardEvent): boolean {
    if (isDisposed || deps.menu.hidden) {
      return false;
    }

    switch (event.key) {
      case 'ArrowDown':
        if (event.target === deps.input) {
          event.preventDefault();
        }
        if (filteredTabs.length > 0) {
          activeIndex = Math.min(activeIndex + 1, filteredTabs.length - 1);
          renderList();
        }
        return true;
      case 'ArrowUp':
        if (event.target === deps.input) {
          event.preventDefault();
        }
        if (filteredTabs.length > 0) {
          activeIndex = Math.max(activeIndex - 1, 0);
          renderList();
        }
        return true;
      case 'Enter':
      case 'Tab':
        event.preventDefault();
        if (filteredTabs.length === 0 || deps.isBusy() || isSelecting) {
          return true;
        }
        void selectTabAtIndex(activeIndex >= 0 ? activeIndex : 0);
        return true;
      case 'Escape':
        event.preventDefault();
        close();
        return true;
      default:
        return false;
    }
  }

  function renderForToken(
    sourceTabs: MentionableTab[],
    token: MentionTokenRange,
    resetActiveIndex: boolean,
  ): void {
    filteredTabs = filterMentionTabs(sourceTabs, token.query);
    if (resetActiveIndex) {
      activeIndex = filteredTabs.length > 0 ? 0 : -1;
    } else if (filteredTabs.length === 0) {
      activeIndex = -1;
    } else {
      activeIndex = Math.max(0, Math.min(activeIndex, filteredTabs.length - 1));
    }
    renderList();
  }

  function renderList(): void {
    const fragment = document.createDocumentFragment();
    for (const [index, tab] of filteredTabs.entries()) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'mention-item';
      row.dataset.index = String(index);
      row.dataset.tabId = String(tab.tabId);
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', index === activeIndex ? 'true' : 'false');

      const title = document.createElement('span');
      title.className = 'mention-item-title';
      title.textContent = tab.title;

      const meta = document.createElement('span');
      meta.className = 'mention-item-meta';
      meta.textContent = tab.hostname || tab.url;

      row.append(title, meta);
      fragment.append(row);
    }

    deps.list.replaceChildren(fragment);
    deps.emptyState.hidden = filteredTabs.length > 0;
    deps.menu.hidden = false;
    if (activeIndex >= 0) {
      const selectedRow = deps.list.querySelector<HTMLElement>(
        `.mention-item[data-index="${activeIndex}"]`,
      );
      selectedRow?.scrollIntoView({ block: 'nearest' });
    }
  }

  async function selectTabAtIndex(index: number): Promise<void> {
    if (isSelecting || deps.isBusy()) {
      return;
    }
    if (!mentionToken) {
      return;
    }

    const tab = filteredTabs[index];
    if (!tab) {
      return;
    }

    const selectionToken: MentionTokenRange = { ...mentionToken };
    isSelecting = true;
    try {
      await deps.onSelectTab(tab, selectionToken);
      close();
    } catch (error: unknown) {
      deps.onError(toErrorMessage(error));
    } finally {
      isSelecting = false;
    }
  }

  function close(): void {
    mentionToken = null;
    filteredTabs = [];
    activeIndex = -1;
    deps.menu.hidden = true;
    deps.emptyState.hidden = true;
    deps.list.replaceChildren();
  }

  function dispose(): void {
    if (isDisposed) {
      return;
    }
    isDisposed = true;
    close();
    deps.list.removeEventListener('click', handleListClick);
  }

  return {
    onInputOrCaretChange,
    onKeyDown,
    close,
    dispose,
  };
}

export function findMentionTokenAtCaret(
  inputText: string,
  caretIndex: number,
): MentionTokenRange | null {
  const normalizedCaret = clamp(caretIndex, 0, inputText.length);
  let tokenStart = normalizedCaret;
  while (tokenStart > 0 && !isTokenBoundary(inputText[tokenStart - 1])) {
    tokenStart -= 1;
  }

  if (inputText[tokenStart] !== '@') {
    return null;
  }

  if (tokenStart > 0 && !isTokenBoundary(inputText[tokenStart - 1])) {
    return null;
  }

  let tokenEnd = tokenStart;
  while (tokenEnd < inputText.length && !isTokenBoundary(inputText[tokenEnd])) {
    tokenEnd += 1;
  }

  if (normalizedCaret < tokenStart + 1 || normalizedCaret > tokenEnd) {
    return null;
  }

  return {
    tokenStart,
    tokenEnd,
    query: inputText.slice(tokenStart + 1, tokenEnd),
  };
}

export function removeMentionTokenFromInputText(
  inputText: string,
  token: MentionTokenRange,
): RemoveMentionTokenResult {
  const tokenStart = clamp(token.tokenStart, 0, inputText.length);
  const tokenEnd = clamp(token.tokenEnd, tokenStart, inputText.length);
  return {
    text: `${inputText.slice(0, tokenStart)}${inputText.slice(tokenEnd)}`,
    caret: tokenStart,
  };
}

function filterMentionTabs(tabs: MentionableTab[], query: string): MentionableTab[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return tabs;
  }

  return tabs.filter((tab) => {
    const title = tab.title.toLowerCase();
    const url = tab.url.toLowerCase();
    const hostname = tab.hostname.toLowerCase();
    return (
      title.includes(normalizedQuery) ||
      url.includes(normalizedQuery) ||
      hostname.includes(normalizedQuery)
    );
  });
}

function isTokenBoundary(character: string | undefined): boolean {
  return !character || /\s/u.test(character);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
