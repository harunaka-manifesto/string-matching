import {
  PLUGIN_DATA_NAMESPACE,
  PLUGIN_DATA_STATE_KEY,
  UiToPluginMessageSchema,
  type UiToPluginMessage,
} from '@string-binder/contracts';
import { applyDecisions } from './apply';
import { workflow } from './workflow';
import { writeStorage } from './private-storage';
import { answerCatalog, CATALOG_KEY, WorkflowError } from './registry-api';
import { post } from './channel';
import { boundVariableId, forgetVariableCache, variableById } from './layer-state';
import { importValues, listLibraryStrings, listLocalStrings } from './library-index';
import { isDescendantOf, isSupportedRoot, selectionInfo } from './selection';

/** Values of every library string, imported upfront by older versions. Never read now. */
const LEGACY_CACHE_KEY = 'string-index:v1';
const SIZE_KEY = 'ui:size';
const DEFAULT_SIZE = { width: 400, height: 720 };

function clampSize(width: number, height: number) {
  return {
    width: Math.round(Math.min(900, Math.max(360, width))),
    height: Math.round(Math.min(1200, Math.max(520, height))),
  };
}

figma.showUI(__html__, { ...DEFAULT_SIZE, themeColors: true });
void figma.clientStorage
  .getAsync(SIZE_KEY)
  .then((saved: { width?: number; height?: number } | undefined) => {
    if (saved?.width && saved?.height) {
      const size = clampSize(saved.width, saved.height);
      figma.ui.resize(size.width, size.height);
    }
  })
  .catch(() => {});

function describe(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Something went wrong.';
}

let activeRootId: string | null = null;
let syncing = false;

async function activeRoot(): Promise<SceneNode | null> {
  if (!activeRootId) return null;
  const node = await figma.getNodeByIdAsync(activeRootId);
  return isSupportedRoot(node) && !node.removed ? node : null;
}

/** Set while the plugin writes, so its own edits don't look like canvas changes. */
let writing = 0;
/** One `canvas:changed` per dirty period; cleared when the frame is read again. */
let changePosted = false;

async function sendSelection(): Promise<void> {
  const root = await activeRoot();
  activeRootId = root?.id ?? null;
  changePosted = false;
  post({ type: 'selection', selection: root ? await selectionInfo(root) : null });
}

/** Local string variables, re-read after the plugin creates or updates them. */
async function sendLocalIndex(): Promise<void> {
  const local = await listLocalStrings();
  post({ type: 'index:local', listing: local.listing, values: local.values });
}

function onNodeChange(event: NodeChangeEvent): void {
  if (writing || changePosted || !activeRootId) return;
  const rootId = activeRootId;
  const inside = event.nodeChanges.some(
    (change) =>
      !change.node.removed &&
      (change.node.id === rootId || isDescendantOf(change.node as BaseNode, rootId)),
  );
  if (!inside) return;
  changePosted = true;
  post({ type: 'canvas:changed', frameId: rootId });
}

let watchedPage: PageNode | null = null;
/** Canvas-change watching is a convenience: if Figma refuses it, the plugin still works. */
function watchPage(): void {
  try {
    watchedPage?.off('nodechange', onNodeChange);
    watchedPage = figma.currentPage;
    watchedPage.on('nodechange', onNodeChange);
  } catch {
    watchedPage = null;
  }
}
watchPage();

/**
 * Only selecting another frame switches the working frame. Picking layers (from
 * the list, flagged layers, or inside the frame on canvas) keeps it.
 */
async function onSelectionChange(force = false): Promise<void> {
  const selection = figma.currentPage.selection;
  const only = selection.length === 1 ? selection[0]! : null;
  const isNewFrame =
    isSupportedRoot(only) &&
    only.id !== activeRootId &&
    !(activeRootId && isDescendantOf(only, activeRootId));
  if (!force && activeRootId && !isNewFrame) return;
  activeRootId = isSupportedRoot(only) ? only.id : force ? null : activeRootId;
  await sendSelection();
}

/**
 * Lists library strings (names only) and local strings (with values). Library values
 * are not imported: importing ~20k variables ran on Figma's main thread and froze it.
 * Search uses the registry's copy; binding imports the one variable it needs.
 */
async function syncIndex(): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    const local = await listLocalStrings();
    // A library file can list its own published strings; those are already read as local.
    const localKeys = new Set(local.listing.map((item) => item.key));
    const library = (await listLibraryStrings()).filter((item) => !localKeys.has(item.key));
    post({ type: 'index:listing', listing: [...local.listing, ...library], values: local.values });
  } finally {
    syncing = false;
  }
}

let usagePageId: string | null = null;

/** Keys bound on the current page, sent once per page and again after apply. */
async function sendUsage(force = false): Promise<void> {
  const page = figma.currentPage;
  if (!force && usagePageId === page.id) return;
  usagePageId = page.id;
  const ids = new Set<string>();
  for (const node of page.findAllWithCriteria({ types: ['TEXT'] })) {
    const id = boundVariableId(node);
    if (id) ids.add(id);
  }
  const variables = await Promise.all([...ids].map((id) => variableById(id)));
  post({ type: 'usage', keys: variables.flatMap((variable) => (variable ? [variable.key] : [])) });
}

async function selectLayers(ids: readonly string[], zoom = true): Promise<number> {
  const nodes: SceneNode[] = [];
  for (const id of ids) {
    const node = await figma.getNodeByIdAsync(id);
    if (node && node.type !== 'DOCUMENT' && node.type !== 'PAGE') nodes.push(node as SceneNode);
  }
  figma.currentPage.selection = nodes;
  if (nodes.length && zoom) figma.viewport.scrollAndZoomIntoView(nodes);
  return nodes.length;
}

/** Workflow actions that write to the canvas or variables. They run one at a time. */
const WRITES = new Set([
  'deliver',
  'refresh',
  'writer:commit',
  'scope:set',
  'settings:save',
  'library:start',
  'library:apply',
  'library:ack',
  'library:publish',
]);
/** Writes that change variables or layers, after which the UI re-reads frame and index. */
const CANVAS_WRITES = new Set(['deliver', 'writer:commit', 'refresh', 'library:apply']);

async function handle(message: UiToPluginMessage): Promise<void> {
  switch (message.type) {
    case 'workflow': {
      const canvas = CANVAS_WRITES.has(message.action);
      if (canvas) writing += 1;
      try {
        const data = await workflow(message.action, message.data);
        post({ type: 'workflow:result', operationId: message.operationId, data });
        if (message.action === 'scope:set') await sendSelection();
        if (canvas) {
          const applied =
            message.action !== 'refresh' ||
            ((data as { result?: { applied: unknown[] } }).result?.applied.length ?? 0) > 0;
          if (applied) {
            forgetVariableCache();
            await sendLocalIndex();
            if (message.action !== 'refresh') {
              await sendSelection();
              await sendUsage(true);
            }
          }
        }
      } catch (error) {
        post({
          type: 'workflow:error',
          operationId: message.operationId,
          code: error instanceof WorkflowError ? error.code : 'VALIDATION',
          message: describe(error),
          details: error instanceof WorkflowError ? error.details : undefined,
        });
      } finally {
        if (canvas) writing -= 1;
      }
      return;
    }
    case 'ui:ready':
      // Saved caches go to the UI as stored bytes; it decodes them off Figma's main thread.
      post({
        type: 'catalog:cached',
        bytes:
          ((await figma.clientStorage.getAsync(CATALOG_KEY)) as Uint8Array | undefined) ?? null,
      });
      await onSelectionChange(true);
      await sendUsage();
      // Frees the megabytes the old upfront import cached, so the catalog cache fits.
      await figma.clientStorage.deleteAsync(LEGACY_CACHE_KEY).catch(() => {});
      return;
    case 'selection:refresh':
      await onSelectionChange(true);
      return;
    case 'frame:reread':
      await sendSelection();
      return;
    case 'window:resize': {
      const size = clampSize(message.width, message.height);
      figma.ui.resize(size.width, size.height);
      if (message.persist) await figma.clientStorage.setAsync(SIZE_KEY, size);
      return;
    }
    case 'index:sync':
      await syncIndex();
      return;
    case 'index:resolve':
      post({ type: 'index:values', values: (await importValues(message.keys)).values });
      return;
    case 'catalog:save':
      await writeStorage(CATALOG_KEY, message.bytes, false);
      return;
    case 'catalog:answer':
      answerCatalog(message);
      return;
    case 'layer:focus':
      await selectLayers([message.layerId], message.zoom ?? true);
      return;
    case 'layers:select':
      await selectLayers(message.layerIds);
      return;
    case 'flags:select': {
      const flagged = figma.currentPage
        .findAllWithCriteria({ types: ['TEXT'] })
        .filter(
          (node) =>
            node.getSharedPluginData(PLUGIN_DATA_NAMESPACE, PLUGIN_DATA_STATE_KEY) === 'needs-new',
        );
      const count = await selectLayers(flagged.map((node) => node.id));
      post({ type: 'flags:selected', count });
      return;
    }
    case 'apply': {
      writing += 1;
      try {
        const summary = await applyDecisions(message.frameId, message.decisions, message.preview);
        forgetVariableCache();
        post({ type: 'apply:done', summary });
        await sendLocalIndex();
        await sendSelection();
        await sendUsage(true);
      } finally {
        writing -= 1;
      }
      return;
    }
  }
}

// Reads (drafts, scans, previews) and catalog answers run right away; writes queue behind each
// other, so a background refresh never makes a writer's request wait or time out. A queued
// write may be waiting on a `catalog:answer`, so answers must never queue.
let writeQueue: Promise<void> = Promise.resolve();
figma.ui.onmessage = (raw: unknown) => {
  const parsed = UiToPluginMessageSchema.safeParse(raw);
  if (!parsed.success) return;
  const task = () =>
    handle(parsed.data).catch((error) => post({ type: 'error', message: describe(error) }));
  const message = parsed.data;
  if (message.type === 'apply' || (message.type === 'workflow' && WRITES.has(message.action)))
    writeQueue = writeQueue.then(task);
  else void task();
};

figma.on('selectionchange', () => {
  onSelectionChange().catch((error) => post({ type: 'error', message: describe(error) }));
});
figma.on('currentpagechange', () => {
  activeRootId = null;
  watchPage();
  onSelectionChange(true)
    .then(() => sendUsage())
    .catch((error) => post({ type: 'error', message: describe(error) }));
});
