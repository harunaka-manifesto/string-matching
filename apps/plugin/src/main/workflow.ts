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
} from '@string-binder/contracts';
import { recordFingerprint, canonical } from '@string-binder/domain';
import { api, catalog, settings, type Settings } from './registry-api';
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
  refreshUsed,
  scanLocal,
  sameValues,
  usageCounts,
} from './delivery';
import { boundVariableId } from './layer-state';
import { readPrivate, writePrivate } from './private-storage';
import { previewApply } from './apply';
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
async function checkDestination(candidate?: Settings): Promise<void> {
  const s = candidate ?? (await settings());
  if (!s.libraryId || !s.fileKey) throw new Error('Register the library URL first');
  const registered = figma.root.getPluginData('registry:library');
  if (registered && registered !== s.fileKey)
    throw new Error('This document is registered as another library');
  const vars = await figma.variables.getLocalVariablesAsync('STRING');
  if (
    s.fileKey === 'azS9vExUzw1IRrrGm3NEfD' &&
    !vars.some((v) => !v.remote && v.key === 'bdbb89495ff5458dfe42a388e2a68f6eb233839c') &&
    !registered
  )
    throw new Error('Open the registered GoPay Strings file before configuring library sync');
  figma.root.setPluginData('registry:library', s.fileKey);
}
let refreshedSeq: number | null = null;
let lastRefresh: BindingResult = { applied: [], failures: [], conflicts: [] };
export async function workflow(action: WorkflowAction, raw: unknown): Promise<unknown> {
  const data = (raw ?? {}) as Record<string, any>;
  switch (action) {
    case 'window':
      figma.ui.resize(data.wide ? 640 : 440, data.wide ? 760 : 680);
      return null;
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
      await checkDestination(next);
      await figma.clientStorage.setAsync('registry:settings', next);
      return { saved: true };
    }
    case 'draft:get':
      return (await drafts())[data.frameId] ?? null;
    case 'draft:save': {
      const draft = AuthoringDraftSchema.parse(data.draft);
      const all = await drafts();
      all[draft.frameId] = draft;
      await writePrivate(await draftKey(), all);
      return null;
    }
    case 'catalog':
      return catalog(!data.cached);
    case 'changes':
      return api(`changes?after=${data.after ?? 0}`);
    case 'request':
      return api(`request?id=${encodeURIComponent(data.requestId)}`);
    case 'submit': {
      const batch = MutationBatchSchema.parse(data.batch);
      const response = MutationResultSchema.parse(await api('submit', batch));
      await catalog(true).catch(() => null);
      return response;
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
      const cat = await catalog(true);
      // Loading every page is expensive; polls only rescan the file when the registry moved.
      if (figma.root.getPluginData('registry:library') || (!data.force && refreshedSeq === cat.seq))
        return { catalog: cat, result: lastRefresh };
      const protectedIds = Object.values(await drafts()).flatMap((d) =>
        d.rows.filter((r) => r.action !== 'keep' && r.baseline).map((r) => r.baseline!.copyId),
      );
      lastRefresh = await refreshUsed(cat.records, cat.products, cat.mappings, protectedIds);
      refreshedSeq = cat.seq;
      return { catalog: cat, result: lastRefresh };
    }
    case 'library:scan': {
      await checkDestination();
      const cat = await catalog(true);
      const locals = await scanLocal();
      const byId = new Map(cat.records.map((r) => [r.copyId, r]));
      for (const local of locals) {
        if (local.copyId) continue;
        const key = local.name.slice(local.name.lastIndexOf('/') + 1);
        let matches = cat.records.filter((r) => r.platformKey === key);
        if (!matches.length)
          matches = cat.records.filter(
            (r) => r.aliases.includes(key) || r.aliases.includes(local.name),
          );
        const canonical = [...new Set(matches.map((r) => r.mergedInto ?? r.copyId))];
        if (canonical.length === 1 && byId.has(canonical[0]!)) local.copyId = canonical[0]!;
        else if (local.collection.startsWith('# Legacy'))
          local.error = canonical.length
            ? 'Legacy key ownership is ambiguous; resolve registry aliases'
            : 'Resolve this legacy variable against the registry. Never create another identity.';
      }
      return { catalog: cat, locals };
    }

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
      const cat = await catalog();
      const run = await readPrivate<any>('registry:run');
      if (!run || run.runId !== data.runId) throw new Error('Resume the correct sync manifest');
      await api(
        'library',
        { operation: 'renew', args: { runId: run.runId, owner: run.owner } },
        true,
      );
      const current = await scanLocal();
      const texts = await allTexts();
      const mappings: import('@string-binder/contracts').LibraryMapping[] = [];
      const failures: { copyId: string; reason: string }[] = [];
      let chunk = 0,
        lastRenewed = Date.now();
      for (const rawRecord of run.records) {
        if (chunk++ % 100 === 0 || Date.now() - lastRenewed > 20000) {
          await api(
            'library',
            { operation: 'renew', args: { runId: run.runId, owner: run.owner } },
            true,
          );
          lastRenewed = Date.now();
        }
        const r = CopyRecordSchema.parse(rawRecord);
        const entries = (run.entries ?? []).filter((e: any) => e.copyId === r.copyId);
        try {
          const locals = entries.map((entry: any) => {
            const acknowledged = run.applied?.find((m: any) => m.copyId === r.copyId);
            const local =
              (entry.variableId
                ? current.find((l) => l.variableId === entry.variableId)
                : current.find((l) => l.copyId === r.copyId)) ??
              (acknowledged
                ? current.find((l) => l.variableId === acknowledged.variableId)
                : undefined) ??
              (entry.reuse ? current.find((l) => l.copyId === r.copyId) : undefined);
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
            (reuse
              ? current.find((l) => l.copyId === r.copyId && !sourceIds.has(l.variableId))
              : undefined) ??
            locals.find(({ local }: any) => local?.copyId === r.copyId)?.local ??
            (reuse ? undefined : locals[0]?.local) ??
            current.find((l) => l.copyId === r.copyId);
          const mirrorIds = new Set(
            current
              .filter(
                (l) =>
                  l.copyId === r.copyId &&
                  l.baseline &&
                  sameValues(l, l.baseline) &&
                  canonical(l.context) === canonical(l.baseline.context),
              )
              .map((l) => l.variableId),
          );
          const affected = texts.filter(
            (n) =>
              sourceIds.has(boundVariableId(n) ?? '') || mirrorIds.has(boundVariableId(n) ?? ''),
          );
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
            cat.products.find((p) => p.id === r.product)?.displayName ?? r.product,
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
          }
          for (const id of new Set([...sourceIds, ...mirrorIds]))
            if (id !== v.id && !texts.some((n) => boundVariableId(n) === id)) {
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
          if (chunk % 100 === 0) {
            const prior = run.applied ?? [];
            run.applied = [
              ...prior.filter((m: any) => !mappings.some((n) => n.copyId === m.copyId)),
              ...mappings,
            ];
            await writePrivate('registry:run', run);
          }
        } catch (e) {
          failures.push({ copyId: r.copyId, reason: e instanceof Error ? e.message : String(e) });
        }
      }
      const previous = run.applied ?? [];
      const allMappings = [
        ...previous.filter((m: any) => !mappings.some((n) => n.copyId === m.copyId)),
        ...mappings,
      ];
      await writePrivate('registry:run', { ...run, applied: allMappings });
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
      const scanned = await scanLocal();
      for (const r of run.records) {
        const m = run.applied.find((m: any) => m.copyId === r.copyId);
        const v = await figma.variables.getVariableByIdAsync(m.variableId);
        if (
          !v ||
          v.key !== m.variableKey ||
          copyIdOf(v) !== r.copyId ||
          v.name.slice(v.name.lastIndexOf('/') + 1) !== r.platformKey ||
          canonical(scanned.find((l) => l.variableId === v.id)?.context) !== canonical(r.context) ||
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
      await catalog(true);
      return result;
    }
  }
}
