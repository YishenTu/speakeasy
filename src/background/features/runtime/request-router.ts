import { assertNever } from '../../core/utils';
import type { RuntimePayload, RuntimeRequestRoutingInput } from './contracts';

export async function routeRuntimeRequest(
  input: RuntimeRequestRoutingInput,
): Promise<RuntimePayload> {
  const { request } = input;

  switch (request.type) {
    case 'app/open-options':
      return input.handleOpenOptions();
    case 'chat/get-tab-context':
      return input.handleGetChatTabContext();
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
    case 'tab/list-open':
      return input.handleListOpenTabs();
    case 'tab/capture-full-page':
      return input.handleCaptureFullPageScreenshot();
    case 'tab/capture-full-page-by-id':
      return input.handleCaptureFullPageScreenshotById(request);
    case 'tab/extract-text-by-id':
      return input.handleExtractTextById(request);
    default:
      return assertNever(request);
  }
}
