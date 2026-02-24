import { toErrorMessage } from '../../../shared/error-message';
import { createTitleMetaButton } from '../../core/list-item-builders';

export interface MentionableTab {
  tabId: number;
  title: string;
  url: string;
  hostname: string;
}

export type MentionTabAction = 'extract-text' | 'screenshot';

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
  onSelectTabAction: (
    tab: MentionableTab,
    token: MentionTokenRange,
    action: MentionTabAction,
  ) => Promise<void>;
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

interface MentionActionOption {
  action: MentionTabAction;
  title: string;
  meta: string;
}

interface MentionListRow {
  title: string;
  meta: string;
  dataset?: Record<string, string | number | undefined>;
}

const MENTION_ACTION_OPTIONS: MentionActionOption[] = [
  {
    action: 'extract-text',
    title: 'Extract text',
    meta: 'Attach markdown text from this tab',
  },
  {
    action: 'screenshot',
    title: 'Take screenshot',
    meta: 'Attach a full-page screenshot from this tab',
  },
];

export function createTabMentionController(deps: TabMentionControllerDeps): TabMentionController {
  type MentionMenuMode = 'tab-list' | 'action-list';

  let mentionToken: MentionTokenRange | null = null;
  let filteredTabs: MentionableTab[] = [];
  let activeIndex = -1;
  let mode: MentionMenuMode = 'tab-list';
  let actionTargetTab: MentionableTab | null = null;
  let actionSourceIndex = -1;
  let actionActiveIndex = 0;
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

    const itemType = row.dataset.type?.trim();
    if (itemType === 'action') {
      void selectActionAtIndex(rowIndex);
      return;
    }

    if (itemType !== 'tab') {
      return;
    }

    openActionSelectionForTabIndex(rowIndex);
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

    if (
      mode === 'action-list' &&
      actionTargetTab &&
      mentionToken &&
      isSameMentionToken(mentionToken, nextMentionToken)
    ) {
      mentionToken = nextMentionToken;
      renderActionList();
      return;
    }

    mode = 'tab-list';
    actionTargetTab = null;
    actionSourceIndex = -1;
    actionActiveIndex = 0;
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
        if (mode === 'action-list') {
          return;
        }
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
        if (mode === 'action-list') {
          actionActiveIndex = Math.min(actionActiveIndex + 1, MENTION_ACTION_OPTIONS.length - 1);
          renderActionList();
        } else if (filteredTabs.length > 0) {
          activeIndex = Math.min(activeIndex + 1, filteredTabs.length - 1);
          renderTabList();
        }
        return true;
      case 'ArrowUp':
        if (event.target === deps.input) {
          event.preventDefault();
        }
        if (mode === 'action-list') {
          actionActiveIndex = Math.max(actionActiveIndex - 1, 0);
          renderActionList();
        } else if (filteredTabs.length > 0) {
          activeIndex = Math.max(activeIndex - 1, 0);
          renderTabList();
        }
        return true;
      case 'Enter':
      case 'Tab':
        event.preventDefault();
        if (deps.isBusy() || isSelecting) {
          return true;
        }

        if (mode === 'action-list') {
          void selectActionAtIndex(actionActiveIndex);
          return true;
        }

        if (filteredTabs.length === 0) {
          return true;
        }
        openActionSelectionForTabIndex(activeIndex >= 0 ? activeIndex : 0);
        return true;
      case 'Escape':
        event.preventDefault();
        if (mode === 'action-list') {
          returnToTabSelection();
          return true;
        }
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
    renderTabList();
  }

  function renderTabList(): void {
    renderMentionListRows({
      list: deps.list,
      menu: deps.menu,
      emptyState: deps.emptyState,
      rowType: 'tab',
      selectedIndex: activeIndex,
      showEmptyStateWhenNoRows: true,
      rows: filteredTabs.map((tab) => ({
        title: tab.title,
        meta: tab.hostname || tab.url,
        dataset: {
          tabId: tab.tabId,
        },
      })),
    });
  }

  function renderActionList(): void {
    if (!actionTargetTab) {
      return;
    }

    renderMentionListRows({
      list: deps.list,
      menu: deps.menu,
      emptyState: deps.emptyState,
      rowType: 'action',
      selectedIndex: actionActiveIndex,
      showEmptyStateWhenNoRows: false,
      rows: MENTION_ACTION_OPTIONS.map((option) => ({
        title: option.title,
        meta: option.meta,
        dataset: {
          action: option.action,
        },
      })),
    });
  }

  function openActionSelectionForTabIndex(index: number): void {
    const tab = filteredTabs[index];
    if (!tab) {
      return;
    }

    mode = 'action-list';
    actionTargetTab = tab;
    actionSourceIndex = index;
    actionActiveIndex = 0;
    renderActionList();
  }

  async function selectActionAtIndex(index: number): Promise<void> {
    if (isSelecting || deps.isBusy()) {
      return;
    }
    if (!mentionToken || !actionTargetTab) {
      return;
    }

    const actionOption = MENTION_ACTION_OPTIONS[index];
    if (!actionOption) {
      return;
    }

    const selectionToken: MentionTokenRange = { ...mentionToken };
    const selectedTab = actionTargetTab;
    isSelecting = true;
    try {
      await deps.onSelectTabAction(selectedTab, selectionToken, actionOption.action);
      close();
    } catch (error: unknown) {
      deps.onError(toErrorMessage(error));
    } finally {
      isSelecting = false;
    }
  }

  function returnToTabSelection(): void {
    mode = 'tab-list';
    actionTargetTab = null;
    if (filteredTabs.length === 0) {
      close();
      return;
    }

    activeIndex = clamp(actionSourceIndex, 0, filteredTabs.length - 1);
    actionSourceIndex = -1;
    actionActiveIndex = 0;
    renderTabList();
  }

  function close(): void {
    mentionToken = null;
    filteredTabs = [];
    activeIndex = -1;
    mode = 'tab-list';
    actionTargetTab = null;
    actionSourceIndex = -1;
    actionActiveIndex = 0;
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

function isSameMentionToken(left: MentionTokenRange, right: MentionTokenRange): boolean {
  return (
    left.tokenStart === right.tokenStart &&
    left.tokenEnd === right.tokenEnd &&
    left.query === right.query
  );
}

interface RenderMentionListRowsOptions {
  list: HTMLElement;
  menu: HTMLElement;
  emptyState: HTMLElement;
  rowType: 'tab' | 'action';
  selectedIndex: number;
  rows: MentionListRow[];
  showEmptyStateWhenNoRows: boolean;
}

function renderMentionListRows(options: RenderMentionListRowsOptions): void {
  const fragment = document.createDocumentFragment();
  for (const [index, rowData] of options.rows.entries()) {
    const row = createTitleMetaButton({
      buttonClassName: 'mention-item',
      titleClassName: 'mention-item-title',
      metaClassName: 'mention-item-meta',
      titleText: rowData.title,
      metaText: rowData.meta,
      role: 'option',
      selected: index === options.selectedIndex,
      dataset: {
        type: options.rowType,
        index,
        ...rowData.dataset,
      },
    });
    fragment.append(row);
  }

  options.list.replaceChildren(fragment);
  options.emptyState.hidden = !options.showEmptyStateWhenNoRows || options.rows.length > 0;
  options.menu.hidden = false;

  if (options.selectedIndex < 0) {
    return;
  }

  const selectedRow = options.list.querySelector<HTMLElement>(
    `.mention-item[data-type="${options.rowType}"][data-index="${options.selectedIndex}"]`,
  );
  selectedRow?.scrollIntoView({ block: 'nearest' });
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
