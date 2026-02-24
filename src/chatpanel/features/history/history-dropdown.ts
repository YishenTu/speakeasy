import {
  type ChatMessage,
  type ChatTabContext,
  deleteChatById,
  getActiveChatId,
  listChatSessions,
  loadChatMessages,
  loadChatMessagesById,
} from '../../../shared/chat';
import type { ChatSessionSummary } from '../../../shared/runtime';
import { runWhenIdle, runWithBusyState } from '../../core/busy-state';
import { createTitleMetaButton } from '../../core/list-item-builders';
import { createMenuController } from '../../core/menu-controller';
import { formatHistoryTimestampValue } from '../../core/time-format';
import { toErrorMessage } from '../messages/message-renderer';

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
  let sessions: ChatSessionSummary[] = [];
  const busyState = {
    isBusy: deps.isBusy,
    setBusy: deps.setBusy,
  };
  const menuController = createMenuController({
    container: deps.historyControl,
    trigger: deps.historyToggleButton,
    closeOnOutsidePointerDown: {
      target: document,
      isInside: (event) => {
        const eventPath = event.composedPath?.() ?? [];
        return eventPath.includes(deps.historyControl);
      },
    },
  });

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

      const openButton = createTitleMetaButton({
        buttonClassName: 'history-item-main',
        titleClassName: 'history-item-title',
        metaClassName: 'history-item-meta',
        titleText: session.title,
        metaText: formatHistoryTimestamp(session.updatedAt),
        role: 'menuitem',
        disabled: deps.isBusy(),
      });
      if (session.chatId === activeChatId) {
        openButton.classList.add('history-item-active');
      }
      openButton.addEventListener('click', async () => {
        if (session.chatId === deps.getActiveChatId()) {
          return;
        }

        await runWhenIdle(busyState, async () => {
          deps.cancelQueuedSend();
          try {
            await loadSession(session.chatId);
            menuController.setOpen(false);
            deps.focusInput();
          } catch (error: unknown) {
            deps.appendLocalError(toErrorMessage(error));
          }
        });
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

        await runWhenIdle(busyState, async () => {
          deps.cancelQueuedSend();
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
              menuController.setOpen(false);
            }
            deps.focusInput();
          } catch (error: unknown) {
            deps.appendLocalError(toErrorMessage(error));
          }
        });
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

  const onToggleClick = async (): Promise<void> => {
    if (deps.isBusy()) {
      return;
    }

    if (menuController.isOpen()) {
      menuController.setOpen(false);
      return;
    }

    await runWithBusyState(busyState, async () => {
      try {
        await refresh();
        menuController.setOpen(true);
      } catch (error: unknown) {
        deps.appendLocalError(toErrorMessage(error));
      }
    });
  };

  deps.historyToggleButton.addEventListener('click', onToggleClick);

  return {
    setOpen: menuController.setOpen,
    isOpen: menuController.isOpen,
    syncMenuState: renderMenu,
    refresh,
    loadSession,
    reloadActive,
    getSessions: () => sessions,
    dispose(): void {
      deps.historyToggleButton.removeEventListener('click', onToggleClick);
      menuController.dispose();
    },
  };
}

export function formatHistoryTimestamp(updatedAt: string): string {
  return formatHistoryTimestampValue(updatedAt);
}
