import {
  CopyRecordSchema,
  type CopyRecord,
  type BindingTarget,
  type BindingResult,
  type LocalCopy,
  type LibraryMapping,
} from '@string-binder/contracts';
import {
  canvasFingerprint,
  describeRecord,
  recordFingerprint,
  canonical,
  isVisuallyPresentText,
  matchDuplicateLayers,
  type VisibilityNode,
} from '@string-binder/domain';
import { api } from './registry-api';
import { boundVariableId } from './layer-state';
import { readVariableValues } from './library-index';
import { pageCandidates, snapshotText } from './propagate';
import { isDescendantOf } from './selection';
import { loadFont, textsByVariable } from './perf';
export function copyIdOf(variable: Variable): string | null {
  return (
    variable.getSharedPluginData('copy', 'id') ||
    variable.description.match(/^cp_[0-7][0-9A-HJKMNP-TV-Z]{25}/u)?.[0] ||
    null
  );
}
export function baselineOf(variable: Variable): CopyRecord | null {
  try {
    return CopyRecordSchema.parse(JSON.parse(variable.getSharedPluginData('copy', 'record')));
  } catch {
    return null;
  }
}
export function stamp(variable: Variable, r: CopyRecord, delivery = false): void {
  variable.setSharedPluginData('copy', 'id', r.copyId);
  variable.setSharedPluginData('copy', 'record', JSON.stringify(r));
  if (delivery) variable.setSharedPluginData('copy', 'delivery', '1');
  variable.description = describeRecord(r);
}
export function descriptionRevision(v: Variable): number | null {
  try {
    const meta = JSON.parse(
      v.description
        .split('\n')
        .find((l) => l.startsWith('Copy-Meta: '))
        ?.slice(11) ?? '',
    );
    return meta.v === 1 && Number.isInteger(meta.revision) && meta.revision > 0
      ? meta.revision
      : null;
  } catch {
    return null;
  }
}
export async function verifiesSaved(v: Variable, r: CopyRecord): Promise<boolean> {
  if (
    copyIdOf(v) !== r.copyId ||
    v.name.slice(v.name.lastIndexOf('/') + 1) !== r.platformKey ||
    !sameValues(await actual(v), r)
  )
    return false;
  const base = baselineOf(v);
  if (base)
    return (
      recordFingerprint(base) === recordFingerprint(r) &&
      canonical(editableContext(v, base)) === canonical(r.context)
    );
  try {
    const meta = JSON.parse(
      v.description
        .split('\n')
        .find((l) => l.startsWith('Copy-Meta: '))
        ?.slice(11) ?? '',
    );
    return (
      meta.v === 1 &&
      meta.revision === r.revision &&
      meta.hash === recordFingerprint(r) &&
      canonical(editableContext(v, r)) === canonical(r.context)
    );
  } catch {
    return false;
  }
}
export async function fonts(node: TextNode): Promise<void> {
  if (node.hasMissingFont) throw new Error(`Missing font in “${node.name}”`);
  const names = node.characters.length
    ? node.getRangeAllFontNames(0, node.characters.length)
    : [node.fontName as FontName];
  await Promise.all(names.map(loadFont));
}
export async function actual(variable: Variable): Promise<{ en: string; id: string }> {
  const collection = await figma.variables.getVariableCollectionByIdAsync(
    variable.variableCollectionId,
  );
  if (
    !collection?.modes.some((m) => m.name.toUpperCase() === 'EN') ||
    !collection.modes.some((m) => m.name.toUpperCase() === 'ID')
  )
    throw new Error('EN and ID modes are required');
  return readVariableValues(variable);
}
export const sameValues = (r: { en: string; id: string }, v: { en: string; id: string }) =>
  r.en === v.en && r.id === v.id;
export function editableContext(v: Variable, base = baselineOf(v)): CopyRecord['context'] | null {
  if (!base) return null;
  const note =
    v.description
      .split('\n')
      .find((l) => l.startsWith('Note: '))
      ?.slice(6) ?? '';
  const path = v.description.split('\n')[1]?.split(' › ').filter(Boolean) ?? [];
  const expected = [
    base.product,
    base.context.feature,
    base.context.screen,
    base.context.context,
    base.context.role,
  ]
    .filter(Boolean)
    .join(' › ');
  return {
    ...base.context,
    note,
    ...(path.join(' › ') !== expected
      ? {
          screen: path.slice(1, -1).join(' › '),
          feature: '',
          context: '',
          role: path.at(-1) || base.context.role,
        }
      : {}),
  };
}
export async function variableFingerprint(v: Variable): Promise<string> {
  const pair = await actual(v);
  return canonical([v.id, v.name, pair.en, pair.id, editableContext(v), baselineOf(v)?.revision]);
}
export async function scanLocal(): Promise<LocalCopy[]> {
  const rows: LocalCopy[] = [];
  // One collection lookup for the whole scan instead of two per variable.
  const collections = new Map(
    (await figma.variables.getLocalVariableCollectionsAsync()).map((c) => [c.id, c]),
  );
  for (const v of await figma.variables.getLocalVariablesAsync('STRING')) {
    const c = collections.get(v.variableCollectionId);
    const base = baselineOf(v);
    const context = editableContext(v, base);
    try {
      if (
        !c?.modes.some((m) => m.name.toUpperCase() === 'EN') ||
        !c.modes.some((m) => m.name.toUpperCase() === 'ID')
      )
        throw new Error('EN and ID modes are required');
      const values = await readVariableValues(v);
      rows.push({
        variableId: v.id,
        variableKey: v.key,
        name: v.name,
        collection: c?.name ?? '',
        copyId: copyIdOf(v),
        baseline: base,
        context,
        en: values.en,
        id: values.id,
      });
    } catch (e) {
      rows.push({
        variableId: v.id,
        variableKey: v.key,
        name: v.name,
        collection: c?.name ?? '',
        copyId: copyIdOf(v),
        baseline: base,
        context,
        en: '',
        id: '',
        error: e instanceof Error ? e.message : 'Could not read variable',
      });
    }
  }
  return rows;
}
export async function allTexts(): Promise<TextNode[]> {
  await figma.loadAllPagesAsync();
  return figma.root.children.flatMap((p) => p.findAllWithCriteria({ types: ['TEXT'] }));
}
/**
 * Text layers grouped by the identity of their bound variable, in one pass:
 * each distinct variable is looked up once, not once per layer.
 */
export async function textsByCopyId(texts: readonly TextNode[]): Promise<{
  byVariable: Map<string, TextNode[]>;
  byCopy: Map<string, TextNode[]>;
  copyOf: Map<string, string | null>;
}> {
  const byVariable = textsByVariable(texts);
  const ids = [...byVariable.keys()];
  const variables = await Promise.all(ids.map((id) => figma.variables.getVariableByIdAsync(id)));
  const copyOf = new Map<string, string | null>();
  const byCopy = new Map<string, TextNode[]>();
  ids.forEach((id, i) => {
    const v = variables[i];
    const copy = v ? copyIdOf(v) : null;
    copyOf.set(id, copy);
    if (!copy) return;
    const group = byCopy.get(copy);
    if (group) group.push(...byVariable.get(id)!);
    else byCopy.set(copy, [...byVariable.get(id)!]);
  });
  return { byVariable, byCopy, copyOf };
}
/** Text layers in this file bound to each identity. Other files are never counted. */
export async function usageCounts(copyIds: ReadonlySet<string>): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const { byCopy } = await textsByCopyId(await allTexts());
  for (const copy of copyIds) {
    const count = byCopy.get(copy)?.length ?? 0;
    if (count) counts[copy] = count;
  }
  return counts;
}
export async function preview(
  frameId: string,
  rows: { layerId: string; copyId: string; locale: 'en' | 'id'; canvasFingerprint: string }[],
): Promise<{ targets: BindingTarget[]; conflicts: { nodeId: string; frameName: string }[] }> {
  const root = await figma.getNodeByIdAsync(frameId);
  if (!root || !('absoluteBoundingBox' in root)) throw new Error('Select a frame');
  const targets: BindingTarget[] = [];
  const sources = [];
  const conflicts: { nodeId: string; frameName: string }[] = [];
  const sourceRows = new Map(rows.map((r) => [r.layerId, r]));
  for (const row of rows) {
    const n = await figma.getNodeByIdAsync(row.layerId);
    if (!n || n.type !== 'TEXT' || !isDescendantOf(n, frameId))
      throw new Error('Source layer is outside the selected frame');
    if (
      canvasFingerprint({
        id: n.id,
        name: n.name,
        characters: n.characters,
        boundKey: (await bound(n))?.key ?? null,
      }) !== row.canvasFingerprint
    )
      throw new Error(`“${n.name}” changed on canvas. Check its new copy before applying.`);
    await fonts(n);
    sources.push(snapshotText(n, root as SceneNode));
    targets.push({
      nodeId: n.id,
      sourceId: n.id,
      copyId: row.copyId,
      locale: row.locale,
      fingerprint: row.canvasFingerprint,
      variableFingerprint: (await bound(n))
        ? await variableFingerprint((await bound(n))!)
        : undefined,
      frameName: root.name,
      layerName: n.name,
      duplicate: false,
    });
  }
  const candidates = pageCandidates(root as SceneNode).filter((c) =>
    isVisuallyPresentText(
      c.node as unknown as VisibilityNode,
      figma.currentPage as unknown as VisibilityNode,
    ),
  );
  const nodes = new Map(candidates.map((c) => [c.node.id, c.node]));
  for (const match of matchDuplicateLayers({
    sources,
    candidates: candidates.map((c) => c.snapshot),
  })) {
    const node = nodes.get(match.nodeId)!;
    const v = await bound(node);
    const source = sourceRows.get(match.sourceId)!;
    if (v && copyIdOf(v) !== source.copyId) {
      conflicts.push({ nodeId: node.id, frameName: match.frameName });
      continue;
    }
    targets.push({
      nodeId: node.id,
      sourceId: source.layerId,
      copyId: source.copyId,
      locale: source.locale,
      fingerprint: canvasFingerprint({
        id: node.id,
        name: node.name,
        characters: node.characters,
        boundKey: v?.key ?? null,
      }),
      variableFingerprint: v ? await variableFingerprint(v) : undefined,
      frameName: match.frameName,
      layerName: node.name,
      duplicate: true,
    });
  }
  return { targets, conflicts };
}
async function bound(n: TextNode): Promise<Variable | null> {
  const id = boundVariableId(n);
  return id ? figma.variables.getVariableByIdAsync(id) : null;
}
const creating = new Map<string, Promise<VariableCollection>>();

/** Concurrent callers share one lookup, so a product never gets two new collections. */
function productCollection(
  product: string,
  display: string,
  library: boolean,
): Promise<VariableCollection> {
  const key = `${product}:${library}`;
  const pending =
    creating.get(key) ??
    findOrCreateCollection(product, display, library).finally(() => creating.delete(key));
  creating.set(key, pending);
  return pending;
}

async function findOrCreateCollection(
  product: string,
  display: string,
  library: boolean,
): Promise<VariableCollection> {
  const all = await figma.variables.getLocalVariableCollectionsAsync();
  const available = all.find(
    (c) =>
      c.getSharedPluginData('copy', 'product') === product &&
      c.getSharedPluginData('copy', 'surface') === (library ? 'library' : 'working') &&
      c.variableIds.length < 4000,
  );
  if (available) return available;
  const count = all.filter(
    (c) =>
      c.getSharedPluginData('copy', 'product') === product &&
      c.getSharedPluginData('copy', 'surface') === (library ? 'library' : 'working'),
  ).length;
  const base = all.some((c) => c.name === display && !c.getSharedPluginData('copy', 'product'))
    ? `${display} · String Binder`
    : display;
  const c = figma.variables.createVariableCollection(count ? `${base} ${count + 1}` : base);
  c.renameMode(c.defaultModeId, 'ID');
  c.addMode('EN');
  c.hiddenFromPublishing = !library;
  c.setSharedPluginData('copy', 'product', product);
  c.setSharedPluginData('copy', 'surface', library ? 'library' : 'working');
  return c;
}
export async function materialize(
  r: CopyRecord,
  display: string,
  library = false,
  explicit?: Variable,
  overwrite = false,
): Promise<Variable> {
  const matches = (explicit ? [explicit] : await figma.variables.getLocalVariablesAsync('STRING'))
    .filter(
      (v) =>
        copyIdOf(v) === r.copyId && (library || v.getSharedPluginData('copy', 'delivery') === '1'),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  let v = explicit ?? matches[0];
  if (v) {
    const values = await actual(v);
    const base = baselineOf(v);
    if (!overwrite && base && canonical(editableContext(v, base)) !== canonical(base.context))
      throw new Error('Manual variable context needs reconciliation');
    if (!overwrite && !sameValues(values, r) && (!base || !sameValues(values, base)))
      throw new Error('Manual variable changes need reconciliation');
    if (base && base.revision > r.revision)
      throw new Error('Refusing to replace a newer applied revision');
  } else {
    const c = await productCollection(r.product, display, library);
    v = figma.variables.createVariable(r.platformKey, c, 'STRING');
    v.scopes = ['TEXT_CONTENT'];
    v.hiddenFromPublishing = !library;
  }
  const c = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
  const en = c?.modes.find((m) => m.name.toUpperCase() === 'EN'),
    id = c?.modes.find((m) => m.name.toUpperCase() === 'ID');
  if (!en || !id) throw new Error('Collection must contain EN and ID modes');
  v.setValueForMode(en.modeId, r.en);
  v.setValueForMode(id.modeId, r.id);
  v.name = v.name.includes('/')
    ? v.name.slice(0, v.name.lastIndexOf('/') + 1) + r.platformKey
    : r.platformKey;
  stamp(v, r, !library);
  return v;
}
export async function bindRecord(
  n: TextNode,
  v: Variable,
  r: CopyRecord,
  locale: 'en' | 'id',
): Promise<void> {
  await fonts(n);
  const c = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
  const mode = c?.modes.find((m) => m.name.toUpperCase() === locale.toUpperCase());
  if (!c || !mode) throw new Error('Requested language mode is missing');
  n.setBoundVariable('characters', v);
  n.setExplicitVariableModeForCollection(c, mode.modeId);
  n.name = r.platformKey;
  n.setSharedPluginData('copy', 'id', r.copyId);
  n.setSharedPluginData('copy', 'snapshot', JSON.stringify(r));
}
export async function deliver(
  records: CopyRecord[],
  targets: BindingTarget[],
  products: { id: string; displayName: string }[],
  globalIds: string[] = [],
  restoreIds: string[] = [],
): Promise<BindingResult> {
  const result: BindingResult = { applied: [], failures: [], conflicts: [] };
  const valid: { node: TextNode; target: BindingTarget }[] = [];
  for (const target of targets) {
    const n = await figma.getNodeByIdAsync(target.nodeId);
    if (!n || n.type !== 'TEXT') {
      result.failures.push({ nodeId: target.nodeId, reason: 'Layer no longer exists' });
      continue;
    }
    const v = await bound(n);
    const r = records.find((r) => r.copyId === target.copyId);
    try {
      // Recovery after partial success must recognize the exact completed binding.
      if (
        v &&
        r &&
        copyIdOf(v) === r.copyId &&
        baselineOf(v)?.revision === r.revision &&
        sameValues(await actual(v), r) &&
        n.name === r.platformKey &&
        n.characters === r[target.locale]
      ) {
        await bindRecord(n, v, r, target.locale);
        result.applied.push(n.id);
        continue;
      }
      if (
        (target.variableFingerprint &&
          (!v || (await variableFingerprint(v)) !== target.variableFingerprint)) ||
        canvasFingerprint({
          id: n.id,
          name: n.name,
          characters: n.characters,
          boundKey: v?.key ?? null,
        }) !== target.fingerprint
      ) {
        result.conflicts.push(n.id);
        continue;
      }
      await fonts(n);
      valid.push({ node: n, target });
    } catch (e) {
      result.failures.push({ nodeId: n.id, reason: String(e) });
    }
  }
  const all = await allTexts();
  // Grouped once; earlier records rebind layers, so each group is re-checked against live bindings.
  const { byCopy, copyOf } = await textsByCopyId(all);
  figma.commitUndo();
  for (const r of records) {
    try {
      const usages = (byCopy.get(r.copyId) ?? []).filter((n) => {
        const id = boundVariableId(n);
        return !!id && copyOf.get(id) === r.copyId;
      });
      // Updating a variable changes every bound occurrence, so preflight fonts first.
      await Promise.all(usages.map(fonts));
      if (targets.some((t) => t.copyId === r.copyId && result.conflicts.includes(t.nodeId)))
        continue;
      const selected = valid.filter((x) => x.target.copyId === r.copyId);
      for (const { node, target } of selected)
        if (
          (target.variableFingerprint &&
            (!(await bound(node)) ||
              (await variableFingerprint((await bound(node))!)) !== target.variableFingerprint)) ||
          canvasFingerprint({
            id: node.id,
            name: node.name,
            characters: node.characters,
            boundKey: (await bound(node))?.key ?? null,
          }) !== target.fingerprint
        )
          throw new Error('Canvas changed during preflight; reconcile before retrying');
      const v = await materialize(
        r,
        products.find((p) => p.id === r.product)?.displayName ?? r.product,
        false,
        undefined,
        restoreIds.includes(r.copyId),
      );
      for (const { node, target } of selected)
        try {
          await bindRecord(node, v, r, target.locale);
          result.applied.push(node.id);
        } catch (e) {
          result.failures.push({ nodeId: node.id, reason: String(e) });
        }
      if (globalIds.includes(r.copyId))
        for (const n of usages) {
          if (result.applied.includes(n.id)) continue;
          try {
            const previous = await bound(n);
            const oldC = await figma.variables.getVariableCollectionByIdAsync(
              previous!.variableCollectionId,
            );
            const mode = oldC?.modes.find((m) => m.modeId === n.resolvedVariableModes[oldC.id]);
            if (!mode || !['EN', 'ID'].includes(mode.name.toUpperCase()))
              throw new Error('Resolve occurrence language before migration');
            await bindRecord(n, v, r, mode.name.toUpperCase() === 'EN' ? 'en' : 'id');
            result.applied.push(n.id);
          } catch (e) {
            result.failures.push({ nodeId: n.id, reason: String(e) });
          }
        }
    } catch (e) {
      const ids = targets.filter((t) => t.copyId === r.copyId).map((t) => t.nodeId);
      if (!ids.length) ids.push(r.copyId);
      for (const nodeId of ids) result.failures.push({ nodeId, reason: String(e) });
    }
  }
  figma.commitUndo();
  return result;
}
/**
 * Background refresh: brings local delivery variables up to their latest saved
 * wording. It only sets variable values, so layers keep their names, bindings
 * and language modes, and no pages load. Variables edited by hand, or whose
 * identity a draft is changing, are reported as conflicts and left alone.
 */
export async function refreshValues(
  records: CopyRecord[],
  protectedIds: readonly string[],
): Promise<BindingResult> {
  const result: BindingResult = { applied: [], failures: [], conflicts: [] };
  const byId = new Map(records.map((r) => [r.copyId, r]));
  const updates: { v: Variable; r: CopyRecord }[] = [];
  for (const v of await figma.variables.getLocalVariablesAsync('STRING')) {
    if (v.remote || v.getSharedPluginData('copy', 'delivery') !== '1') continue;
    const id = copyIdOf(v);
    const r = id ? byId.get(id) : undefined;
    const base = baselineOf(v);
    if (!id || !r || !base || base.revision >= r.revision || protectedIds.includes(id)) continue;
    try {
      const values = await actual(v);
      if (
        !sameValues(values, base) ||
        canonical(editableContext(v, base)) !== canonical(base.context)
      ) {
        result.conflicts.push(v.id);
        continue;
      }
      updates.push({ v, r });
    } catch (e) {
      result.failures.push({ nodeId: v.id, reason: String(e) });
    }
  }
  if (!updates.length) return result;
  figma.commitUndo();
  for (const { v, r } of updates)
    try {
      const c = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
      const en = c?.modes.find((m) => m.name.toUpperCase() === 'EN');
      const id = c?.modes.find((m) => m.name.toUpperCase() === 'ID');
      if (!en || !id) throw new Error('Collection must contain EN and ID modes');
      v.setValueForMode(en.modeId, r.en);
      v.setValueForMode(id.modeId, r.id);
      stamp(v, r, true);
      result.applied.push(v.id);
    } catch (e) {
      result.failures.push({ nodeId: v.id, reason: String(e) });
    }
  figma.commitUndo();
  return result;
}
export async function refreshUsed(
  records: CopyRecord[],
  products: { id: string; displayName: string }[],
  mappings: LibraryMapping[],
  protectedIds: string[],
): Promise<BindingResult> {
  const result: BindingResult = { applied: [], failures: [], conflicts: [] };
  const byId = new Map(records.map((r) => [r.copyId, r]));
  const dirty = new Set(
    (await scanLocal())
      .filter(
        (l) => l.baseline && l.context && canonical(l.context) !== canonical(l.baseline.context),
      )
      .map((l) => l.variableId),
  );
  const texts = await allTexts();
  const byVariable = textsByVariable(texts);
  const position = new Map(texts.map((n, i) => [n, i]));
  const protectedSet = new Set(protectedIds);
  const used = new Map<string, Variable[]>();
  // Variables in first-usage order, each looked up once.
  const variableIds = [...byVariable.keys()];
  const variables = await Promise.all(
    variableIds.map((id) => figma.variables.getVariableByIdAsync(id)),
  );
  for (const v of variables) {
    const id = v ? copyIdOf(v) : null;
    if (!v || !id || protectedSet.has(id)) continue;
    const group = used.get(id) ?? [];
    group.push(v);
    used.set(id, group);
  }
  /** Layers still bound to a variable; bindings move as groups are processed. */
  const boundTo = (variableId: string) =>
    (byVariable.get(variableId) ?? []).filter((n) => boundVariableId(n) === variableId);
  for (const [id, variables] of used) {
    const r = byId.get(id);
    if (!r) continue;
    try {
      const safe: Variable[] = [];
      const bases = new Map<string, CopyRecord>();
      for (const v of variables) {
        let base = baselineOf(v);
        if (!base && v.remote) {
          const revision = descriptionRevision(v);
          if (revision) {
            const n = boundTo(v.id)[0];
            try {
              const snapshot = JSON.parse(n?.getSharedPluginData('copy', 'snapshot') ?? '');
              if (snapshot.copyId === id && snapshot.revision === revision)
                base = CopyRecordSchema.parse(snapshot);
            } catch {
              /* Resolve through an immutable saved revision below. */
            }
            if (!base)
              base =
                revision === r.revision
                  ? r
                  : CopyRecordSchema.parse(
                      await api(`revision?id=${encodeURIComponent(id)}&revision=${revision}`),
                    );
            if (!(await verifiesSaved(v, base))) base = null;
          }
        }
        if (dirty.has(v.id) || !base || !sameValues(await actual(v), base)) {
          result.conflicts.push(v.id);
          continue;
        }
        if (base.revision > r.revision) continue;
        bases.set(v.id, base);
        safe.push(v);
      }
      if (!safe.length) continue;
      const usages = safe
        .flatMap((v) => boundTo(v.id))
        .sort((a, b) => position.get(a)! - position.get(b)!);
      await Promise.all(usages.map(fonts));
      const mapping = mappings.find(
        (m) =>
          m.copyId === id &&
          m.publishedRevision === r.revision &&
          m.syncedRevision === r.revision &&
          m.fingerprint === recordFingerprint(r),
      );
      let destination: Variable | undefined;
      if (mapping) {
        try {
          const imported = await figma.variables.importVariableByKeyAsync(mapping.variableKey);
          if (await verifiesSaved(imported, r)) destination = imported;
        } catch {
          /* Keep local delivery if the publication is unavailable. */
        }
      }
      if (!destination) {
        const local = safe.find(
          (v) => !v.remote && v.getSharedPluginData('copy', 'delivery') === '1',
        );
        if (safe.every((v) => bases.get(v.id)?.revision === r.revision) && !local)
          destination = safe[0];
        else
          destination = await materialize(
            r,
            products.find((p) => p.id === r.product)?.displayName ?? r.product,
            false,
            local,
          );
      }
      for (const n of usages) {
        const previous = safe.find((v) => boundVariableId(n) === v.id)!;
        const c = await figma.variables.getVariableCollectionByIdAsync(
          previous.variableCollectionId,
        );
        const mode = c?.modes.find((m) => m.modeId === n.resolvedVariableModes[c.id]);
        if (!mode || !['EN', 'ID'].includes(mode.name.toUpperCase())) {
          result.conflicts.push(n.id);
          continue;
        }
        await bindRecord(n, destination, r, mode.name.toUpperCase() === 'EN' ? 'en' : 'id');
        result.applied.push(n.id);
      }
      for (const v of safe)
        if (
          v.id !== destination.id &&
          !v.remote &&
          v.getSharedPluginData('copy', 'delivery') === '1' &&
          !boundTo(v.id).length
        )
          v.remove();
    } catch (e) {
      result.failures.push({ nodeId: id, reason: String(e) });
    }
  }
  return result;
}
export function localFingerprint(local: LocalCopy): string {
  return canonical([local.variableId, local.name, local.en, local.id, local.context]);
}
