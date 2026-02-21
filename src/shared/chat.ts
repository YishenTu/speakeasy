export type MessageRole = 'assistant' | 'user';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
}

const PLACEHOLDER_RESPONSE =
  'Placeholder response from Speakeasy. Connect your AI backend in src/shared/chat.ts.';

export async function sendMessage(userInput: string): Promise<ChatMessage> {
  const normalizedInput = userInput.trim();

  if (!normalizedInput) {
    throw new Error('Cannot send an empty message.');
  }

  await new Promise((resolve) => {
    setTimeout(resolve, 450);
  });

  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: PLACEHOLDER_RESPONSE,
  };
}
