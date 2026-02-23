export interface ChromeStorageChange {
  newValue?: unknown;
  oldValue?: unknown;
}

export type ChromeStorageOnChangedListener = (
  changes: Record<string, ChromeStorageChange>,
  areaName?: string,
) => void;

export function createChromeStorageOnChangedMock(): {
  onChanged: { addListener: (listener: ChromeStorageOnChangedListener) => void };
  emitChanged: (changes: Record<string, ChromeStorageChange>, areaName?: string) => void;
} {
  let listener: ChromeStorageOnChangedListener | null = null;

  return {
    onChanged: {
      addListener: (nextListener) => {
        listener = nextListener;
      },
    },
    emitChanged: (changes, areaName) => {
      listener?.(changes, areaName);
    },
  };
}

type StorageLocalQuery = string | string[] | Record<string, unknown>;

export interface ChromeStorageLocalMockOptions {
  onSet?: (items: Record<string, unknown>) => void | Promise<void>;
  onRemove?: (keys: string | string[]) => void | Promise<void>;
}

export function createChromeStorageLocalMock(
  storageState: Record<string, unknown>,
  options: ChromeStorageLocalMockOptions = {},
): {
  get: (query?: StorageLocalQuery) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
} {
  return {
    get: async (query) => {
      if (typeof query === 'string') {
        return { [query]: storageState[query] };
      }

      if (Array.isArray(query)) {
        const result: Record<string, unknown> = {};
        for (const key of query) {
          result[key] = storageState[key];
        }
        return result;
      }

      if (query && typeof query === 'object') {
        const result: Record<string, unknown> = {};
        for (const key of Object.keys(query)) {
          result[key] = storageState[key] ?? query[key];
        }
        return result;
      }

      return { ...storageState };
    },
    set: async (items) => {
      await options.onSet?.(items);
      Object.assign(storageState, items);
    },
    remove: async (keys) => {
      await options.onRemove?.(keys);
      if (typeof keys === 'string') {
        delete storageState[keys];
        return;
      }
      for (const key of keys) {
        delete storageState[key];
      }
    },
  };
}

export function createChromeRuntimeSendMessageMock<TRequest = unknown, TResponse = unknown>(
  handler: (request: TRequest) => TResponse | Promise<TResponse>,
): { sendMessage: (request: TRequest) => Promise<TResponse> } {
  return {
    sendMessage: async (request) => handler(request),
  };
}
