import {
  AuthoringDraftSchema,
  MutationBatchSchema,
  MutationResultSchema,
  TargetSchema,
  CopyRecordSchema,
  type CopyRecord,
  type WorkflowAction,
  type AuthoringDraft,
  type BindingResult,
  LayerDecisionSchema,
} from '@string-binder/contracts';
import { recordFingerprint, canonical } from '@string-binder/domain';
import { api, apiBytes, catalog, settings, type Settings } from './registry-api';
import {
  actual,
  editableContext,
  allTexts,
  baselineOf,
  bindRecord,
  copyIdOf,
  fonts,
  deliver,
  localFingerprint as localHash,
  materialize,
  preview,
  refreshValues,
  scanLocal,
  sameValues,
  usageCounts,
} from './delivery';
import { boundVariableId } from './layer-state';
import { breathe, textsByVariable } from './perf';
import { activity } from './channel';
import { readPrivate, writePrivate } from './private-storage';
import { applyDecisions, previewApply } from './apply';
import { writePageScope } from './page-scope';
import { selectionInfo, isSupportedRoot } from './selection';

// Private per-device drafts: document marker is routing metadata, not proof of identity.
async function draftKey(): Promise<string> {
  let marker = figma.root.getPluginData('registry:document');
  if (!marker) {
    marker = `${Date.now()}-${figma.root.id}`;
    figma.root.setPluginData('registry:document', marker);
  }
  return `registry:drafts:${marker}`;
}
async function drafts(): Promise<Record<string, AuthoringDraft>> {
  return (await readPrivate<Record<string, AuthoringDraft>>(await draftKey())) ?? {};
}
/** `replace`: the maintainer is saving a corrected setup, so the old stamp may change. */
async function checkDestination(candidate?: Settings, replace = false): Promise<void> {
  const s = candidate ?? (await settings());
  if (!s.libraryId || !s.fileKey) throw new Error('Register the library URL first');
  const registered = figma.root.getPluginData('registry:library');
  if (registered && registered !== s.fileKey && !replace)
    throw new Error(
      'This document is set up as another library. Use Change setup with this file’s URL.',
    );
  const vars = await figma.variables.getLocalVariablesAsync('STRING');
  if (
    s.fileKey === 'azS9vExUzw1IRrrGm3NEfD' &&
    !vars.some((v) => !v.remote && v.key === 'bdbb89495ff5458dfe42a388e2a68f6eb233839c') &&
    !registered
  )
    throw new Error('Open the registered GoPay Strings file before configuring library sync');
  figma.root.setPluginData('registry:library', s.fileKey);
}
function groupBy<T>(items: readonly T[], keys: (item: T) => readonly string[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items)
    for (const key of keys(item)) {
      const group = groups.get(key);
      if (group) group.push(item);
      else groups.set(key, [item]);
    }
  return groups;
}
/** Earlier mappings, minus identities this run re-applied, followed by this run's mappings. */
function mergeMappings<M extends { copyId: string }>(
  previous: readonly M[],
  next: readonly M[],
): M[] {
  const replaced = new Set(next.map((m) => m.copyId));
  return [...previous.filter((m) => !replaced.has(m.copyId)), ...next];
}
let refreshedSeq: number | null = null;
let draftWrites: Promise<void> = Promise.resolve();
let lastRefresh: BindingResult = { applied: [], failures: [], conflicts: [] };
export async function workflow(action: WorkflowAction, raw: unknown): Promise<unknown> {
  const data = (raw ?? {}) as Record<string, any>;
  switch (action) {
    case 'device': {
      let device = await figma.clientStorage.getAsync('registry:device');
      if (!device) {
        if (typeof data.proposed !== 'string' || data.proposed.length > 128)
          throw new Error('Invalid device identifier');
        device = data.proposed;
        await figma.clientStorage.setAsync('registry:device', device);
      }
      return device;
    }
    case 'settings:get': {
      const s = await settings();
      return {
        libraryId: s.libraryId ?? '',
        fileKey: s.fileKey ?? '',
        hasPublisherToken: !!s.publisherToken,
        isLibrary: !!figma.root.getPluginData('registry:library'),
      };
    }
    case 'settings:save': {
      const next: Settings = {
        ...(await settings()),
        libraryId: String(data.libraryId ?? '').trim(),
        fileKey: String(data.fileKey ?? '').trim(),
        ...(data.publisherToken ? { publisherToken: String(data.publisherToken).trim() } : {}),
      };
      if (!next.publisherToken) throw new Error('Enter the publisher token');
      // Validate first: a rejected setup must not leave this device locked onto wrong values.
      await checkDestination(next, true);
      await figma.clientStorage.setAsync('registry:settings', next);
      return { saved: true };
    }
    case 'draft:get':
      return (await drafts())[data.frameId] ?? null;
    case 'draft:save': {
      const draft = AuthoringDraftSchema.parse(data.draft);
      // Read-modify-write of one map: chain saves so a quick second save cannot drop the first.
      draftWrites = draftWrites.then(async () => {
        const all = await drafts();
        const empty =
          !draft.rows.length && !Object.keys(draft.picks ?? {}).length && !draft.pending;
        if (empty) delete all[draft.frameId];
        else all[draft.frameId] = draft;
        await writePrivate(await draftKey(), all);
      });
      await draftWrites;
      return null;
    }
    case 'scope:set':
      return writePageScope(String(data.pageId), {
        product: String(data.product ?? ''),
        confirmed: !!data.confirmed,
      });
    case 'writer:commit': {
      // Saved copy first (it may create the variables bindings use), then existing-copy bindings.
      const records = (data.records ?? []).map((r: unknown) => CopyRecordSchema.parse(r));
      const binding: BindingResult = records.length
        ? await deliver(
            records,
            (data.targets ?? []).map((t: unknown) => TargetSchema.parse(t)),
            (await catalog()).products,
            data.globalIds ?? [],
            data.restoreIds ?? [],
          )
        : { applied: [], failures: [], conflicts: [] };
      refreshedSeq = null;
      const decisions = LayerDecisionSchema.array().parse(data.decisions ?? []);
      const summary = decisions.length
        ? await applyDecisions(data.frameId, decisions, data.preview)
        : null;
      return { binding, summary };
    }
    case 'registry:fetch': {
      const path = String(data.path ?? '');
      if (!/^(?:catalog|changes\?after=\d+)$/u.test(path)) throw new Error('Unknown registry read');
      return apiBytes(path);
    }
    case 'changes':
      return api(`changes?after=${data.after ?? 0}`);
    case 'request':
      return api(`request?id=${encodeURIComponent(data.requestId)}`);
    case 'submit': {
      const batch = MutationBatchSchema.parse(data.batch);
      // The UI pulls the new revisions into its catalog after a submit.
      return MutationResultSchema.parse(await api('submit', batch));
    }
    case 'scan': {
      const root = await figma.getNodeByIdAsync(data.frameId);
      if (!isSupportedRoot(root)) throw new Error('Select a frame');
      const selection = await selectionInfo(root);
      const bindings: Record<string, string> = {};
      const variables: Record<
        string,
        { en: string; id: string; baseline?: CopyRecord; manual: boolean; remote: boolean }
      > = {};
      for (const l of selection.layers) {
        const node = await figma.getNodeByIdAsync(l.id);
        if (node?.type === 'TEXT') {
          const id = boundVariableId(node);
          const v = id ? await figma.variables.getVariableByIdAsync(id) : null;
          const copy = v ? copyIdOf(v) : null;
          if (copy) {
            bindings[l.id] = copy;
            try {
              const pair = await actual(v!);
              const base = baselineOf(v!);
              variables[l.id] = {
                ...pair,
                baseline: base ?? undefined,
                manual: !!base && !sameValues(pair, base),
                remote: v!.remote,
              };
            } catch {
              /* Scanning still exposes the affected row. */
            }
          }
        }
      }
      return { selection, bindings, variables };
    }
    case 'apply:preview':
      return previewApply(data.frameId, data.decisions);
    case 'preflight': {
      const reviewed = await preview(data.frameId, data.rows);
      // Global edits reach every usage in this file; count them so review states the impact.
      const globalIds = new Set<string>(
        data.rows
          .filter((r: any) => r.action === 'edit' || r.restoreLocal)
          .map((r: any) => r.copyId),
      );
      const usages = globalIds.size ? await usageCounts(globalIds) : {};
      return { ...reviewed, usages };
    }
    case 'deliver':
      refreshedSeq = null;
      return deliver(
        data.records.map((r: unknown) => CopyRecordSchema.parse(r)),
        data.targets.map((t: unknown) => TargetSchema.parse(t)),
        (await catalog()).products,
        data.globalIds ?? [],
        data.restoreIds ?? [],
      );
    case 'refresh': {
      // Only local mirror values change in the background; bindings change on explicit Apply.
      if (figma.root.getPluginData('registry:library')) return { result: lastRefresh };
      // Only the records behind this file's delivered copy are needed, not the whole catalog.
      const delivered = (await figma.variables.getLocalVariablesAsync('STRING')).flatMap((v) => {
        const id = !v.remote && v.getSharedPluginData('copy', 'delivery') === '1' && copyIdOf(v);
        return id ? [id] : [];
      });
      const cat = await catalog(delivered);
      if (!data.force && refreshedSeq === cat.seq) return { result: lastRefresh };
      const protectedIds = Object.values(await drafts()).flatMap((d) =>
        d.rows.filter((r) => r.action !== 'keep' && r.baseline).map((r) => r.baseline!.copyId),
      );
      lastRefresh = await refreshValues(cat.records, protectedIds);
      refreshedSeq = cat.seq;
      return { result: lastRefresh };
    }
    case 'library:scan':
      // Matching against the registry happens in the UI, which holds the catalog.
      await checkDestination();
      return { locals: await scanLocal() };

    case 'library:start': {
      await checkDestination();
      const s = await settings();
      const manifest = data.records.map((r: CopyRecord) => ({
        copyId: r.copyId,
        revision: r.revision,
        fingerprint: recordFingerprint(r),
      }));
      const response = await api(
        'library',
        {
          operation: 'start',
          args: {
            libraryId: s.libraryId,
            fileKey: s.fileKey,
            runId: data.runId,
            owner: data.owner,
            manifest,
          },
        },
        true,
      );
      const previous = await readPrivate<any>('registry:run');
      await writePrivate('registry:run', {
        ...(previous?.runId === data.runId ? previous : {}),
        ...data,
        libraryId: s.libraryId,
      });
      return response;
    }
    case 'library:apply': {
      await checkDestination();
      const s = await settings();
      const { products } = await catalog();
      const run = await readPrivate<any>('registry:run');
      if (!run || run.runId !== data.runId) throw new Error('Resume the correct sync manifest');
      await api(
        'library',
        { operation: 'renew', args: { runId: run.runId, owner: run.owner } },
        true,
      );
      const current = await scanLocal();
      const texts = await allTexts();
      // Every lookup below used to scan all locals, texts or entries once per record.
      const localById = new Map(current.map((l) => [l.variableId, l]));
      const localsByCopy = groupBy(current, (l) => (l.copyId ? [l.copyId] : []));
      const entriesByCopy = groupBy<any>(run.entries ?? [], (e) => [e.copyId]);
      const appliedByCopy = new Map<string, any>();
      for (const m of [...(run.applied ?? [])].reverse()) appliedByCopy.set(m.copyId, m);
      const byVariable = textsByVariable(texts);
      const position = new Map(texts.map((n, i) => [n, i]));
      /** Layers bound to a variable right now; bindings move as records are applied. */
      const boundTo = (variableId: string) =>
        (byVariable.get(variableId) ?? []).filter((n) => boundVariableId(n) === variableId);
      const mappings: import('@string-binder/contracts').LibraryMapping[] = [];
      const failures: { copyId: string; reason: string }[] = [];
      let chunk = 0,
        lastRenewed = Date.now(),
        lastCheckpoint = Date.now();
      const total = run.records.length;
      for (const rawRecord of run.records) {
        // Let Figma repaint between records and show where the sync is.
        if (chunk % 10 === 0) {
          activity('library:apply', 'Applying library sync', chunk, total);
          await breathe();
        }
        if (chunk++ % 100 === 0 || Date.now() - lastRenewed > 20000) {
          await api(
            'library',
            { operation: 'renew', args: { runId: run.runId, owner: run.owner } },
            true,
          );
          lastRenewed = Date.now();
        }
        const r = CopyRecordSchema.parse(rawRecord);
        const entries = entriesByCopy.get(r.copyId) ?? [];
        const sameCopy = localsByCopy.get(r.copyId) ?? [];
        try {
          const locals = entries.map((entry: any) => {
            const acknowledged = appliedByCopy.get(r.copyId);
            const local =
              (entry.variableId ? localById.get(entry.variableId) : sameCopy[0]) ??
              (acknowledged ? localById.get(acknowledged.variableId) : undefined) ??
              (entry.reuse ? sameCopy[0] : undefined);
            const complete =
              local?.baseline?.revision === r.revision &&
              sameValues(local, r) &&
              canonical(local.context) === canonical(r.context);
            if (
              entry.fingerprint &&
              (!local || localHash(local) !== entry.fingerprint) &&
              !complete
            )
              throw new Error(
                'Variable changed since review; review outstanding work before replacing it',
              );
            return { entry, local };
          });
          const sourceIds = new Set<string>(
            locals.flatMap(({ local }: any) => (local ? [local.variableId] : [])),
          );
          const reuse = entries.some((e: any) => e.reuse);
          const canonicalLocal =
            (reuse ? sameCopy.find((l) => !sourceIds.has(l.variableId)) : undefined) ??
            locals.find(({ local }: any) => local?.copyId === r.copyId)?.local ??
            (reuse ? undefined : locals[0]?.local) ??
            sameCopy[0];
          const mirrorIds = new Set(
            sameCopy
              .filter(
                (l) =>
                  l.baseline &&
                  sameValues(l, l.baseline) &&
                  canonical(l.context) === canonical(l.baseline.context),
              )
              .map((l) => l.variableId),
          );
          const affected = [...new Set([...sourceIds, ...mirrorIds])]
            .flatMap(boundTo)
            .sort((a, b) => position.get(a)! - position.get(b)!);
          await Promise.all(affected.map(fonts));
          if (Date.now() - lastRenewed > 20000) {
            await api(
              'library',
              { operation: 'renew', args: { runId: run.runId, owner: run.owner } },
              true,
            );
            lastRenewed = Date.now();
          }
          // Fonts are async; recheck the reviewed sources immediately before writing.
          for (const { entry, local } of locals) {
            if (!local || !entry.fingerprint) continue;
            const v = await figma.variables.getVariableByIdAsync(local.variableId);
            if (!v) throw new Error('Reviewed variable disappeared');
            const pair = await actual(v);
            if (
              !sameValues(pair, local) ||
              v.name !== local.name ||
              canonical(editableContext(v)) !== canonical(local.context)
            )
              throw new Error('Variable changed during sync preflight');
          }
          const explicit = canonicalLocal
            ? await figma.variables.getVariableByIdAsync(canonicalLocal.variableId)
            : undefined;
          const v = await materialize(
            r,
            products.find((p) => p.id === r.product)?.displayName ?? r.product,
            true,
            explicit ?? undefined,
            entries.some((e: any) => e.overwrite),
          );
          for (const n of affected) {
            const old = await figma.variables.getVariableByIdAsync(boundVariableId(n)!);
            const c = old
              ? await figma.variables.getVariableCollectionByIdAsync(old.variableCollectionId)
              : null;
            const mode = c?.modes.find((m) => m.modeId === n.resolvedVariableModes[c.id]);
            if (!mode || !['EN', 'ID'].includes(mode.name.toUpperCase()))
              throw new Error('Resolve occurrence locale before consolidating variables');
            await bindRecord(n, v, r, mode.name.toUpperCase() === 'EN' ? 'en' : 'id');
            const moved = byVariable.get(v.id);
            if (moved) moved.push(n);
            else byVariable.set(v.id, [n]);
          }
          for (const id of new Set([...sourceIds, ...mirrorIds]))
            if (id !== v.id && !boundTo(id).length) {
              const peer = await figma.variables.getVariableByIdAsync(id);
              if (peer && !peer.remote) peer.remove();
            }
          mappings.push({
            libraryId: s.libraryId!,
            copyId: r.copyId,
            variableId: v.id,
            variableKey: v.key,
            syncedRevision: r.revision,
            publishedRevision: null,
            fingerprint: recordFingerprint(r),
          });
          // Checkpoint for resume. The run holds every record, so compressing and storing it
          // is costly; doing it by time instead of every 100 records keeps large syncs moving.
          if (Date.now() - lastCheckpoint > 10000) {
            run.applied = mergeMappings(run.applied ?? [], mappings);
            await writePrivate('registry:run', run);
            lastCheckpoint = Date.now();
          }
        } catch (e) {
          failures.push({ copyId: r.copyId, reason: e instanceof Error ? e.message : String(e) });
        }
      }
      activity('library:apply', 'Saving sync progress');
      const allMappings = mergeMappings(run.applied ?? [], mappings);
      await writePrivate('registry:run', { ...run, applied: allMappings });
      activity('library:apply', null);
      await api(
        'library',
        { operation: 'ack', args: { runId: run.runId, owner: run.owner, mappings: allMappings } },
        true,
      );
      return { mappings: allMappings, failures };
    }
    case 'library:manifest':
      return (await readPrivate<any>('registry:run')) ?? null;
    case 'library:pending':
      if ('value' in data) {
        await writePrivate('registry:pending', data.value);
        return null;
      }
      return (await readPrivate<any>('registry:pending')) ?? null;
    case 'library:ack':
      return api('library', data, true);
    case 'library:publish': {
      const run = await readPrivate<any>('registry:run');
      if (!run) throw new Error('Apply a sync manifest first');
      const s = await settings();
      await api(
        'library',
        {
          operation: 'start',
          args: {
            libraryId: s.libraryId,
            fileKey: s.fileKey,
            runId: run.runId,
            owner: run.owner,
            manifest: run.records.map((r: CopyRecord) => ({
              copyId: r.copyId,
              revision: r.revision,
              fingerprint: recordFingerprint(r),
            })),
          },
        },
        true,
      );
      if (run.applied?.length !== run.records.length)
        throw new Error('Finish all outstanding entries before publication');
      const scanned = new Map((await scanLocal()).map((l) => [l.variableId, l]));
      const appliedByCopy = new Map<string, any>();
      for (const m of [...run.applied].reverse()) appliedByCopy.set(m.copyId, m);
      for (const r of run.records) {
        const m = appliedByCopy.get(r.copyId);
        const v = await figma.variables.getVariableByIdAsync(m.variableId);
        if (
          !v ||
          v.key !== m.variableKey ||
          copyIdOf(v) !== r.copyId ||
          v.name.slice(v.name.lastIndexOf('/') + 1) !== r.platformKey ||
          canonical(scanned.get(v.id)?.context) !== canonical(r.context) ||
          (await v.getPublishStatusAsync()) !== 'CURRENT' ||
          !sameValues(await actual(v), r) ||
          recordFingerprint(baselineOf(v) ?? r) !== recordFingerprint(r) ||
          baselineOf(v)?.revision !== r.revision
        )
          throw new Error(
            `Publish the exact saved revision of ${r.platformKey} through Figma first`,
          );
      }
      const result = await api(
        'library',
        { operation: 'publish', args: { runId: run.runId, owner: run.owner } },
        true,
      );
      await writePrivate('registry:run', { ...run, published: true });
      return result;
    }
  }
}
