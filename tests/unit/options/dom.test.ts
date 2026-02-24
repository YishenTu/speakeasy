import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { getOptionsDom, setStatus } from '../../../src/options/dom';
import { type InstalledDomEnvironment, installDomTestEnvironment } from '../helpers/dom-test-env';

describe('options dom helpers', () => {
  let dom: InstalledDomEnvironment | null = null;

  beforeEach(() => {
    dom = installDomTestEnvironment(buildOptionsFixtureHtml());
  });

  afterEach(() => {
    dom?.restore();
    dom = null;
  });

  it('collects required form elements', () => {
    const optionsDom = getOptionsDom();

    expect(optionsDom.form.id).toBe('settings-form');
    expect(optionsDom.apiKeyInput.id).toBe('api-key');
    expect(optionsDom.modelFlashNameInput.id).toBe('model-name-flash');
    expect(optionsDom.modelFlashThinkingLevelSelect.id).toBe('model-thinking-level-flash');
    expect(optionsDom.modelProNameInput.id).toBe('model-name-pro');
    expect(optionsDom.modelProThinkingLevelSelect.id).toBe('model-thinking-level-pro');
    expect(optionsDom.customModelRowsContainer.id).toBe('custom-model-rows');
    expect(optionsDom.addCustomModelButton.id).toBe('add-custom-model');
    expect(optionsDom.customModelRowTemplate.id).toBe('custom-model-row-template');
    expect(optionsDom.pageTextExtractionEngineInput.id).toBe('page-text-extraction-engine');
    expect(optionsDom.statusNode.id).toBe('save-status');
  });

  it('throws when a required node is missing', () => {
    document.getElementById('add-custom-model')?.remove();
    expect(() => getOptionsDom()).toThrow(/missing required node: #add-custom-model/i);
  });

  it('updates status text and tone classes', () => {
    const status = document.getElementById('save-status') as HTMLElement;

    setStatus(status, 'Saved', 'success');
    expect(status.textContent).toBe('Saved');
    expect(status.classList.contains('text-emerald-300')).toBe(true);

    setStatus(status, 'Error', 'error');
    expect(status.classList.contains('text-rose-300')).toBe(true);
    expect(status.classList.contains('text-emerald-300')).toBe(false);
  });
});

function buildOptionsFixtureHtml(): string {
  return `
    <!doctype html>
    <html>
      <body>
        <form id="settings-form"></form>
        <span id="version"></span>
        <p id="save-status"></p>
        <input id="api-key" />
        <input id="model-name-flash" />
        <select id="model-thinking-level-flash"></select>
        <input id="model-name-pro" />
        <select id="model-thinking-level-pro"></select>
        <div id="custom-model-rows"></div>
        <button id="add-custom-model" type="button">Add</button>
        <template id="custom-model-row-template"></template>
        <textarea id="system-instruction"></textarea>
        <input id="store-interactions" type="checkbox" />
        <input id="max-tool-round-trips" />
        <select id="page-text-extraction-engine"></select>
        <input id="tool-google-search" type="checkbox" />
        <input id="tool-google-maps" type="checkbox" />
        <input id="tool-code-execution" type="checkbox" />
        <input id="tool-url-context" type="checkbox" />
        <input id="tool-file-search" type="checkbox" />
        <input id="tool-mcp-servers" type="checkbox" />
        <input id="tool-function-calling" type="checkbox" />
        <input id="tool-computer-use" type="checkbox" />
        <input id="file-search-store-names" />
        <input id="mcp-server-urls" />
        <input id="maps-latitude" />
        <input id="maps-longitude" />
        <input id="computer-use-excluded-actions" />
      </body>
    </html>
  `;
}
