import { type FSWatcher, watch } from 'node:fs';
import { join, relative } from 'node:path';
import { buildExtension } from './build';

const rootDir = process.cwd();
const watchTargets = [
  join(rootDir, 'src'),
  join(rootDir, 'scripts'),
  join(rootDir, 'tailwind.config.js'),
  join(rootDir, 'tsconfig.json'),
  join(rootDir, 'biome.json'),
];

const ignoredPathSegments = ['/dist/', '/node_modules/', '/.git/'];
const watchers: FSWatcher[] = [];
const debounceMs = 140;

let pendingTimer: ReturnType<typeof setTimeout> | undefined;
let isBuilding = false;
let hasQueuedBuild = false;

void startDevLoop();

async function startDevLoop(): Promise<void> {
  console.log('[dev] Starting watch mode...');
  await runBuild('startup');

  for (const target of watchTargets) {
    try {
      const watcher = watch(target, { recursive: true }, (eventType, changedName) => {
        const changedPath = changedName ? join(target, changedName.toString()) : target;
        if (isIgnoredPath(changedPath)) {
          return;
        }

        scheduleBuild(`${eventType}: ${relative(rootDir, changedPath)}`);
      });

      watchers.push(watcher);
      console.log(`[dev] Watching ${relative(rootDir, target) || '.'}`);
    } catch (error: unknown) {
      console.error(`[dev] Failed to watch ${target}: ${toErrorMessage(error)}`);
    }
  }

  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
}

function scheduleBuild(reason: string): void {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
  }

  pendingTimer = setTimeout(() => {
    pendingTimer = undefined;
    void runBuild(reason);
  }, debounceMs);
}

async function runBuild(reason: string): Promise<void> {
  if (isBuilding) {
    hasQueuedBuild = true;
    return;
  }

  isBuilding = true;
  const startedAt = Date.now();
  console.log(`[dev] Rebuilding (${reason})...`);

  try {
    await buildExtension({ clean: true });
    const elapsedMs = Date.now() - startedAt;
    console.log(`[dev] Build succeeded in ${elapsedMs}ms.`);
  } catch (error: unknown) {
    console.error(`[dev] Build failed: ${toErrorMessage(error)}`);
  } finally {
    isBuilding = false;

    if (hasQueuedBuild) {
      hasQueuedBuild = false;
      void runBuild('queued change');
    }
  }
}

function shutdown(signal: NodeJS.Signals): void {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = undefined;
  }

  for (const watcher of watchers) {
    watcher.close();
  }

  console.log(`[dev] Stopped watch mode (${signal}).`);
  process.exit(0);
}

function isIgnoredPath(filePath: string): boolean {
  const normalized = `/${relative(rootDir, filePath).replaceAll('\\', '/')}/`;
  return ignoredPathSegments.some((segment) => normalized.includes(segment));
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unknown error';
}
