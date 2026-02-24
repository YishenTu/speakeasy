interface PanelVisibilityDeps {
  shell: HTMLElement;
  input: HTMLTextAreaElement;
  clampLayout: () => void;
  cancelLayoutInteraction: () => void;
  onOpen: () => Promise<void>;
  onClose: () => void;
}

export interface PanelVisibilityController {
  isOpen(): boolean;
  open(): Promise<void>;
  close(): void;
  toggle(): Promise<void>;
}

export function createPanelVisibilityController(
  deps: PanelVisibilityDeps,
): PanelVisibilityController {
  let isOpen = false;

  async function open(): Promise<void> {
    isOpen = true;
    deps.shell.hidden = false;
    deps.clampLayout();
    await deps.onOpen();
    deps.input.focus();
  }

  function close(): void {
    deps.cancelLayoutInteraction();
    deps.onClose();
    isOpen = false;
    deps.shell.hidden = true;
  }

  async function toggle(): Promise<void> {
    if (isOpen) {
      close();
      return;
    }

    await open();
  }

  return {
    isOpen: () => isOpen,
    open,
    close,
    toggle,
  };
}
