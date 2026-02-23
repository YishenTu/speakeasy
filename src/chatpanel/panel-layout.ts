const PANEL_MARGIN_PX = 12;
const DEFAULT_RIGHT_GAP_PX = 50;
const MIN_PANEL_WIDTH_PX = 320;
const MIN_PANEL_HEIGHT_PX = 260;
const DEFAULT_PANEL_WIDTH_PX = 430;
const DEFAULT_PANEL_HEIGHT_RATIO = 0.8;

export type PanelLayout = {
  width: number;
  height: number;
  left: number;
  top: number;
};

type DragInteraction = {
  kind: 'drag';
  pointerId: number;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
};

type ResizeInteraction = {
  kind: 'resize';
  pointerId: number;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  startWidth: number;
  startHeight: number;
  direction: ResizeDirection;
};

type InteractionState = DragInteraction | ResizeInteraction;

type ResizeDirection = {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
};

export interface PanelLayoutController {
  getLayout(): PanelLayout;
  clampAndSync(): void;
  cancelInteraction(): void;
  dispose(): void;
}

export interface PanelLayoutDeps {
  shell: HTMLElement;
  dragHandle: HTMLElement;
  resizeHandles: HTMLElement[];
  onLayoutApplied: () => void;
}

export function createPanelLayoutController(deps: PanelLayoutDeps): PanelLayoutController {
  const { shell, dragHandle, resizeHandles, onLayoutApplied } = deps;

  let preferredLayout = createDefaultLayout();
  let renderedLayout = clampPanelLayout(preferredLayout);
  let interactionState: InteractionState | null = null;
  let previousUserSelect = '';
  let hasUserSelectOverride = false;

  const syncLayout = (): void => {
    renderedLayout = clampPanelLayout(preferredLayout);
    applyPanelLayout(shell, renderedLayout);
    onLayoutApplied();
  };

  const onWindowResize = (): void => {
    syncLayout();
  };

  const onDragHandlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    if (event.target instanceof Element && event.target.closest('button')) {
      return;
    }

    event.preventDefault();
    interactionState = {
      kind: 'drag',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: renderedLayout.left,
      startTop: renderedLayout.top,
    };
    shell.setPointerCapture(event.pointerId);
    startInteractionLock();
  };

  const onShellPointerMove = (event: PointerEvent): void => {
    if (!interactionState || event.pointerId !== interactionState.pointerId) {
      return;
    }

    if (interactionState.kind === 'drag') {
      const dragLayout = clampPanelLayout({
        ...renderedLayout,
        left: interactionState.startLeft + (event.clientX - interactionState.startX),
        top: interactionState.startTop + (event.clientY - interactionState.startY),
      });
      preferredLayout = {
        ...preferredLayout,
        left: dragLayout.left,
        top: dragLayout.top,
      };
    } else {
      preferredLayout = calculateResizedLayout(
        interactionState,
        event.clientX - interactionState.startX,
        event.clientY - interactionState.startY,
      );
    }

    syncLayout();
  };

  const onShellPointerEnd = (event: PointerEvent): void => {
    if (!interactionState || event.pointerId !== interactionState.pointerId) {
      return;
    }

    endInteractionLock(interactionState.pointerId);
    interactionState = null;
  };

  const cancelInteraction = (): void => {
    if (!interactionState) {
      return;
    }

    endInteractionLock(interactionState.pointerId);
    interactionState = null;
  };

  function startInteractionLock(): void {
    if (!hasUserSelectOverride) {
      previousUserSelect = document.documentElement.style.userSelect;
      hasUserSelectOverride = true;
    }
    document.documentElement.style.userSelect = 'none';
  }

  function endInteractionLock(pointerId: number): void {
    if (shell.hasPointerCapture(pointerId)) {
      shell.releasePointerCapture(pointerId);
    }

    if (hasUserSelectOverride) {
      document.documentElement.style.userSelect = previousUserSelect;
      hasUserSelectOverride = false;
    }
  }

  const resizePointerDownHandlers: Array<{
    handle: HTMLElement;
    handler: (e: PointerEvent) => void;
  }> = [];
  for (const resizeHandle of resizeHandles) {
    const handler = (event: PointerEvent): void => {
      if (event.button !== 0) {
        return;
      }

      const resizeValue = resizeHandle.dataset.resize;
      if (!resizeValue) {
        return;
      }

      event.preventDefault();
      interactionState = {
        kind: 'resize',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: renderedLayout.left,
        startTop: renderedLayout.top,
        startWidth: renderedLayout.width,
        startHeight: renderedLayout.height,
        direction: parseResizeDirection(resizeValue),
      };
      shell.setPointerCapture(event.pointerId);
      startInteractionLock();
    };
    resizeHandle.addEventListener('pointerdown', handler);
    resizePointerDownHandlers.push({ handle: resizeHandle, handler });
  }

  window.addEventListener('resize', onWindowResize);
  dragHandle.addEventListener('pointerdown', onDragHandlePointerDown);
  shell.addEventListener('pointermove', onShellPointerMove);
  shell.addEventListener('pointerup', onShellPointerEnd);
  shell.addEventListener('pointercancel', onShellPointerEnd);

  return {
    getLayout(): PanelLayout {
      return renderedLayout;
    },

    clampAndSync(): void {
      syncLayout();
    },

    cancelInteraction,

    dispose(): void {
      cancelInteraction();

      window.removeEventListener('resize', onWindowResize);
      dragHandle.removeEventListener('pointerdown', onDragHandlePointerDown);
      shell.removeEventListener('pointermove', onShellPointerMove);
      shell.removeEventListener('pointerup', onShellPointerEnd);
      shell.removeEventListener('pointercancel', onShellPointerEnd);
      for (const { handle, handler } of resizePointerDownHandlers) {
        handle.removeEventListener('pointerdown', handler);
      }
    },
  };
}

export function createDefaultLayout(): PanelLayout {
  const bounds = getViewportBounds();
  const width = clampNumber(DEFAULT_PANEL_WIDTH_PX, bounds.minWidth, bounds.maxWidth);
  const height = clampNumber(
    Math.round(window.innerHeight * DEFAULT_PANEL_HEIGHT_RATIO),
    bounds.minHeight,
    bounds.maxHeight,
  );

  return clampPanelLayout({
    width,
    height,
    left: window.innerWidth - width - DEFAULT_RIGHT_GAP_PX,
    top: Math.round((window.innerHeight - height) / 2),
  });
}

export function clampPanelLayout(nextLayout: PanelLayout): PanelLayout {
  const bounds = getViewportBounds();
  const width = clampNumber(nextLayout.width, bounds.minWidth, bounds.maxWidth);
  const height = clampNumber(nextLayout.height, bounds.minHeight, bounds.maxHeight);
  const maxLeft = window.innerWidth - width - PANEL_MARGIN_PX;
  const maxTop = window.innerHeight - height - PANEL_MARGIN_PX;

  return {
    width,
    height,
    left: clampNumber(nextLayout.left, PANEL_MARGIN_PX, maxLeft),
    top: clampNumber(nextLayout.top, PANEL_MARGIN_PX, maxTop),
  };
}

export function applyPanelLayout(shell: HTMLElement, layout: PanelLayout): void {
  shell.style.width = `${layout.width}px`;
  shell.style.height = `${layout.height}px`;
  shell.style.left = `${layout.left}px`;
  shell.style.top = `${layout.top}px`;
}

function getViewportBounds(): {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
} {
  const maxWidth = Math.max(1, window.innerWidth - PANEL_MARGIN_PX * 2);
  const maxHeight = Math.max(1, window.innerHeight - PANEL_MARGIN_PX * 2);

  return {
    minWidth: Math.min(MIN_PANEL_WIDTH_PX, maxWidth),
    maxWidth,
    minHeight: Math.min(MIN_PANEL_HEIGHT_PX, maxHeight),
    maxHeight,
  };
}

function clampNumber(value: number, minValue: number, maxValue: number): number {
  return Math.min(Math.max(value, minValue), maxValue);
}

function parseResizeDirection(value: string): ResizeDirection {
  const parts = value.split('-');
  return {
    top: parts.includes('top'),
    right: parts.includes('right'),
    bottom: parts.includes('bottom'),
    left: parts.includes('left'),
  };
}

function calculateResizedLayout(
  interaction: ResizeInteraction,
  deltaX: number,
  deltaY: number,
): PanelLayout {
  const bounds = getViewportBounds();
  const minX = PANEL_MARGIN_PX;
  const maxX = window.innerWidth - PANEL_MARGIN_PX;
  const minY = PANEL_MARGIN_PX;
  const maxY = window.innerHeight - PANEL_MARGIN_PX;
  const startRight = interaction.startLeft + interaction.startWidth;
  const startBottom = interaction.startTop + interaction.startHeight;

  let left = interaction.startLeft;
  let width = interaction.startWidth;
  let top = interaction.startTop;
  let height = interaction.startHeight;

  if (interaction.direction.left) {
    const minLeft = Math.max(minX, startRight - bounds.maxWidth);
    const maxLeft = Math.min(startRight - bounds.minWidth, maxX - bounds.minWidth);
    left = clampNumber(interaction.startLeft + deltaX, minLeft, maxLeft);
    width = startRight - left;
  } else if (interaction.direction.right) {
    const minRight = Math.max(interaction.startLeft + bounds.minWidth, minX + bounds.minWidth);
    const maxRight = Math.min(interaction.startLeft + bounds.maxWidth, maxX);
    const right = clampNumber(startRight + deltaX, minRight, maxRight);
    width = right - interaction.startLeft;
  }

  if (interaction.direction.top) {
    const minTop = Math.max(minY, startBottom - bounds.maxHeight);
    const maxTop = Math.min(startBottom - bounds.minHeight, maxY - bounds.minHeight);
    top = clampNumber(interaction.startTop + deltaY, minTop, maxTop);
    height = startBottom - top;
  } else if (interaction.direction.bottom) {
    const minBottom = Math.max(interaction.startTop + bounds.minHeight, minY + bounds.minHeight);
    const maxBottom = Math.min(interaction.startTop + bounds.maxHeight, maxY);
    const bottom = clampNumber(startBottom + deltaY, minBottom, maxBottom);
    height = bottom - interaction.startTop;
  }

  return clampPanelLayout({
    left,
    top,
    width,
    height,
  });
}
