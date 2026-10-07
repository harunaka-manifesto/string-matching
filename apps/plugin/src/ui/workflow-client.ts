import type { WorkflowAction } from '@string-binder/contracts';
import type { UiBridge } from './bridge';

export class ClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: any,
  ) {
    super(message);
  }
}

/** File-wide Figma work (every page, thousands of variables) outlasts a network timeout. */
const SLOW: readonly WorkflowAction[] = [
  'refresh',
  'preflight',
  'deliver',
  'library:scan',
  'library:apply',
  'library:publish',
];

export function request<T>(
  bridge: UiBridge,
  action: WorkflowAction,
  data: unknown = {},
): Promise<T> {
  const operationId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        unsubscribe();
        reject(
          new ClientError('TIMEOUT', 'The operation timed out. Saved requests remain recoverable.'),
        );
      },
      SLOW.includes(action) ? 600_000 : 60_000,
    );
    const unsubscribe = bridge.subscribe((event) => {
      if (
        (event.type === 'workflow:result' || event.type === 'workflow:error') &&
        event.operationId === operationId
      ) {
        clearTimeout(timer);
        unsubscribe();
        if (event.type === 'workflow:result') resolve(event.data as T);
        else reject(new ClientError(event.code, event.message, event.details));
      }
    });
    bridge.send({ type: 'workflow', operationId, action, data });
  });
}
