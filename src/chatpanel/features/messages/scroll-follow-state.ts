export interface MessageListScrollMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

export interface MessageListAutoScrollState {
  shouldAutoScroll: () => boolean;
  updateFromScroll: (metrics: MessageListScrollMetrics) => void;
  resumeAutoScroll: () => void;
}

interface MessageListAutoScrollStateOptions {
  bottomThresholdPx?: number;
}

const DEFAULT_BOTTOM_THRESHOLD_PX = 16;

export function createMessageListAutoScrollState(
  options: MessageListAutoScrollStateOptions = {},
): MessageListAutoScrollState {
  let autoScrollEnabled = true;
  let lastScrollTop: number | null = null;
  const bottomThresholdPx = normalizeBottomThreshold(options.bottomThresholdPx);

  return {
    shouldAutoScroll: () => autoScrollEnabled,
    updateFromScroll: (metrics) => {
      const currentScrollTop = Math.max(0, metrics.scrollTop);
      const movedUp = lastScrollTop !== null && currentScrollTop < lastScrollTop;

      if (movedUp) {
        autoScrollEnabled = false;
      } else if (isMessageListNearBottom(metrics, bottomThresholdPx)) {
        autoScrollEnabled = true;
      }

      lastScrollTop = currentScrollTop;
    },
    resumeAutoScroll: () => {
      autoScrollEnabled = true;
    },
  };
}

function normalizeBottomThreshold(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_BOTTOM_THRESHOLD_PX;
  }

  return Math.max(0, value);
}

function isMessageListNearBottom(
  metrics: MessageListScrollMetrics,
  bottomThresholdPx: number,
): boolean {
  const scrollTop = Math.max(0, metrics.scrollTop);
  const clientHeight = Math.max(0, metrics.clientHeight);
  const scrollHeight = Math.max(0, metrics.scrollHeight);
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight);

  if (maxScrollTop === 0) {
    return true;
  }

  return scrollTop >= maxScrollTop - bottomThresholdPx;
}
