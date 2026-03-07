import {
  GEMINI_SETTINGS_STORAGE_KEY,
  type GeminiSettings,
  normalizeGeminiSettings,
} from '../shared/settings';
import { type SlashCommandDefinition, validateSlashCommandDrafts } from '../shared/slash-commands';
import { getOptionsDom, setStatus } from './dom';
import {
  addSlashCommandRow,
  applySettingsToForm,
  focusSlashCommandRowNameInput,
  readFormState,
  readSlashCommandDraftFromRow,
  readSlashCommandDrafts,
  removeSlashCommandRow,
  setSlashCommandRowEditState,
  syncSlashCommandRowPresentation,
} from './form-state';
import { validateSettings } from './validation';

const dom = getOptionsDom();
let currentSettings = normalizeGeminiSettings(undefined);
let hasInitializedForm = false;
let settingsWriteQueue: Promise<void> = Promise.resolve();
let queuedSlashCommands: SlashCommandDefinition[] | null = null;
let isFlushingSlashCommandAutosave = false;

dom.versionNode.textContent = chrome.runtime.getManifest().version;
void initializeForm();

dom.addSlashCommandButton.addEventListener('click', () => {
  const row = addSlashCommandRow(dom);
  setSlashCommandRowEditState(row, true);
  focusSlashCommandRowNameInput(row);
});

dom.slashCommandRowsContainer.addEventListener('input', (event) => {
  const row = (event.target as Element).closest<HTMLElement>('[data-slash-command-row]');
  if (!row) {
    return;
  }

  syncSlashCommandRowPresentation(row);
  void scheduleSlashCommandAutosave();
});

dom.slashCommandRowsContainer.addEventListener('click', (event) => {
  const row = (event.target as Element).closest<HTMLElement>('[data-slash-command-row]');
  if (!row) {
    return;
  }

  const removeButton = (event.target as Element).closest<HTMLElement>(
    '[data-remove-slash-command]',
  );
  if (removeButton) {
    removeSlashCommandRow(row);
    void scheduleSlashCommandAutosave();
    return;
  }

  const editButton = (event.target as Element).closest<HTMLElement>('[data-edit-slash-command]');
  if (editButton) {
    setSlashCommandRowEditState(row, true);
    focusSlashCommandRowNameInput(row);
    return;
  }

  const doneButton = (event.target as Element).closest<HTMLElement>('[data-done-slash-command]');
  if (!doneButton) {
    return;
  }

  const draft = readSlashCommandDraftFromRow(row);
  if (!draft.name && !draft.prompt) {
    removeSlashCommandRow(row);
    void scheduleSlashCommandAutosave();
    return;
  }

  const validationError = validateSlashCommandDrafts(readSlashCommandDrafts(dom));
  if (validationError) {
    setStatus(dom.statusNode, validationError, 'error');
    focusSlashCommandRowNameInput(row);
    return;
  }

  syncSlashCommandRowPresentation(row);
  setSlashCommandRowEditState(row, false);
  void scheduleSlashCommandAutosave();
});

dom.form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const slashCommandValidationError = validateSlashCommandDrafts(readSlashCommandDrafts(dom));
  if (slashCommandValidationError) {
    setStatus(dom.statusNode, slashCommandValidationError, 'error');
    return;
  }

  const nextSettings = normalizeGeminiSettings({
    ...currentSettings,
    ...readFormState(dom),
  });
  const validationError = validateSettings(nextSettings);
  if (validationError) {
    setStatus(dom.statusNode, validationError, 'error');
    return;
  }

  await persistSettings(() => nextSettings);

  setStatus(dom.statusNode, 'Saved Gemini settings.', 'success');
});

async function initializeForm(): Promise<void> {
  const stored = await chrome.storage.local.get(GEMINI_SETTINGS_STORAGE_KEY);
  const settings = normalizeGeminiSettings(stored[GEMINI_SETTINGS_STORAGE_KEY]);
  currentSettings = settings;
  applySettingsToForm(dom, settings);
  hasInitializedForm = true;
  setStatus(dom.statusNode, 'Ready.', 'info');
}

async function scheduleSlashCommandAutosave(): Promise<void> {
  if (!hasInitializedForm) {
    return;
  }

  const drafts = readSlashCommandDrafts(dom);
  const validationError = validateSlashCommandDrafts(drafts);
  if (validationError || areSlashCommandsEqual(currentSettings.slashCommands, drafts)) {
    return;
  }

  queuedSlashCommands = cloneSlashCommands(drafts);
  if (isFlushingSlashCommandAutosave) {
    return;
  }

  isFlushingSlashCommandAutosave = true;
  try {
    while (queuedSlashCommands) {
      const nextSlashCommands = cloneSlashCommands(queuedSlashCommands);
      queuedSlashCommands = null;
      await persistSettings(() =>
        normalizeGeminiSettings({
          ...currentSettings,
          slashCommands: nextSlashCommands,
        }),
      );
    }
  } finally {
    isFlushingSlashCommandAutosave = false;
  }
}

async function persistSettings(factory: () => GeminiSettings): Promise<void> {
  const nextWrite = settingsWriteQueue
    .catch(() => undefined)
    .then(async () => {
      const nextSettings = factory();
      await chrome.storage.local.set({
        [GEMINI_SETTINGS_STORAGE_KEY]: nextSettings,
      });
      currentSettings = nextSettings;
    });
  settingsWriteQueue = nextWrite;
  await nextWrite;
}

function cloneSlashCommands(
  slashCommands: readonly SlashCommandDefinition[],
): SlashCommandDefinition[] {
  return slashCommands.map((slashCommand) => ({ ...slashCommand }));
}

function areSlashCommandsEqual(
  left: readonly SlashCommandDefinition[],
  right: readonly SlashCommandDefinition[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every(
    (slashCommand, index) =>
      slashCommand.name === right[index]?.name && slashCommand.prompt === right[index]?.prompt,
  );
}
