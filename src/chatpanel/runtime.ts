export async function requestOpenSettings(): Promise<string | null> {
  const response = (await chrome.runtime.sendMessage({
    type: 'app/open-options',
  })) as { ok: true; payload: { opened: true } } | { ok: false; error: string } | undefined;

  if (response?.ok) {
    return null;
  }

  return response?.error || 'Unable to open settings.';
}
