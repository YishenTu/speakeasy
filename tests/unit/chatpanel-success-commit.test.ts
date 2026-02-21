import { describe, expect, it } from 'bun:test';
import { runWithSuccessCommit } from '../../src/chatpanel/success-commit';

describe('runWithSuccessCommit', () => {
  it('returns the operation result and runs the commit callback on success', async () => {
    let commitCalls = 0;

    const result = await runWithSuccessCommit(
      async () => {
        return 'ok';
      },
      () => {
        commitCalls += 1;
      },
    );

    expect(result).toBe('ok');
    expect(commitCalls).toBe(1);
  });

  it('does not run the commit callback when the operation throws', async () => {
    let commitCalls = 0;

    await expect(
      runWithSuccessCommit(
        async () => {
          throw new Error('boom');
        },
        () => {
          commitCalls += 1;
        },
      ),
    ).rejects.toThrow(/boom/i);

    expect(commitCalls).toBe(0);
  });
});
