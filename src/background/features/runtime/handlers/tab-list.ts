import type { OpenTabSummary, TabListOpenPayload } from '../../../../shared/runtime';
import { isPositiveInteger } from './tab-capture';

const SUPPORTED_TAB_SCHEMES = new Set(['http:', 'https:', 'file:']);
const UNTITLED_TAB_FALLBACK = 'Untitled tab';

export async function handleListOpenTabs(): Promise<TabListOpenPayload> {
  const tabsApi = chrome.tabs;
  if (!tabsApi?.query) {
    throw new Error('Chrome tabs API is unavailable.');
  }

  const tabs = await tabsApi.query({});
  const normalizedTabs = tabs
    .flatMap((tab) => {
      const normalized = normalizeOpenTab(tab);
      return normalized ? [normalized] : [];
    })
    .sort(compareOpenTabs);

  return {
    tabs: normalizedTabs,
  };
}

function normalizeOpenTab(tab: chrome.tabs.Tab): OpenTabSummary | null {
  const tabId = tab.id;
  const windowId = tab.windowId;
  const url = tab.url?.trim() ?? '';
  if (!isPositiveInteger(tabId) || !Number.isFinite(windowId) || !hasSupportedScheme(url)) {
    return null;
  }

  return {
    tabId,
    windowId,
    active: tab.active === true,
    title: normalizeTitle(tab.title),
    url,
    hostname: toHostname(url),
  };
}

function compareOpenTabs(left: OpenTabSummary, right: OpenTabSummary): number {
  if (left.windowId !== right.windowId) {
    return left.windowId - right.windowId;
  }

  if (left.active !== right.active) {
    return left.active ? -1 : 1;
  }

  const byTitle = left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
  if (byTitle !== 0) {
    return byTitle;
  }

  return left.tabId - right.tabId;
}

function normalizeTitle(title: string | undefined): string {
  const trimmed = title?.trim() ?? '';
  return trimmed || UNTITLED_TAB_FALLBACK;
}

function hasSupportedScheme(url: string): boolean {
  const colonIndex = url.indexOf(':');
  return colonIndex > 0 && SUPPORTED_TAB_SCHEMES.has(`${url.slice(0, colonIndex).toLowerCase()}:`);
}

function toHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
