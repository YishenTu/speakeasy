import {
  type ChatMessage,
  type ChatTabContext,
  deleteChatById,
  getActiveChatId,
  listChatSessions,
  loadChatMessages,
  loadChatMessagesById,
} from '../shared/chat';
import type { ChatSessionSummary } from '../shared/runtime';
import { toErrorMessage } from './message-renderer';

export interface HistoryDropdownController {
  setOpen(open: boolean): void;
  isOpen(): boolean;
  syncMenuState(): void;
  refresh(): Promise<void>;
  loadSession(chatId: string): Promise<void>;
  reloadActive(): Promise<void>;
  getSessions(): readonly ChatSessionSummary[];
  dispose(): void;
}

export interface HistoryDropdownDeps {
  historyControl: HTMLElement;
  historyToggleButton: HTMLButtonElement;
  historyMenu: HTMLElement;
  deleteSessionConfirmation: { confirm: (title: string) => Promise<boolean> };
  isBusy: () => boolean;
  setBusy: (busy: boolean) => void;
  getChatTabContext: () => Promise<ChatTabContext>;
  getActiveChatId: () => string | null;
  setActiveChatId: (id: string | null) => void;
  clearStagedFiles: () => void;
  cancelQueuedSend: () => void;
  renderMessages: (messages: ChatMessage[]) => void;
  appendLocalError: (message: string) => void;
  focusInput: () => void;
}

export function createHistoryDropdownController(
  deps: HistoryDropdownDeps,
): HistoryDropdownController {
  let isMenuOpen = false;
  let sessions: ChatSessionSummary[] = [];

  deps.historyToggleButton.setAttribute('aria-expanded', 'false');

  function setOpen(nextOpen: boolean): void {
    isMenuOpen = nextOpen;
    deps.historyControl.classList.toggle('open', nextOpen);
    deps.historyToggleButton.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
  }

  function renderMenu(): void {
    const fragment = document.createDocumentFragment();

    if (sessions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = 'No previous chats.';
      empty.setAttribute('role', 'presentation');
      fragment.append(empty);
      deps.historyMenu.replaceChildren(fragment);
      return;
    }

    const activeChatId = deps.getActiveChatId();

    for (const session of sessions) {
      const item = document.createElement('div');
      item.className = 'history-item';
      item.setAttribute('role', 'none');

      const openButton = document.createElement('button');
      openButton.className = 'history-item-main';
      openButton.type = 'button';
      openButton.setAttribute('role', 'menuitem');
      openButton.disabled = deps.isBusy();
      if (session.chatId === activeChatId) {
        openButton.classList.add('history-item-active');
      }

      const title = document.createElement('span');
      title.className = 'history-item-title';
      title.textContent = session.title;

      const meta = document.createElement('span');
      meta.className = 'history-item-meta';
      meta.textContent = formatHistoryTimestamp(session.updatedAt);

      openButton.append(title, meta);
      openButton.addEventListener('click', async () => {
        if (deps.isBusy() || session.chatId === deps.getActiveChatId()) {
          return;
        }

        deps.cancelQueuedSend();
        deps.setBusy(true);
        try {
          await loadSession(session.chatId);
          setOpen(false);
          deps.focusInput();
        } catch (error: unknown) {
          deps.appendLocalError(toErrorMessage(error));
        } finally {
          deps.setBusy(false);
        }
      });

      const deleteButton = document.createElement('button');
      deleteButton.className = 'history-item-delete';
      deleteButton.type = 'button';
      deleteButton.setAttribute('aria-label', `Delete ${session.title}`);
      deleteButton.setAttribute('role', 'menuitem');
      deleteButton.textContent = '×';
      deleteButton.disabled = deps.isBusy();
      deleteButton.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (deps.isBusy()) {
          return;
        }

        if (!(await deps.deleteSessionConfirmation.confirm(session.title))) {
          return;
        }

        deps.cancelQueuedSend();
        deps.setBusy(true);
        try {
          const tabContext = await deps.getChatTabContext();
          const deleted = await deleteChatById(session.chatId, tabContext);
          if (deleted && deps.getActiveChatId() === session.chatId) {
            deps.setActiveChatId((await getActiveChatId(tabContext)) ?? null);
            deps.clearStagedFiles();
            deps.renderMessages([]);
          }
          await refresh();
          if (sessions.length === 0) {
            setOpen(false);
          }
          deps.focusInput();
        } catch (error: unknown) {
          deps.appendLocalError(toErrorMessage(error));
        } finally {
          deps.setBusy(false);
        }
      });

      item.append(openButton, deleteButton);
      fragment.append(item);
    }

    deps.historyMenu.replaceChildren(fragment);
  }

  async function refresh(): Promise<void> {
    sessions = await listChatSessions();
    renderMenu();
  }

  async function loadSession(chatId: string): Promise<void> {
    const payload = await loadChatMessagesById(chatId, await deps.getChatTabContext());
    deps.setActiveChatId(payload.chatId);
    deps.renderMessages(payload.messages);
    await refresh();
  }

  async function reloadActive(): Promise<void> {
    const payload = await loadChatMessages(await deps.getChatTabContext());
    deps.setActiveChatId(payload.chatId);
    deps.renderMessages(payload.messages);
    await refresh();
  }

  const onOutsidePointerDown = (event: Event): void => {
    if (!isMenuOpen) {
      return;
    }
    if ((event as PointerEvent).composedPath().includes(deps.historyControl)) {
      return;
    }
    setOpen(false);
  };

  const onToggleClick = async (): Promise<void> => {
    if (deps.isBusy()) {
      return;
    }

    if (isMenuOpen) {
      setOpen(false);
      return;
    }

    deps.setBusy(true);
    try {
      await refresh();
      setOpen(true);
    } catch (error: unknown) {
      deps.appendLocalError(toErrorMessage(error));
    } finally {
      deps.setBusy(false);
    }
  };

  deps.historyToggleButton.addEventListener('click', onToggleClick);
  document.addEventListener('pointerdown', onOutsidePointerDown);

  return {
    setOpen,
    isOpen: () => isMenuOpen,
    syncMenuState: renderMenu,
    refresh,
    loadSession,
    reloadActive,
    getSessions: () => sessions,
    dispose(): void {
      deps.historyToggleButton.removeEventListener('click', onToggleClick);
      document.removeEventListener('pointerdown', onOutsidePointerDown);
    },
  };
}

export function formatHistoryTimestamp(updatedAt: string): string {
  const timestamp = Date.parse(updatedAt);
  if (Number.isNaN(timestamp)) {
    return updatedAt.replace('T', ' ').slice(0, 16);
  }

  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
