const versionNode = document.querySelector<HTMLElement>('#version');

if (!versionNode) {
  throw new Error('Options page is missing the version node.');
}

versionNode.textContent = chrome.runtime.getManifest().version;
