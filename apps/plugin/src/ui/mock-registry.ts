import type {
  Catalog,
  CopyRecord,
  LayerInfo,
  LocalCopy,
  MutationBatch,
  SelectionInfo,
  WorkflowAction,
} from '@string-binder/contracts';
import {
  canvasFingerprint,
  canonical,
  copyKeyStem,
  createCopyId,
  recordFingerprint,
} from '@string-binder/domain';

/** Deterministic local simulator; never used by the Figma production build. */
export function mockRegistry(selection: () => SelectionInfo, changed: () => void) {
  const context = { feature: 'onboarding', screen: 'landing', context: '', role: 'cta', note: '' };
  const seed: CopyRecord = {
    copyId: createCopyId(1791244800000, new Uint8Array(10).fill(1)),
    platformKey: 'gopay_investment_onboarding_gotit_cta',
    revision: 1,
    en: 'Got it',
    id: 'Oke, paham',
    product: 'investment',
    context,
    status: 'active',
    aliases: [],
  };
  const failOnce = new URLSearchParams(location.search).has('failBinding');
  const state = JSON.parse(localStorage.getItem('mock:registry') ?? 'null') ?? {
    catalog: {
      seq: 1,
      products: [
        { id: 'investment', displayName: 'Investment', keyToken: 'investment', legacyGroups: [] },
        { id: 'transfer', displayName: 'Transfer', keyToken: 'transfer', legacyGroups: [] },
        { id: 'shared', displayName: 'Shared', keyToken: 'shared', legacyGroups: [] },
      ],
      records: [seed],
      mappings: [],
    },
    requests: {},
    locals: [],
    bindings: {},
    settings: {},
    run: null,
    pending: null,
    drafts: {},
  };
  const save = () => localStorage.setItem('mock:registry', JSON.stringify(state));
  const fail = (code: string, message: string, details?: unknown): never => {
    throw Object.assign(new Error(message), {
      code,
      details: { error: code, ...(details && typeof details === 'object' ? details : {}) },
    });
  };
  return async (action: WorkflowAction, data: any): Promise<any> => {
    const catalog: Catalog = state.catalog;
    switch (action) {
      case 'window':
        return null;
      case 'catalog':
        return catalog;
      case 'refresh':
        return { catalog, result: { applied: [], failures: [], conflicts: [] } };
      case 'device':
        return 'mock-device';
      case 'settings:get':
        return { ...state.settings, hasPublisherToken: !!state.settings.publisherToken };
      case 'settings:save':
        state.settings = data;
        save();
        return { saved: true };
      case 'draft:get':
        return state.drafts[data.frameId] ?? null;
      case 'draft:save':
        state.drafts[data.draft.frameId] = data.draft;
        save();
        return null;
      case 'scan':
        return {
          selection: selection(),
          bindings: state.bindings,
          variables: Object.fromEntries(
            Object.entries(state.bindings).map(([id, cp]) => [
              id,
              catalog.records.find((r) => r.copyId === cp),
            ]),
          ),
        };
      case 'request':
        return state.requests[data.requestId]?.result ?? null;
      case 'apply:preview':
        return {
          sources: selection().layers.map((l) => ({
            nodeId: l.id,
            fingerprint: canvasFingerprint(l),
          })),
          targets: [],
        };
      case 'preflight':
        return {
          targets: data.rows.map((r: any) => ({
            nodeId: r.layerId,
            sourceId: r.layerId,
            copyId: r.copyId,
            locale: r.locale,
            fingerprint: r.canvasFingerprint,
            frameName: selection().frameName,
            duplicate: false,
          })),
          conflicts: [],
        };
      case 'submit': {
        const batch = data.batch as MutationBatch;
        const previous = state.requests[batch.requestId];
        if (previous) {
          if (previous.hash !== canonical(batch)) fail('REQUEST_REUSED', 'Request changed');
          return previous.result;
        }
        const conflicts = batch.operations
          .filter(
            (op) =>
              op.action !== 'create' &&
              catalog.records.find((r) => r.copyId === op.copyId)?.revision !== op.expectedRevision,
          )
          .map((op) => ({
            copyId: op.copyId,
            actualRecord: catalog.records.find((r) => r.copyId === op.copyId),
          }));
        if (conflicts.length) fail('REVISION_CONFLICT', 'Copy changed since review', { conflicts });
        const records = batch.operations.map((op) => {
          const old = catalog.records.find((r) => r.copyId === op.copyId);
          if (op.action === 'reuse') return old!;
          if (op.action === 'edit') return { ...old!, ...op, revision: old!.revision + 1 };
          if (old) fail('DUPLICATE_COPY_ID', 'Copy ID exists');
          const product = catalog.products.find((p) => p.id === op.product)!;
          const stem = copyKeyStem({ product: product.keyToken, ...op.context });
          let platformKey = stem;
          let index = 2;
          while (catalog.records.some((r) => r.platformKey === platformKey))
            platformKey = stem + '_' + index++;
          return { ...op, platformKey, revision: 1, status: 'active', aliases: [] } as CopyRecord;
        });
        for (const r of records) {
          catalog.records = catalog.records.filter((c) => c.copyId !== r.copyId).concat(r);
          catalog.seq++;
        }
        const result = { requestId: batch.requestId, records, seq: catalog.seq };
        state.requests[batch.requestId] = { hash: canonical(batch), result };
        save();
        return result;
      }
      case 'deliver': {
        if (failOnce && !state.bindingFailureSent) {
          state.bindingFailureSent = true;
          save();
          return {
            applied: [],
            conflicts: [],
            failures: data.targets.map((t: any) => ({
              nodeId: t.nodeId,
              reason: 'Simulated interruption after save',
            })),
          };
        }
        const applied: string[] = [];
        const conflicts: string[] = [];
        for (const t of data.targets) {
          const layer = selection().layers.find((l) => l.id === t.nodeId);
          const r = data.records.find((r: CopyRecord) => r.copyId === t.copyId);
          if (!layer || !r) continue;
          if (canvasFingerprint(layer) !== t.fingerprint && state.bindings[layer.id] !== r.copyId) {
            conflicts.push(layer.id);
            continue;
          }
          Object.assign(layer, {
            name: r.platformKey,
            characters: r[t.locale],
            boundKey: `registry:${r.copyId}:${r.revision}`,
            boundName: r.platformKey,
          });
          state.bindings[layer.id] = r.copyId;
          applied.push(layer.id);
        }
        save();
        changed();
        return { applied, conflicts, failures: [] };
      }
      case 'library:scan':
        return { catalog, locals: state.locals };
      case 'library:pending':
        if ('value' in data) {
          state.pending = data.value;
          save();
          return null;
        }
        return state.pending;
      case 'library:manifest':
        return state.run;
      case 'library:start':
        state.run = { ...state.run, ...data };
        save();
        return { runId: data.runId };
      case 'library:apply': {
        const mappings = state.run.records.map((r: CopyRecord) => {
          let local = state.locals.find((l: LocalCopy) => l.copyId === r.copyId);
          if (!local) {
            local = {
              variableId: 'mock:' + r.copyId,
              variableKey: 'key:' + r.copyId,
              collection: catalog.products.find((p) => p.id === r.product)?.displayName,
              copyId: r.copyId,
            };
            state.locals.push(local);
          }
          Object.assign(local, {
            name: r.platformKey,
            en: r.en,
            id: r.id,
            context: r.context,
            baseline: r,
          });
          return {
            libraryId: 'gopay-strings',
            copyId: r.copyId,
            variableId: local.variableId,
            variableKey: local.variableKey,
            syncedRevision: r.revision,
            publishedRevision: null,
            fingerprint: recordFingerprint(r),
          };
        });
        state.run.applied = mappings;
        catalog.mappings = mappings;
        save();
        return { mappings, failures: [] };
      }
      case 'library:publish':
        if (!state.run) fail('VALIDATION', 'Apply a manifest first');
        state.run.published = true;
        save();
        return { verified: true };
      default:
        return null;
    }
  };
}
