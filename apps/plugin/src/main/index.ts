import {
  PLUGIN_DATA_NAMESPACE,
  PLUGIN_DATA_STATE_KEY,
  UiToPluginMessageSchema,
  type PluginToUiMessage,
  type UiToPluginMessage,
} from '@string-binder/contracts';
import { applyDecisions } from './apply';
import { workflow } from './workflow';
import { WorkflowError } from './registry-api';
import { boundVariableId, forgetVariableCache, variableById } from './layer-state';
import {
  IMPORT_BATCH_SIZE,
  importValues,
  listLibraryStrings,
  listLocalStrings,
} from './library-index';
import { isDescendantOf, isSupportedRoot, selectionInfo } from './selection';

const CACHE_KEY = 'string-index:v1';

figma.showUI(__html__, { width: 440, height: 680, themeColors: true });

function post(message: PluginToUiMessage): void {
  figma.ui.postMessage(message);
}

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

async function sendSelection(): Promise<void> {
  const root = await activeRoot();
  activeRootId = root?.id ?? null;
  post({ type: 'selection', selection: root ? await selectionInfo(root) : null });
}

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

async function syncIndex(knownKeys: readonly string[]): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    const local = await listLocalStrings();
    const library = await listLibraryStrings();
    const listing = [...local.listing, ...library];
    const known = new Set(knownKeys);
    const missing = library.filter((item) => !known.has(item.key)).map((item) => item.key);
    post({ type: 'index:listing', listing, toImport: missing.length });
    // Local values are re-read every sync, so edits in this file show up on reopen.
    if (local.values.length)
      post({ type: 'index:values', values: local.values, done: 0, total: missing.length });
    let failed = 0;
    for (let start = 0; start < missing.length; start += IMPORT_BATCH_SIZE) {
      const batch = await importValues(missing.slice(start, start + IMPORT_BATCH_SIZE));
      failed += batch.failed;
      post({
        type: 'index:values',
        values: batch.values,
        done: Math.min(start + IMPORT_BATCH_SIZE, missing.length),
        total: missing.length,
      });
    }
    post({ type: 'index:synced', failed });
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

async function handle(message: UiToPluginMessage): Promise<void> {
  switch (message.type) {
    case 'workflow': {
      try { const data=await workflow(message.action,message.data);post({type:'workflow:result',operationId:message.operationId,data});if(message.action==='catalog')post({type:'registry:catalog',catalog:data as import('@string-binder/contracts').Catalog});if(message.action==='refresh')post({type:'registry:catalog',catalog:(data as {catalog:import('@string-binder/contracts').Catalog}).catalog}); }
      catch(error) { post({type:'workflow:error',operationId:message.operationId,code:error instanceof WorkflowError?error.code:'VALIDATION',message:describe(error),details:error instanceof WorkflowError?error.details:undefined}); }
      return;
    }
    case 'ui:ready':
      post({
        type: 'index:cached',
        bytes: ((await figma.clientStorage.getAsync(CACHE_KEY)) as Uint8Array | undefined) ?? null,
      });
      await onSelectionChange(true);
      await sendUsage();
      return;
    case 'selection:refresh':
      await onSelectionChange(true);
      return;
    case 'index:sync':
      await syncIndex(message.knownKeys);
      return;
    case 'index:save':
      await figma.clientStorage.setAsync(CACHE_KEY, message.bytes);
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
      const summary = await applyDecisions(message.frameId, message.decisions);
      forgetVariableCache();
      post({ type: 'apply:done', summary });
      await sendSelection();
      await sendUsage(true);
      return;
    }
  }
}

let operationQueue:Promise<void>=Promise.resolve();
figma.ui.onmessage = (raw: unknown) => {
  const parsed = UiToPluginMessageSchema.safeParse(raw);
  if (!parsed.success) return;
  operationQueue=operationQueue.then(()=>handle(parsed.data)).catch((error) => post({ type: 'error', message: describe(error) }));
};

figma.on('selectionchange', () => {
  onSelectionChange().catch((error) => post({ type: 'error', message: describe(error) }));
});
figma.on('currentpagechange', () => {
  activeRootId = null;
  onSelectionChange(true)
    .then(() => sendUsage())
    .catch((error) => post({ type: 'error', message: describe(error) }));
});
