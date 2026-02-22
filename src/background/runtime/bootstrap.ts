import type { RuntimeDependencies } from './contracts';

const BOOTSTRAP_READY_WAIT_MS = 50;

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

export function createRuntimeBootstrapGate(dependencies: RuntimeDependencies): {
  ensureReady: () => Promise<void>;
} {
  let storageReady = false;
  let bootstrapCompleted = false;

  const ready = (async () => {
    try {
      await dependencies.bootstrapChatStorage();
      await pruneExpiredSessionsBestEffort(dependencies, dependencies.now().getTime());
      storageReady = true;
    } catch (error: unknown) {
      console.error('Failed to initialize chat storage bootstrap.', error);
    } finally {
      bootstrapCompleted = true;
    }
  })();

  const ensureReady = async (): Promise<void> => {
    if (!bootstrapCompleted) {
      await Promise.race([ready, sleep(BOOTSTRAP_READY_WAIT_MS)]);
    }

    if (!bootstrapCompleted) {
      throw new Error('Chat storage is still initializing. Please try again in a few seconds.');
    }

    await ready;
    if (!storageReady) {
      throw new Error('Chat storage is unavailable. Reload the extension and try again.');
    }
  };

  return {
    ensureReady,
  };
}

export async function pruneExpiredSessionsBestEffort(
  dependencies: RuntimeDependencies,
  nowMs: number,
): Promise<void> {
  try {
    await dependencies.repository.pruneExpiredSessions(nowMs);
  } catch (error: unknown) {
    console.warn('Failed to prune expired chat sessions.', error);
  }
}
