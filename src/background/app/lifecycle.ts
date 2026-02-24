export function registerBackgroundLifecycleHandlers(): void {
  chrome.runtime.onInstalled.addListener(() => {
    console.info('Speakeasy installed.');
  });

  chrome.runtime.onStartup.addListener(() => {
    console.info('Speakeasy background service worker started.');
  });

  chrome.action.onClicked.addListener((tab) => {
    if (typeof tab.id !== 'number') {
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: 'overlay/toggle' }, () => {
      if (chrome.runtime.lastError) {
        console.debug(
          `Speakeasy overlay is not available on this page: ${chrome.runtime.lastError.message}`,
        );
      }
    });
  });
}
