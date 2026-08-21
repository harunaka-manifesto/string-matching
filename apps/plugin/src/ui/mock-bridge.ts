import type { PluginToUiMessage, TargetSnapshot, UiToPluginMessage } from '@ux-copy-sync/contracts';
import type { UiBridge } from './bridge';

const targets: TargetSnapshot[] = Array.from({ length: 6 }, (_, index) => ({
  id: `text-${index + 1}`,
  name: [
    'Order title',
    'Helper text',
    'Email label',
    'Email hint',
    'Primary button',
    'Footer note',
  ][index]!,
  originalCharacters: [
    'Review your order',
    "We won't charge you yet",
    'Email',
    'you@example.com',
    'Pay',
    'Need help?',
  ][index]!,
  originalName: [
    'Order title',
    'Helper text',
    'Email label',
    'Email hint',
    'Primary button',
    'Footer note',
  ][index]!,
  originalAutoRename: false,
  x: 16,
  y: index * 60,
  width: 300,
  height: 40,
  visible: true,
}));

const source = {
  cellUrl: 'https://docs.google.com/spreadsheets/d/1abcDEFghiJKLmnopQRS/edit#gid=123&range=D18',
  spreadsheetId: '1abcDEFghiJKLmnopQRS',
  spreadsheetTitle: 'Product Copy',
  sheetId: 123,
  sheetTitle: 'Checkout',
  startCell: 'D18',
  scannedThroughCell: 'D25',
  requestedCount: targets.length,
  fingerprint: '0'.repeat(64),
};

const values = [
  'Check your order',
  'We will only charge after confirmation',
  'Email address',
  'Use your work email',
  'Continue to payment',
  'Payment complete',
].map((value, index) => ({
  id: `D${18 + index}`,
  value,
  row: 18 + index,
  cell: `D${18 + index}`,
}));

export function mockBridge(): UiBridge {
  let listener: ((message: PluginToUiMessage) => void) | undefined;
  const emit = (message: PluginToUiMessage) => setTimeout(() => listener?.(message), 0);
  const params = new URLSearchParams(window.location.search);
  const count = Math.min(100, Math.max(1, Number(params.get('targets') ?? targets.length)));
  const activeTargets =
    count === targets.length
      ? targets
      : Array.from({ length: count }, (_, index) => ({
          ...targets[index % targets.length]!,
          id: `text-${index + 1}`,
          name: `Copy layer ${index + 1}`,
          originalCharacters: `Current copy ${index + 1}`,
          originalName: `Copy layer ${index + 1}`,
          y: index * 48,
        }));
  const longCopy = params.get('fixture') === 'long';
  const duplicateCopy = params.get('fixture') === 'duplicates';
  const activeValues = Array.from({ length: count }, (_, index) => ({
    id: `D${18 + index}`,
    value: duplicateCopy
      ? 'Repeated approved copy'
      : longCopy
        ? `Long approved copy ${index + 1}. ${'This copy remains fully reviewable. '.repeat(12)}`
        : values[index % values.length]!.value,
    row: 18 + index,
    cell: `D${18 + index}`,
  })).slice(0, params.get('fixture') === 'partial' ? Math.max(1, count - 2) : count);
  const activeSource = { ...source, requestedCount: count };
  const selection = {
    containerId: 'root',
    containerName: 'Checkout / Payment',
    containerType: 'FRAME',
    visibleTextCount: activeTargets.length,
  };
  const invalidSelection = params.get('selection') === 'invalid';
  const staleFixture = params.get('fixture') === 'stale-figma';
  const entryFixture = params.get('fixture') === 'entry';
  return {
    send: (message: UiToPluginMessage) => {
      switch (message.type) {
        case 'auth:check':
          if (entryFixture)
            emit({ type: 'auth-state', enabledPublicTestMode: true, authenticated: false });
          else {
            emit({
              type: 'auth-state',
              enabledPublicTestMode: true,
              authenticated: true,
              user: { email: 'writer@example.com' },
              mode: 'authenticated',
            });
            emit({
              type: 'selection-state',
              selection: invalidSelection ? null : selection,
              valid: !invalidSelection,
              count: invalidSelection ? 0 : 1,
            });
          }
          break;
        case 'auth:start':
          emit({
            type: 'auth-started',
            flowId: 'mock-flow',
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
          });
          break;
        case 'auth:poll-tick':
          emit({ type: 'auth-poll', status: 'pending' });
          break;
        case 'get-selection-state':
          emit({
            type: 'selection-state',
            selection: invalidSelection ? null : selection,
            valid: !invalidSelection,
            count: invalidSelection ? 0 : 1,
          });
          break;
        case 'fetch-preview':
          emit({
            type: 'preview-ready',
            requestId: message.payload.requestId,
            previewToken: 'mock-preview',
            selection,
            targets: activeTargets,
            source: activeSource,
            values: activeValues,
            partial: activeValues.length < activeTargets.length,
          });
          if (staleFixture)
            setTimeout(
              () =>
                listener?.({
                  type: 'preview-stale',
                  previewToken: 'mock-preview',
                  kind: 'figma',
                  reason: 'The design changed after this review. Refresh before applying.',
                }),
              25,
            );
          break;
        case 'apply-reviewed-pairs':
          if (params.get('fixture') === 'stale-source')
            emit({
              type: 'apply-reviewed-pairs-result',
              previewToken: 'mock-preview',
              ok: false,
              error: {
                code: 'SOURCE_STALE',
                message: 'The Sheet copy changed after this review. Refresh before applying.',
              },
            });
          else if (params.get('fixture') === 'locked')
            emit({
              type: 'apply-reviewed-pairs-result',
              previewToken: 'mock-preview',
              ok: false,
              error: {
                code: 'LOCKED_LAYER',
                message: 'Unlock the target before applying changes.',
              },
            });
          else
            emit({
              type: 'apply-reviewed-pairs-result',
              previewToken: 'mock-preview',
              ok: true,
              result: {
                appliedCount: message.payload.pairs.length,
                layerIds: message.payload.pairs.map((pair) => pair.layerId),
              },
            });
          break;
        case 'auth:enter-public-test':
          emit({
            type: 'auth-state',
            enabledPublicTestMode: true,
            authenticated: false,
            mode: 'public-test',
          });
          emit({ type: 'selection-state', selection, valid: true, count: 1 });
          break;
        case 'auth:exit-public-test':
        case 'auth:logout':
          emit({ type: 'auth-state', enabledPublicTestMode: true, authenticated: false });
          break;
        default:
          break;
      }
    },
    subscribe: (next) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
  };
}
