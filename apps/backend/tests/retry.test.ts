import { describe, expect, it, vi } from 'vitest';
import { withGoogleRetry } from '../src/sheets/retry';

describe('Google retry policy', () => {
  it('retries 429 and succeeds', async () => {
    let attempts = 0;
    const sleep = vi.fn(async () => undefined);
    const result = await withGoogleRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw { response: { status: 429 } };
        return 'ok';
      },
      { sleep, random: () => 0.5 },
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
  it('does not retry a permission error', async () => {
    let attempts = 0;
    await expect(
      withGoogleRetry(
        async () => {
          attempts += 1;
          throw { response: { status: 403 } };
        },
        { sleep: async () => undefined },
      ),
    ).rejects.toBeTruthy();
    expect(attempts).toBe(1);
  });
});
