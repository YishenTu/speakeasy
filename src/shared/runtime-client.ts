import type { OpenOptionsPayload, RuntimeRequest, RuntimeResponse } from './runtime';

export async function sendRuntimeRequest<TPayload>(request: RuntimeRequest): Promise<TPayload> {
  const response = (await chrome.runtime.sendMessage(request)) as
    | RuntimeResponse<TPayload>
    | undefined;

  if (!response) {
    throw new Error('Background service did not return a response.');
  }

  if (!response.ok) {
    throw new Error(response.error || 'Background service failed to handle the request.');
  }

  return response.payload;
}

export async function openOptionsPage(): Promise<void> {
  await sendRuntimeRequest<OpenOptionsPayload>({ type: 'app/open-options' });
}

export async function requestOpenOptionsPage(): Promise<string | null> {
  const response = (await chrome.runtime.sendMessage({
    type: 'app/open-options',
  })) as RuntimeResponse<OpenOptionsPayload> | undefined;

  if (response?.ok) {
    return null;
  }

  return response?.error || 'Unable to open settings.';
}
