import { GEMINI_SETTINGS_STORAGE_KEY, normalizeGeminiSettings } from '../shared/settings';
import { getOptionsDom, setStatus } from './dom';
import { applySettingsToForm, readFormState } from './form-state';
import { validateSettings } from './validation';

const dom = getOptionsDom();

dom.versionNode.textContent = chrome.runtime.getManifest().version;
void initializeForm();

dom.form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const nextSettings = normalizeGeminiSettings(readFormState(dom));
  const validationError = validateSettings(nextSettings);
  if (validationError) {
    setStatus(dom.statusNode, validationError, 'error');
    return;
  }

  await chrome.storage.local.set({
    [GEMINI_SETTINGS_STORAGE_KEY]: nextSettings,
  });

  setStatus(dom.statusNode, 'Saved Gemini settings.', 'success');
});

async function initializeForm(): Promise<void> {
  const stored = await chrome.storage.local.get(GEMINI_SETTINGS_STORAGE_KEY);
  const settings = normalizeGeminiSettings(stored[GEMINI_SETTINGS_STORAGE_KEY]);
  applySettingsToForm(dom, settings);
  setStatus(dom.statusNode, 'Ready.', 'info');
}
