import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { getOptionsDom, setStatus } from '../../src/options/dom';
import { type InstalledDomEnvironment, installDomTestEnvironment } from './helpers/dom-test-env';

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
    expect(optionsDom.modelInput.id).toBe('model');
    expect(optionsDom.statusNode.id).toBe('save-status');
  });

  it('throws when a required node is missing', () => {
    document.getElementById('model')?.remove();
    expect(() => getOptionsDom()).toThrow(/missing required node: #model/i);
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
        <input id="model" />
        <textarea id="system-instruction"></textarea>
        <input id="max-tool-round-trips" />
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
