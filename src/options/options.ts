import { GEMINI_SETTINGS_STORAGE_KEY, normalizeGeminiSettings } from '../shared/settings';
import { getOptionsDom, setStatus } from './dom';
import {
  addCustomModelRow,
  applySettingsToForm,
  readFormState,
  removeCustomModelRow,
} from './form-state';
import { validateSettings } from './validation';

const dom = getOptionsDom();
let currentSettings = normalizeGeminiSettings(undefined);

dom.versionNode.textContent = chrome.runtime.getManifest().version;
void initializeForm();

dom.addCustomModelButton.addEventListener('click', () => {
  addCustomModelRow(dom);
});

dom.customModelRowsContainer.addEventListener('click', (event) => {
  const removeButton = (event.target as Element).closest<HTMLElement>('[data-remove-custom-model]');
  if (!removeButton) {
    return;
  }

  const row = removeButton.closest<HTMLElement>('[data-custom-model-row]');
  if (row) {
    removeCustomModelRow(row);
  }
});

dom.form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const nextSettings = normalizeGeminiSettings({
    ...currentSettings,
    ...readFormState(dom),
  });
  const validationError = validateSettings(nextSettings);
  if (validationError) {
    setStatus(dom.statusNode, validationError, 'error');
    return;
  }

  await chrome.storage.local.set({
    [GEMINI_SETTINGS_STORAGE_KEY]: nextSettings,
  });
  currentSettings = nextSettings;

  setStatus(dom.statusNode, 'Saved Gemini settings.', 'success');
});

async function initializeForm(): Promise<void> {
  const stored = await chrome.storage.local.get(GEMINI_SETTINGS_STORAGE_KEY);
  const settings = normalizeGeminiSettings(stored[GEMINI_SETTINGS_STORAGE_KEY]);
  currentSettings = settings;
  applySettingsToForm(dom, settings);
  setStatus(dom.statusNode, 'Ready.', 'info');
}
