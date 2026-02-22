import { queryRequiredElement } from './dom';
import { sanitizeSessionTitleForConfirmation } from './history-confirm';

interface DeleteSessionConfirmation {
  confirm: (sessionTitle: string) => Promise<boolean>;
}

export function createDeleteSessionConfirmation(shadowRoot: ShadowRoot): DeleteSessionConfirmation {
  const overlay = queryRequiredElement<HTMLElement>(
    shadowRoot,
    '#speakeasy-delete-confirm-overlay',
  );
  const message = queryRequiredElement<HTMLElement>(shadowRoot, '#speakeasy-delete-confirm-text');
  const skipCheckbox = queryRequiredElement<HTMLInputElement>(
    shadowRoot,
    '#speakeasy-delete-confirm-skip',
  );
  const cancelButton = queryRequiredElement<HTMLButtonElement>(
    shadowRoot,
    '#speakeasy-delete-confirm-cancel',
  );
  const acceptButton = queryRequiredElement<HTMLButtonElement>(
    shadowRoot,
    '#speakeasy-delete-confirm-accept',
  );

  let skipPrompts = false;
  let pendingResolve: ((decision: boolean) => void) | null = null;
  let pendingPromise: Promise<boolean> | null = null;

  const close = (decision: boolean): void => {
    overlay.hidden = true;
    const resolve = pendingResolve;
    pendingResolve = null;
    pendingPromise = null;
    if (resolve) {
      resolve(decision);
    }
  };

  cancelButton.addEventListener('click', () => {
    close(false);
  });

  acceptButton.addEventListener('click', () => {
    if (skipCheckbox.checked) {
      skipPrompts = true;
    }
    close(true);
  });

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      close(false);
    }
  });

  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(false);
    }
  });

  return {
    confirm: (sessionTitle: string): Promise<boolean> => {
      if (skipPrompts) {
        return Promise.resolve(true);
      }

      if (pendingPromise) {
        return pendingPromise;
      }

      message.textContent = `Delete "${sanitizeSessionTitleForConfirmation(sessionTitle)}"?`;
      skipCheckbox.checked = false;
      overlay.hidden = false;
      acceptButton.focus();

      pendingPromise = new Promise<boolean>((resolve) => {
        pendingResolve = resolve;
      });
      return pendingPromise;
    },
  };
}
