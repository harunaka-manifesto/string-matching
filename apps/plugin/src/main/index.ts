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
  containingPageId,
  discoverTextNodes,
  isDescendantOf,
  previewRelevantNodeIds,
  selectedRoot,
  selectionSummary,
  targetCountIsSupported,
  targetSnapshots,
  type FigmaNodeLike,
} from './selection';
import { createPreview, validateFigmaPreview } from './snapshots';
import { TargetPreviewManager } from './target-preview';

const SETUP_WIDTH = 520;
const REVIEW_WIDTH = 760;
const UI_HEIGHT = 720;

figma.showUI(__html__, { width: SETUP_WIDTH, height: UI_HEIGHT, themeColors: true });

function resizeSetup(): void {
  figma.ui.resize(SETUP_WIDTH, UI_HEIGHT);
}

function resizeReview(): void {
  figma.ui.resize(REVIEW_WIDTH, UI_HEIGHT);
}

type StoredPreview = ReturnType<typeof createPreview> & {
  values: SheetValue[];
  mode: RuntimeMode;
  relevantNodeIds: Set<string>;
};

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
let activeFetchRequestId: string | undefined;
let ignoreNextSelectionChange = false;
let watchedPage: PageNode | undefined;
let nodeChangeHandler: ((event: NodeChangeEvent) => void) | undefined;
let validationQueued = false;
let validationRunning = false;
let validationRequestedAgain = false;

function asSceneNode(node: BaseNode | null): SceneNode | null {
  return node && node.type !== 'DOCUMENT' && node.type !== 'PAGE' ? (node as SceneNode) : null;
}

const targetPreview = new TargetPreviewManager<SceneNode>({
  getSelection: () => figma.currentPage.selection,
  setSelection: (nodes) => {
    figma.currentPage.selection = [...nodes];
  },
  resolveNode: async (id) => asSceneNode(await figma.getNodeByIdAsync(id)),
  resolveRoot: async (id) => asSceneNode(await figma.getNodeByIdAsync(id)),
});

function post(message: PluginToUiMessage): void {
  figma.ui.postMessage(message);
}

function errorPayload(cause: unknown) {
  if (cause instanceof AppError) return cause.toPayload();
  console.error('[UX Copy Sync] Unhandled plugin error.', {
    name: cause instanceof Error ? cause.name : typeof cause,
  });
  return new AppError(
    'INTERNAL_ERROR',
    'The plugin could not complete this operation. Try again.',
  ).toPayload();
}

function postSelectionState(): void {
  if (targetPreview.hasSession) return;
  const selection = figma.currentPage.selection;
  const summary = currentSelectionSummary();
  const valid = summary !== null && targetCountIsSupported(summary.visibleTextCount);
  post({
    type: 'selection-state',
    selection: summary,
    valid,
    count: selection.length,
    message:
      summary && !targetCountIsSupported(summary.visibleTextCount)
        ? `This selection contains ${summary.visibleTextCount} visible copy layers. Select a smaller screen or component to continue.`
        : undefined,
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

async function clearTransientPreview(restore = true): Promise<void> {
  const preview = activePreview();
  await targetPreview.clear({ restore, rootId: preview?.rootId });
}

async function fetchPreview(
  payload: {
    requestId: string;
    cellUrl: string;
    mode: RuntimeMode;
  },
  rootOverride?: FigmaNodeLike,
): Promise<void> {
  await clearTransientPreview();
  const sequence = ++fetchSequence;
  const root = rootOverride ?? selectedRoot();
  if (containingPageId(root) !== figma.currentPage.id)
    throw new AppError(
      'PREVIEW_STALE',
      'The selected design is not on the current page. Refresh the preview.',
    );
  const targets = discoverTextNodes(root);
  if (!targets.length)
    throw new AppError('NO_ELIGIBLE_TEXT', 'No visible text copy was found in this selection.');
  if (!targetCountIsSupported(targets.length))
    throw new AppError(
      'TARGET_LIMIT_EXCEEDED',
      `This selection contains ${targets.length} visible copy layers. Select a smaller screen or component to continue.`,
    );
  const preview = createPreview({
    pageId: figma.currentPage.id,
    rootId: root.id,
    rootType: root.type as 'FRAME' | 'COMPONENT' | 'INSTANCE',
    rootName: root.name,
    targets: targetSnapshots(targets),
    mode: payload.mode,
  }) as StoredPreview;
  preview.relevantNodeIds = previewRelevantNodeIds(root, targets);
  pendingTokens.add(preview.token);
  try {
    const response = await providerFor(payload.mode).fetchCopy({
      cellUrl: payload.cellUrl,
      requestedCount: targets.length,
    });
    if (
      sequence !== fetchSequence ||
      activeFetchRequestId !== payload.requestId ||
      !pendingTokens.has(preview.token)
    )
      return;
    preview.source = response.source;
    preview.values = response.values;
    preview.mode = payload.mode;
    if (!response.values.length)
      throw new AppError(
        'SHEET_READ_FAILED',
        'No non-empty Sheet copy was found below the linked cell.',
      );
    const previousToken = activeToken;
    previews.set(preview.token, preview);
    activeToken = preview.token;
    if (previousToken && previousToken !== preview.token) previews.delete(previousToken);
    resizeReview();
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

async function refreshPreview(payload: {
  requestId: string;
  previewToken: string;
  cellUrl: string;
  mode: RuntimeMode;
}): Promise<void> {
  const existing = previews.get(payload.previewToken);
  if (!existing || activeToken !== payload.previewToken)
    throw new AppError(
      'PREVIEW_NOT_FOUND',
      'This review is no longer active. Build a new preview.',
    );
  const root = await figma.getNodeByIdAsync(existing.rootId);
  if (!root || root.type !== existing.rootType || containingPageId(root) !== existing.pageId)
    throw new AppError(
      'PREVIEW_STALE',
      'The selected design no longer exists on its original page. Build a new preview.',
    );
  await fetchPreview(payload, root as FigmaNodeLike);
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
    await clearTransientPreview();
    const payload = errorPayload(cause);
    post({
      type: 'preview-stale',
      previewToken: preview.token,
      kind: 'figma',
      reason: payload.message,
    });
  }
}

function nodeChangeAffectsPreview(event: NodeChangeEvent, preview: StoredPreview): boolean {
  const relevantProperties = new Set([
    'characters',
    'visible',
    'opacity',
    'x',
    'y',
    'width',
    'height',
    'relativeTransform',
    'parent',
    'clipsContent',
    'fills',
    'strokes',
    'type',
  ]);
  return event.nodeChanges.some((change) => {
    if (preview.relevantNodeIds.has(change.id)) return true;
    if ('removed' in change.node) return false;
    if (isDescendantOf(change.node, preview.rootId)) {
      return (
        change.type !== 'PROPERTY_CHANGE' ||
        change.properties.some((property) => relevantProperties.has(property))
      );
    }
    return isDescendantOf(figma.getNodeById(preview.rootId), change.id);
  });
}

function requestPreviewValidation(): void {
  if (validationRunning) {
    validationRequestedAgain = true;
    return;
  }
  if (validationQueued) return;
  validationQueued = true;
  void Promise.resolve().then(async () => {
    validationQueued = false;
    validationRunning = true;
    do {
      validationRequestedAgain = false;
      await markPreviewStaleIfNeeded();
    } while (validationRequestedAgain);
    validationRunning = false;
  });
}

function watchPage(page: PageNode): void {
  if (watchedPage && nodeChangeHandler) watchedPage.off('nodechange', nodeChangeHandler);
  watchedPage = page;
  nodeChangeHandler = (event) => {
    const preview = activePreview();
    if (preview && nodeChangeAffectsPreview(event, preview)) requestPreviewValidation();
  };
  page.on('nodechange', nodeChangeHandler);
}

async function discardPreview(token: string): Promise<void> {
  pendingTokens.delete(token);
  if (activeToken === token) {
    await clearTransientPreview();
    previews.delete(token);
    activeToken = undefined;
    resizeSetup();
  } else previews.delete(token);
}

async function discardAllPreviews(): Promise<void> {
  fetchSequence += 1;
  activeFetchRequestId = undefined;
  await clearTransientPreview();
  pendingTokens.clear();
  previews.clear();
  activeToken = undefined;
  resizeSetup();
}

async function handleAuthLoss(): Promise<void> {
  await auth.clearSession();
  auth.exitPublicTest();
  await discardAllPreviews();
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
        await discardAllPreviews();
        post({
          type: 'auth-state',
          enabledPublicTestMode: pluginConfig.enablePublicTestMode,
          authenticated: false,
        });
        break;
      case 'auth:logout':
        await auth.clearSession();
        auth.exitPublicTest();
        await discardAllPreviews();
        post({
          type: 'auth-state',
          enabledPublicTestMode: pluginConfig.enablePublicTestMode,
          authenticated: false,
        });
        break;
      case 'auth:disconnect':
        await auth.disconnect();
        auth.exitPublicTest();
        await discardAllPreviews();
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
        activeFetchRequestId = message.payload.requestId;
        await fetchPreview(message.payload);
        break;
      case 'cancel-fetch':
        if (activeFetchRequestId === message.payload.requestId) {
          activeFetchRequestId = undefined;
          fetchSequence += 1;
        }
        break;
      case 'refresh-preview':
        activeFetchRequestId = message.payload.requestId;
        await refreshPreview(message.payload);
        break;
      case 'discard-preview':
        await discardPreview(message.payload.previewToken);
        break;
      case 'preview-target': {
        if (message.payload.layerId === null) {
          await clearTransientPreview();
          break;
        }
        const preview = previews.get(message.payload.previewToken);
        if (!preview || activeToken !== message.payload.previewToken) break;
        await targetPreview.preview({
          previewToken: message.payload.previewToken,
          layerId: message.payload.layerId,
          targetIds: preview.targets.map((target) => target.id),
          rootId: preview.rootId,
        });
        break;
      }
      case 'select-node': {
        targetPreview.cancelWithoutRestore();
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
        await clearTransientPreview();
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
      (message.type === 'fetch-preview' || message.type === 'refresh-preview') &&
      activeFetchRequestId !== message.payload.requestId
    )
      return;
    if (
      cause instanceof AppError &&
      (cause.code === 'AUTH_REQUIRED' || cause.code === 'AUTH_RECONNECT_REQUIRED')
    )
      await handleAuthLoss();
    if (message.type === 'fetch-preview' || message.type === 'refresh-preview')
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
  const selectionIds = figma.currentPage.selection.map((node) => node.id);
  if (targetPreview.consumeSelectionChange(selectionIds)) return;
  if (targetPreview.hasSession) {
    targetPreview.cancelForExternalSelection();
    postSelectionState();
    return;
  }
  if (ignoreNextSelectionChange) ignoreNextSelectionChange = false;
  postSelectionState();
});
figma.on('currentpagechange', () => {
  targetPreview.cancelWithoutRestore();
  watchPage(figma.currentPage);
  postSelectionState();
  requestPreviewValidation();
});
watchPage(figma.currentPage);
postSelectionState();
