import { describe, expect, it } from 'bun:test';
import { getOrCreateBoundedCacheValue } from '../../src/shared/bounded-cache';

describe('getOrCreateBoundedCacheValue', () => {
  it('returns cached values without calling create again', () => {
    const cache = new Map<string, { value: number }>();
    let createCalls = 0;

    const first = getOrCreateBoundedCacheValue({
      cache,
      key: 'alpha',
      maxSize: 2,
      create: () => {
        createCalls += 1;
        return { value: 1 };
      },
    });
    const second = getOrCreateBoundedCacheValue({
      cache,
      key: 'alpha',
      maxSize: 2,
      create: () => {
        createCalls += 1;
        return { value: 2 };
      },
    });

    expect(first).toBe(second);
    expect(createCalls).toBe(1);
  });

  it('evicts the oldest entry when max size is exceeded', () => {
    const cache = new Map<string, number>();

    getOrCreateBoundedCacheValue({
      cache,
      key: 'first',
      maxSize: 2,
      create: () => 1,
    });
    getOrCreateBoundedCacheValue({
      cache,
      key: 'second',
      maxSize: 2,
      create: () => 2,
    });
    getOrCreateBoundedCacheValue({
      cache,
      key: 'third',
      maxSize: 2,
      create: () => 3,
    });

    expect(cache.has('first')).toBe(false);
    expect(cache.get('second')).toBe(2);
    expect(cache.get('third')).toBe(3);
  });

  it('throws when max size is not a positive integer', () => {
    const cache = new Map<string, number>();

    expect(() =>
      getOrCreateBoundedCacheValue({
        cache,
        key: 'x',
        maxSize: 0,
        create: () => 1,
      }),
    ).toThrow(/positive integer/i);
  });
});
