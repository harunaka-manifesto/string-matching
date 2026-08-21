import {
  AppError,
  UiToPluginMessageSchema,
  type PluginToUiMessage,
  type RuntimeMode,
  type SheetValue,
} from '@ux-copy-sync/contracts';
import { BackendClient } from './backend-client';
import { APP_SESSION_KEY, pluginConfig } from './config';
import { AuthManager } from './auth';
import { applyReviewedPairs } from './apply';
import {
  AuthenticatedWorkspaceSheetProvider,
  PublicSheetTestProvider,
  type SheetSourceProvider,
} from './sources';
import {
  currentSelectionSummary,
  discoverTextNodes,
  selectedRoot,
  selectionSummary,
  targetSnapshots,
} from './selection';
import { createPreview, validateFigmaPreview } from './snapshots';

figma.showUI(__html__, { width: 520, height: 720, themeColors: true });

type StoredPreview = ReturnType<typeof createPreview> & { values: SheetValue[]; mode: RuntimeMode };

const sessionClient = new BackendClient(pluginConfig.backendBaseUrl, async () =>
  figma.clientStorage.getAsync(APP_SESSION_KEY),
);
const auth = new AuthManager(sessionClient);
const providers: Record<RuntimeMode, SheetSourceProvider> = {
  authenticated: new AuthenticatedWorkspaceSheetProvider(sessionClient),
  'public-test': new PublicSheetTestProvider(sessionClient),
};
const previews = new Map<string, StoredPreview>();
let activeToken: string | undefined;
let pendingTokens = new Set<string>();
let fetchSequence = 0;
let ignoreNextSelectionChange = false;
let watchedPage: PageNode | undefined;
let nodeChangeHandler: (() => void) | undefined;

function post(message: PluginToUiMessage): void {
  figma.ui.postMessage(message);
}

function errorPayload(cause: unknown) {
  if (cause instanceof AppError) return cause.toPayload();
  return new AppError(
    'INTERNAL_ERROR',
    cause instanceof Error ? cause.message : 'Unexpected plugin error.',
  ).toPayload();
}

function postSelectionState(): void {
  const selection = figma.currentPage.selection;
  const summary = currentSelectionSummary();
  post({
    type: 'selection-state',
    selection: summary,
    valid: summary !== null,
    count: selection.length,
  });
}

function providerFor(mode: RuntimeMode): SheetSourceProvider {
  if (mode === 'public-test' && !pluginConfig.enablePublicTestMode)
    throw new AppError('AUTH_FAILED', 'Public Sheet test mode is disabled in this build.');
  return providers[mode];
}

function activePreview(): StoredPreview | undefined {
  return activeToken ? previews.get(activeToken) : undefined;
}

async function fetchPreview(payload: {
  requestId: string;
  cellUrl: string;
  mode: RuntimeMode;
}): Promise<void> {
  const sequence = ++fetchSequence;
  const root = selectedRoot();
  const targets = discoverTextNodes(root);
  if (!targets.length)
    throw new AppError('NO_ELIGIBLE_TEXT', 'No visible text copy was found in this selection.');
  const preview = createPreview({
    pageId: figma.currentPage.id,
    rootId: root.id,
    rootType: root.type as 'FRAME' | 'COMPONENT' | 'INSTANCE',
    rootName: root.name,
    targets: targetSnapshots(targets),
    mode: payload.mode,
  }) as StoredPreview;
  pendingTokens.add(preview.token);
  try {
    const response = await providerFor(payload.mode).fetchCopy({
      cellUrl: payload.cellUrl,
      requestedCount: targets.length,
    });
    if (sequence !== fetchSequence || !pendingTokens.has(preview.token)) return;
    preview.source = response.source;
    preview.values = response.values;
    preview.mode = payload.mode;
    if (!response.values.length)
      throw new AppError(
        'SHEET_READ_FAILED',
        'No non-empty Sheet copy was found below the linked cell.',
      );
    if (activeToken) previews.delete(activeToken);
    previews.set(preview.token, preview);
    activeToken = preview.token;
    post({
      type: 'preview-ready',
      requestId: payload.requestId,
      previewToken: preview.token,
      selection: selectionSummary(root, targets),
      targets: preview.targets,
      source: response.source,
      values: response.values,
      partial: response.values.length < targets.length,
    });
  } finally {
    pendingTokens.delete(preview.token);
  }
}

async function markPreviewStaleIfNeeded(): Promise<void> {
  const preview = activePreview();
  if (!preview || preview.applied) return;
  try {
    await validateFigmaPreview(
      preview,
      async (id) => figma.getNodeByIdAsync(id),
      (root) => targetSnapshots(discoverTextNodes(root as never)),
      figma.currentPage.id,
    );
  } catch (cause) {
    const payload = errorPayload(cause);
    post({
      type: 'preview-stale',
      previewToken: preview.token,
      kind: 'figma',
      reason: payload.message,
    });
  }
}

function watchPage(page: PageNode): void {
  if (watchedPage && nodeChangeHandler) watchedPage.off('nodechange', nodeChangeHandler);
  watchedPage = page;
  nodeChangeHandler = () => {
    void Promise.resolve().then(markPreviewStaleIfNeeded);
  };
  page.on('nodechange', nodeChangeHandler);
}

function discardPreview(token: string): void {
  pendingTokens.delete(token);
  previews.delete(token);
  if (activeToken === token) activeToken = undefined;
}

function discardAllPreviews(): void {
  fetchSequence += 1;
  pendingTokens.clear();
  previews.clear();
  activeToken = undefined;
}

async function handleAuthLoss(): Promise<void> {
  await auth.clearSession();
  auth.exitPublicTest();
  discardAllPreviews();
  post({
    type: 'auth-state',
    enabledPublicTestMode: pluginConfig.enablePublicTestMode,
    authenticated: false,
  });
}

async function handleMessage(raw: unknown): Promise<void> {
  const parsed = UiToPluginMessageSchema.safeParse(raw);
  if (!parsed.success) {
    post({
      type: 'error',
      error: new AppError('INVALID_REQUEST', 'The plugin received an invalid request.').toPayload(),
    });
    return;
  }
  const message = parsed.data;
  try {
    switch (message.type) {
      case 'auth:check': {
        const state = await auth.check();
        post({
          type: 'auth-state',
          enabledPublicTestMode: pluginConfig.enablePublicTestMode,
          authenticated: state.authenticated,
          user: state.user,
          mode: state.mode,
        });
        if (state.authenticated || state.mode === 'public-test') postSelectionState();
        break;
      }
      case 'auth:start': {
        const flow = await auth.start();
        post({ type: 'auth-started', flowId: flow.flowId, expiresAt: flow.expiresAt });
        break;
      }
      case 'auth:poll-tick': {
        const response = await auth.poll();
        if (response.status === 'complete') {
          post({ type: 'auth-poll', status: 'complete', user: response.user });
          post({
            type: 'auth-state',
            enabledPublicTestMode: pluginConfig.enablePublicTestMode,
            authenticated: true,
            user: response.user,
            mode: 'authenticated',
          });
          postSelectionState();
        } else if (response.status === 'failed')
          post({ type: 'auth-poll', status: 'failed', error: response.error });
        else post({ type: 'auth-poll', status: 'pending' });
        break;
      }
      case 'auth:cancel':
        auth.cancel();
        post({ type: 'auth-cancelled' });
        break;
      case 'auth:enter-public-test':
        auth.enterPublicTest();
        post({
          type: 'auth-state',
          enabledPublicTestMode: true,
          authenticated: false,
          mode: 'public-test',
        });
        postSelectionState();
        break;
      case 'auth:exit-public-test':
        auth.exitPublicTest();
        discardAllPreviews();
        post({
          type: 'auth-state',
          enabledPublicTestMode: pluginConfig.enablePublicTestMode,
          authenticated: false,
        });
        break;
      case 'auth:logout':
        await auth.clearSession();
        auth.exitPublicTest();
        discardAllPreviews();
        post({
          type: 'auth-state',
          enabledPublicTestMode: pluginConfig.enablePublicTestMode,
          authenticated: false,
        });
        break;
      case 'auth:disconnect':
        await auth.disconnect();
        auth.exitPublicTest();
        discardAllPreviews();
        post({
          type: 'auth-state',
          enabledPublicTestMode: pluginConfig.enablePublicTestMode,
          authenticated: false,
        });
        break;
      case 'get-selection-state':
        postSelectionState();
        break;
      case 'fetch-preview':
        await fetchPreview(message.payload);
        break;
      case 'discard-preview':
        discardPreview(message.payload.previewToken);
        break;
      case 'select-node': {
        const preview = previews.get(message.payload.previewToken);
        if (!preview || !preview.targets.some((target) => target.id === message.payload.layerId))
          break;
        const node = await figma.getNodeByIdAsync(message.payload.layerId);
        if (node && node.type === 'TEXT') {
          ignoreNextSelectionChange = true;
          figma.currentPage.selection = [node];
          figma.viewport.scrollAndZoomIntoView([node]);
        }
        break;
      }
      case 'apply-reviewed-pairs': {
        const preview = previews.get(message.payload.previewToken);
        if (!preview || activeToken !== message.payload.previewToken)
          throw new AppError(
            'PREVIEW_NOT_FOUND',
            'This preview is no longer active. Build a new preview.',
          );
        const provider = providerFor(preview.mode);
        const result = await applyReviewedPairs({
          preview,
          sourceValues: preview.values,
          pairs: message.payload.pairs,
          resolveNode: (id) => figma.getNodeByIdAsync(id),
          resolveRoot: (id) => figma.getNodeByIdAsync(id),
          verifySource: async () => {
            if (!preview.source) return;
            const verified = await provider.verifyCopy({
              cellUrl: preview.source.cellUrl,
              requestedCount: preview.source.requestedCount,
              expectedFingerprint: preview.source.fingerprint,
            });
            if (!verified.unchanged)
              throw new AppError(
                'SOURCE_STALE',
                'The Sheet copy changed after this preview was built. Refresh to review the latest copy before applying.',
              );
          },
          discoverSnapshots: (root) => targetSnapshots(discoverTextNodes(root as never)),
          currentPageId: figma.currentPage.id,
          getCurrentPageId: () => figma.currentPage.id,
        });
        previews.delete(preview.token);
        activeToken = undefined;
        post({
          type: 'apply-reviewed-pairs-result',
          previewToken: preview.token,
          ok: true,
          result,
        });
        figma.notify(
          `Updated ${result.appliedCount} text layer${result.appliedCount === 1 ? '' : 's'}.`,
        );
        break;
      }
    }
  } catch (cause) {
    const payload = errorPayload(cause);
    if (
      cause instanceof AppError &&
      (cause.code === 'AUTH_REQUIRED' || cause.code === 'AUTH_RECONNECT_REQUIRED')
    )
      await handleAuthLoss();
    if (message.type === 'fetch-preview')
      post({ type: 'error', requestId: message.payload.requestId, error: payload });
    else if (message.type === 'apply-reviewed-pairs')
      post({
        type: 'apply-reviewed-pairs-result',
        previewToken: message.payload.previewToken,
        ok: false,
        error: payload,
      });
    else if (message.type === 'auth:poll-tick')
      post({ type: 'auth-poll', status: 'failed', error: payload });
    else post({ type: 'error', error: payload });
  }
}

figma.ui.onmessage = (message) => {
  void handleMessage(message);
};
figma.on('selectionchange', () => {
  if (ignoreNextSelectionChange) ignoreNextSelectionChange = false;
  postSelectionState();
});
figma.on('currentpagechange', () => {
  watchPage(figma.currentPage);
  postSelectionState();
  void markPreviewStaleIfNeeded();
});
watchPage(figma.currentPage);
postSelectionState();
