import { describe, expect, test } from 'bun:test';
import { runWhenIdle, runWithBusyState } from '../../../../src/chatpanel/core/busy-state';

describe('runWithBusyState', () => {
  test('sets and clears busy state around successful actions', async () => {
    const transitions: boolean[] = [];
    let busy = false;

    const result = await runWithBusyState(
      {
        isBusy: () => busy,
        setBusy: (nextBusy) => {
          transitions.push(nextBusy);
          busy = nextBusy;
        },
      },
      async () => 'ok',
    );

    expect(result).toBe('ok');
    expect(transitions).toEqual([true, false]);
    expect(busy).toBe(false);
  });

  test('clears busy state when action throws', async () => {
    const transitions: boolean[] = [];
    let busy = false;

    await expect(
      runWithBusyState(
        {
          isBusy: () => busy,
          setBusy: (nextBusy) => {
            transitions.push(nextBusy);
            busy = nextBusy;
          },
        },
        async () => {
          throw new Error('failed');
        },
      ),
    ).rejects.toThrow('failed');

    expect(transitions).toEqual([true, false]);
    expect(busy).toBe(false);
  });
});

describe('runWhenIdle', () => {
  test('skips action when already busy', async () => {
    const transitions: boolean[] = [];
    let runs = 0;

    const result = await runWhenIdle(
      {
        isBusy: () => true,
        setBusy: (nextBusy) => {
          transitions.push(nextBusy);
        },
      },
      async () => {
        runs += 1;
        return 'noop';
      },
    );

    expect(result).toBeUndefined();
    expect(runs).toBe(0);
    expect(transitions).toEqual([]);
  });

  test('runs action when not busy', async () => {
    const transitions: boolean[] = [];
    let busy = false;

    const result = await runWhenIdle(
      {
        isBusy: () => busy,
        setBusy: (nextBusy) => {
          transitions.push(nextBusy);
          busy = nextBusy;
        },
      },
      async () => 'done',
    );

    expect(result).toBe('done');
    expect(transitions).toEqual([true, false]);
  });
});
