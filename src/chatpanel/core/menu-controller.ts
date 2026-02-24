export interface MenuController {
  setOpen: (open: boolean) => void;
  isOpen: () => boolean;
  toggle: () => boolean;
  dispose: () => void;
}

export interface CreateMenuControllerOptions {
  container: HTMLElement;
  trigger?: HTMLElement;
  openClassName?: string;
  closeOnOutsidePointerDown?: {
    target: Document | HTMLElement | ShadowRoot;
    isInside: (event: Event) => boolean;
  };
}

export function createMenuController(options: CreateMenuControllerOptions): MenuController {
  const openClassName = options.openClassName ?? 'open';
  let isOpen = options.container.classList.contains(openClassName);

  function syncTriggerExpanded(open: boolean): void {
    if (!options.trigger) {
      return;
    }
    options.trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function setOpen(nextOpen: boolean): void {
    isOpen = nextOpen;
    options.container.classList.toggle(openClassName, nextOpen);
    syncTriggerExpanded(nextOpen);
  }

  const onOutsidePointerDown = (event: Event): void => {
    if (!isOpen) {
      return;
    }
    if (!options.closeOnOutsidePointerDown) {
      return;
    }
    if (options.closeOnOutsidePointerDown.isInside(event)) {
      return;
    }
    setOpen(false);
  };

  syncTriggerExpanded(isOpen);

  if (options.closeOnOutsidePointerDown) {
    options.closeOnOutsidePointerDown.target.addEventListener('pointerdown', onOutsidePointerDown);
  }

  return {
    setOpen,
    isOpen: () => isOpen,
    toggle: () => {
      setOpen(!isOpen);
      return isOpen;
    },
    dispose: () => {
      if (!options.closeOnOutsidePointerDown) {
        return;
      }
      options.closeOnOutsidePointerDown.target.removeEventListener(
        'pointerdown',
        onOutsidePointerDown,
      );
    },
  };
}
