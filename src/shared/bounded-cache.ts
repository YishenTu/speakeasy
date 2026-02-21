interface GetOrCreateBoundedCacheValueInput<TKey, TValue> {
  cache: Map<TKey, TValue>;
  key: TKey;
  maxSize: number;
  create: () => TValue;
}

export function getOrCreateBoundedCacheValue<TKey, TValue>(
  input: GetOrCreateBoundedCacheValueInput<TKey, TValue>,
): TValue {
  if (!Number.isInteger(input.maxSize) || input.maxSize < 1) {
    throw new Error('Cache maxSize must be a positive integer.');
  }

  const cached = input.cache.get(input.key);
  if (cached) {
    return cached;
  }

  const value = input.create();
  input.cache.set(input.key, value);
  if (input.cache.size > input.maxSize) {
    const oldestKey = input.cache.keys().next().value;
    if (oldestKey !== undefined) {
      input.cache.delete(oldestKey);
    }
  }

  return value;
}
