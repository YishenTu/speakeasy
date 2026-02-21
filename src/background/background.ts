chrome.runtime.onInstalled.addListener(() => {
  console.info('Speakeasy installed.');
});

chrome.runtime.onStartup.addListener(() => {
  console.info('Speakeasy background service worker started.');
});
