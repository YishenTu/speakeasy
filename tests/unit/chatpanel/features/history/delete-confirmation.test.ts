import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createDeleteSessionConfirmation } from '../../../../../src/chatpanel/features/history/delete-confirmation';
import {
  type InstalledDomEnvironment,
  installDomTestEnvironment,
} from '../../../helpers/dom-test-env';
import { queryRequiredElement } from '../../../helpers/query-required-element';
import { createShadowRootFixture } from '../../../helpers/shadow-root-fixture';

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

  it('sanitizes the session title and resolves false on cancel', async () => {
    const shadowRoot = createDeleteConfirmationShadowRoot();
    const confirmation = createDeleteSessionConfirmation(shadowRoot);
    const overlay = queryRequiredElement<HTMLElement>(
      shadowRoot,
      '#speakeasy-delete-confirm-overlay',
    );
    const text = queryRequiredElement<HTMLElement>(shadowRoot, '#speakeasy-delete-confirm-text');
    const cancelButton = queryRequiredElement<HTMLButtonElement>(
      shadowRoot,
      '#speakeasy-delete-confirm-cancel',
    );

    const decisionPromise = confirmation.confirm('\n "Weekly plan"\r\n ');
    expect(text.textContent).toBe('Delete "\'Weekly plan\'"?');
    expect(overlay.hidden).toBe(false);

    cancelButton.click();

    await expect(decisionPromise).resolves.toBe(false);
    expect(overlay.hidden).toBe(true);
  });

  it('keeps overlay clicks on child elements open and closes on direct overlay clicks', async () => {
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    const shadowRoot = createDeleteConfirmationShadowRoot();
    const confirmation = createDeleteSessionConfirmation(shadowRoot);
    const overlay = queryRequiredElement<HTMLElement>(
      shadowRoot,
      '#speakeasy-delete-confirm-overlay',
    );
    const text = queryRequiredElement<HTMLElement>(shadowRoot, '#speakeasy-delete-confirm-text');

    const decisionPromise = confirmation.confirm('   ');
    expect(text.textContent).toBe('Delete "this chat"?');

    text.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));
    expect(overlay.hidden).toBe(false);

    overlay.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));
    await expect(decisionPromise).resolves.toBe(false);
    expect(overlay.hidden).toBe(true);
  });

  it('reuses the same pending promise for concurrent confirmations', async () => {
    const shadowRoot = createDeleteConfirmationShadowRoot();
    const confirmation = createDeleteSessionConfirmation(shadowRoot);
    const text = queryRequiredElement<HTMLElement>(shadowRoot, '#speakeasy-delete-confirm-text');
    const confirmButton = queryRequiredElement<HTMLButtonElement>(
      shadowRoot,
      '#speakeasy-delete-confirm-accept',
    );

    const firstPromise = confirmation.confirm('First title');
    const secondPromise = confirmation.confirm('Second title');

    expect(secondPromise).toBe(firstPromise);
    expect(text.textContent).toBe('Delete "First title"?');

    confirmButton.click();

    await expect(firstPromise).resolves.toBe(true);
    await expect(secondPromise).resolves.toBe(true);
  });

  it('closes on Escape keydown and prevents default', async () => {
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    const shadowRoot = createDeleteConfirmationShadowRoot();
    const confirmation = createDeleteSessionConfirmation(shadowRoot);
    const overlay = queryRequiredElement<HTMLElement>(
      shadowRoot,
      '#speakeasy-delete-confirm-overlay',
    );

    const decisionPromise = confirmation.confirm('Session A');
    const escapeEvent = new testWindow.KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    const eventNotCanceled = overlay.dispatchEvent(escapeEvent);

    expect(eventNotCanceled).toBe(false);
    expect(escapeEvent.defaultPrevented).toBe(true);
    await expect(decisionPromise).resolves.toBe(false);
    expect(overlay.hidden).toBe(true);
  });

  function createDeleteConfirmationShadowRoot(): ShadowRoot {
    return createShadowRootFixture(`
      <div id="speakeasy-delete-confirm-overlay" hidden>
        <p id="speakeasy-delete-confirm-text"></p>
        <label>
          <input id="speakeasy-delete-confirm-skip" type="checkbox" />
        </label>
        <button id="speakeasy-delete-confirm-cancel" type="button">Cancel</button>
        <button id="speakeasy-delete-confirm-accept" type="button">Delete</button>
      </div>
    `);
  }
});
