import { GEMINI_SETTINGS_STORAGE_KEY, normalizeGeminiSettings } from '../../../shared/settings';
import { type SlashCommandDefinition, filterSlashCommands } from '../../../shared/slash-commands';

export interface SlashCommandMenuController {
  onInputOrCaretChange(): void;
  onKeyDown(event: KeyboardEvent): boolean;
  close(): void;
  dispose(): void;
}

export interface CreateSlashCommandMenuControllerOptions {
  input: HTMLTextAreaElement;
  menu: HTMLElement;
  list: HTMLElement;
  emptyState: HTMLElement;
  isBusy: () => boolean;
}

export function createSlashCommandMenuController(
  options: CreateSlashCommandMenuControllerOptions,
): SlashCommandMenuController {
  let slashCommands = normalizeGeminiSettings(undefined).slashCommands;
  let visibleCommands: SlashCommandDefinition[] = [];
  let selectedIndex = 0;
  let activeQuery: string | null = null;

  function applySettings(settingsValue: unknown): void {
    slashCommands = normalizeGeminiSettings(settingsValue).slashCommands;
    onInputOrCaretChange();
  }

  function close(): void {
    visibleCommands = [];
    selectedIndex = 0;
    activeQuery = null;
    options.menu.hidden = true;
    options.emptyState.hidden = true;
    options.list.replaceChildren();
  }

  function render(): void {
    options.list.replaceChildren(
      ...visibleCommands.map((command, index) =>
        createCommandButton(command, index === selectedIndex),
      ),
    );
    options.menu.hidden = false;
    options.emptyState.hidden = visibleCommands.length > 0;
  }

  function updateSelection(nextIndex: number): void {
    selectedIndex =
      visibleCommands.length === 0
        ? 0
        : Math.max(0, Math.min(nextIndex, visibleCommands.length - 1));
    render();
    options.list
      .querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }

  function applySelection(command: SlashCommandDefinition): void {
    const nextValue = `/${command.name} `;
    options.input.value = nextValue;
    options.input.focus();
    options.input.setSelectionRange(nextValue.length, nextValue.length);
    close();
    options.input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function onInputOrCaretChange(): void {
    const query = readSlashQuery();
    if (query === null) {
      close();
      return;
    }

    const previousSelectionName = visibleCommands[selectedIndex]?.name;
    const nextVisibleCommands = filterSlashCommands(slashCommands, query);
    visibleCommands = nextVisibleCommands;

    if (query === activeQuery && previousSelectionName) {
      const preservedIndex = visibleCommands.findIndex(
        (command) => command.name === previousSelectionName,
      );
      selectedIndex = preservedIndex >= 0 ? preservedIndex : 0;
    } else {
      selectedIndex = 0;
    }

    activeQuery = query;
    render();
  }

  function onKeyDown(event: KeyboardEvent): boolean {
    if (options.menu.hidden) {
      return false;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        updateSelection(selectedIndex + 1);
        return true;
      case 'ArrowUp':
        event.preventDefault();
        updateSelection(selectedIndex - 1);
        return true;
      case 'Enter':
      case 'Tab': {
        const selectedCommand = visibleCommands[selectedIndex];
        if (!selectedCommand) {
          return false;
        }
        event.preventDefault();
        applySelection(selectedCommand);
        return true;
      }
      case 'Escape':
        event.preventDefault();
        close();
        return true;
      default:
        return false;
    }
  }

  function createCommandButton(
    command: SlashCommandDefinition,
    selected: boolean,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'slash-command-item';
    button.dataset.commandName = command.name;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', selected ? 'true' : 'false');

    const name = document.createElement('span');
    name.className = 'slash-command-item-name';
    name.dataset.slashCommandName = 'true';
    name.textContent = `/${command.name}`;

    const prompt = document.createElement('span');
    prompt.className = 'slash-command-item-prompt';
    prompt.textContent = command.prompt;

    button.append(name, prompt);
    return button;
  }

  function readSlashQuery(): string | null {
    if (options.isBusy()) {
      return null;
    }

    const text = options.input.value;
    if (!text.startsWith('/')) {
      return null;
    }

    const selectionStart = options.input.selectionStart ?? text.length;
    const selectionEnd = options.input.selectionEnd ?? selectionStart;
    if (selectionStart !== selectionEnd) {
      return null;
    }

    const remainder = text.slice(1);
    const whitespaceIndex = remainder.search(/\s/);
    const commandEnd = whitespaceIndex === -1 ? text.length : whitespaceIndex + 1;
    if (selectionStart > commandEnd) {
      return null;
    }

    return text.slice(1, commandEnd).trim();
  }

  const onListClick = (event: Event): void => {
    const item = (event.target as Element).closest<HTMLElement>('.slash-command-item');
    if (!item) {
      return;
    }

    const selectedCommand = visibleCommands.find(
      (command) => command.name === item.dataset.commandName,
    );
    if (selectedCommand) {
      applySelection(selectedCommand);
    }
  };

  const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>): void => {
    const settingsChange = changes[GEMINI_SETTINGS_STORAGE_KEY];
    if (!settingsChange) {
      return;
    }

    applySettings(settingsChange.newValue);
  };

  options.list.addEventListener('click', onListClick);
  void chrome.storage.local.get(GEMINI_SETTINGS_STORAGE_KEY).then((stored) => {
    applySettings(stored[GEMINI_SETTINGS_STORAGE_KEY]);
  });
  chrome.storage.onChanged.addListener(onStorageChanged);

  return {
    onInputOrCaretChange,
    onKeyDown,
    close,
    dispose: () => {
      options.list.removeEventListener('click', onListClick);
      chrome.storage.onChanged.removeListener(onStorageChanged);
    },
  };
}
