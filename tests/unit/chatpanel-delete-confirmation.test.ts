import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createDeleteSessionConfirmation } from '../../src/chatpanel/delete-confirmation';
import { type InstalledDomEnvironment, installDomTestEnvironment } from './helpers/dom-test-env';

describe('chatpanel delete confirmation', () => {
  let dom: InstalledDomEnvironment | null = null;

  beforeEach(() => {
    dom = installDomTestEnvironment();
  });

  afterEach(() => {
    dom?.restore();
    dom = null;
  });

  it('keeps deletion available after choosing do not ask again', async () => {
    const shadowRoot = createDeleteConfirmationShadowRoot();
    const confirmation = createDeleteSessionConfirmation(shadowRoot);
    const overlay = queryRequiredElement<HTMLElement>(
      shadowRoot,
      '#speakeasy-delete-confirm-overlay',
    );
    const skipCheckbox = queryRequiredElement<HTMLInputElement>(
      shadowRoot,
      '#speakeasy-delete-confirm-skip',
    );
    const confirmButton = queryRequiredElement<HTMLButtonElement>(
      shadowRoot,
      '#speakeasy-delete-confirm-accept',
    );

    const firstDecisionPromise = confirmation.confirm('Session A');
    expect(overlay.hidden).toBe(false);

    skipCheckbox.checked = true;
    confirmButton.click();
    expect(await firstDecisionPromise).toBe(true);
    expect(overlay.hidden).toBe(true);

    await expect(confirmation.confirm('Session B')).resolves.toBe(true);
    expect(overlay.hidden).toBe(true);
  });

  function createDeleteConfirmationShadowRoot(): ShadowRoot {
    const host = document.createElement('div');
    document.body.append(host);
    const shadowRoot = host.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = `
      <div id="speakeasy-delete-confirm-overlay" hidden>
        <p id="speakeasy-delete-confirm-text"></p>
        <label>
          <input id="speakeasy-delete-confirm-skip" type="checkbox" />
        </label>
        <button id="speakeasy-delete-confirm-cancel" type="button">Cancel</button>
        <button id="speakeasy-delete-confirm-accept" type="button">Delete</button>
      </div>
    `;
    return shadowRoot;
  }
});

function queryRequiredElement<TElement extends Element>(
  root: ParentNode,
  selector: string,
): TElement {
  const element = root.querySelector<TElement>(selector);
  if (!element) {
    throw new Error(`Missing test element: ${selector}`);
  }

  return element;
}
