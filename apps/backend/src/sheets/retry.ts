import { AppError } from '@ux-copy-sync/contracts';

export type RetryableError = {
  response?: { status?: number };
  code?: number | string;
  status?: number;
};

function statusOf(error: RetryableError): number | undefined {
  return (
    error.response?.status ??
    error.status ??
    (typeof error.code === 'number' ? error.code : undefined)
  );
}

export function isRetryableGoogleError(error: unknown): boolean {
  const status = statusOf((error ?? {}) as RetryableError);
  return status === 429 || (status !== undefined && status >= 500 && status <= 599);
}

export async function withGoogleRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: {
    attempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    deadlineAt?: number;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
  } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) break;
    try {
      return await operation(attempt + 1);
    } catch (error) {
      lastError = error;
      if (!isRetryableGoogleError(error) || attempt === attempts - 1) break;
      const base = Math.min(
        options.maxDelayMs ?? 1200,
        (options.baseDelayMs ?? 100) * 2 ** attempt,
      );
      const delay = Math.floor(base / 2 + (random() * base) / 2);
      const remaining =
        options.deadlineAt === undefined ? delay : Math.max(0, options.deadlineAt - Date.now());
      if (remaining <= 0) break;
      await sleep(Math.min(delay, remaining));
    }
  }
  if (isRetryableGoogleError(lastError))
    throw new AppError(
      'SHEET_RATE_LIMITED',
      'Google Sheets is temporarily rate limited. Try again shortly.',
    );
  if (lastError === undefined)
    throw new AppError(
      'SHEET_READ_FAILED',
      'Google Sheets did not respond within the request budget.',
    );
  throw lastError;
}
