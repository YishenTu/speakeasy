import type {
  MutationEnqueuer,
  PendingSessionTitleGeneration,
  RuntimeDependencies,
} from './contracts';

export async function generateAndPersistSessionTitle(
  pending: PendingSessionTitleGeneration,
  dependencies: RuntimeDependencies,
  enqueueMutation: MutationEnqueuer,
): Promise<void> {
  let generatedTitle = '';
  try {
    generatedTitle = await dependencies.generateSessionTitle(
      pending.apiKey,
      pending.firstUserQuery,
      pending.attachments,
    );
  } catch (error: unknown) {
    console.warn('Failed to generate chat session title.', error);
    return;
  }

  if (!generatedTitle) {
    return;
  }

  try {
    await enqueueMutation(async () => {
      const session = await dependencies.repository.getSession(pending.chatId);
      if (!session || session.title?.trim()) {
        return;
      }
      session.title = generatedTitle;
      await dependencies.repository.upsertSession(session, dependencies.now().getTime());
    });
  } catch (error: unknown) {
    console.warn('Failed to persist generated chat session title.', error);
  }
}
