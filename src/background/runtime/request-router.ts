import type { RuntimeRequest } from '../../shared/runtime';
import { assertNever, isRecord } from '../utils';
import type { RuntimePayload, RuntimeRequestRoutingInput } from './contracts';

export function isRuntimeRequest(value: unknown): value is RuntimeRequest {
  if (!isRecord(value)) {
    return false;
  }

  const type = value.type;
  return (
    type === 'chat/send' ||
    type === 'chat/regen' ||
    type === 'chat/fork' ||
    type === 'chat/switch-branch' ||
    type === 'chat/load' ||
    type === 'chat/new' ||
    type === 'chat/delete' ||
    type === 'chat/list' ||
    type === 'chat/upload-files' ||
    type === 'app/open-options'
  );
}

export async function routeRuntimeRequest(
  input: RuntimeRequestRoutingInput,
): Promise<RuntimePayload> {
  const { request } = input;

  switch (request.type) {
    case 'app/open-options':
      return input.handleOpenOptions();
    case 'chat/load':
      return input.handleLoadChat(request.chatId);
    case 'chat/new':
      return input.handleNewChat();
    case 'chat/send':
      return input.handleSendMessage(request);
    case 'chat/regen':
      return input.handleRegenerate(request);
    case 'chat/fork':
      return input.handleForkChat(request);
    case 'chat/switch-branch':
      return input.handleSwitchBranch(request);
    case 'chat/delete':
      return input.handleDeleteChat(request.chatId);
    case 'chat/list':
      return input.handleListChats();
    case 'chat/upload-files':
      return input.handleUploadFiles(request);
    default:
      return assertNever(request);
  }
}
