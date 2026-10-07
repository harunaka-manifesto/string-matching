import type { ApplySummary, LayerDecision, LayerRef, ApplyPreview } from '@string-binder/contracts';
import {
  canvasFingerprint,
  matchDuplicateLayers,
  type TextNodeSnapshot,
} from '@string-binder/domain';
import { boundVariableId, readLayerState, variableById, writeLayerState } from './layer-state';
import { variableByKey } from './library-index';
import { pageCandidates, snapshotText } from './propagate';
import { baselineOf, bindRecord, copyIdOf, actual, sameValues } from './delivery';
import { isDescendantOf } from './selection';
import { catalog } from './registry-api';
import { loadFont } from './perf';

class ApplyFailure extends Error {}

async function loadFonts(node: TextNode): Promise<void> {
  if (node.hasMissingFont) throw new ApplyFailure(`Missing font in “${node.name}”`);
  const fonts =
    node.characters.length > 0
      ? node.getRangeAllFontNames(0, node.characters.length)
      : [node.fontName as FontName];
  await Promise.all(fonts.map(loadFont));
}

/** Binds and names the layer after its string, e.g. `investment/gopay_investment_…_title`. */
async function bind(node: TextNode, variable: Variable): Promise<boolean> {
  const changed = boundVariableId(node) !== variable.id;
  const id = copyIdOf(variable);
  const record =
    baselineOf(variable) ??
    (id ? (await catalog().catch(() => null))?.records.find((r) => r.copyId === id) : undefined);
  // Already bound and named: nothing to write, so a missing font elsewhere cannot block it.
  if (!changed && node.name === (record?.platformKey ?? variable.name)) return false;
  await loadFonts(node);
  if (record && sameValues(await actual(variable), record)) {
    const c = await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);
    const language =
      c?.modes
        .find((m) => m.modeId === node.resolvedVariableModes[variable.variableCollectionId])
        ?.name.toUpperCase() === 'EN' || node.characters === record.en
        ? 'en'
        : 'id';
    await bindRecord(node, variable, record, language);
    return changed;
  }
  node.setBoundVariable('characters', variable);
  node.name = variable.name;
  return changed;
}

function ref(node: BaseNode, frameName: string): LayerRef {
  return { id: node.id, name: node.name, frameName };
}

function reason(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Could not update layer';
}

/**
 * Writes the writer's decisions for one frame, then auto-applies bindings and
 * skips to matching layers on the rest of the page. Existing different bindings
 * are never overwritten. Everything lands in one undo step.
 */
export async function applyDecisions(
  rootId: string,
  decisions: readonly LayerDecision[],
  reviewed?: ApplyPreview,
): Promise<ApplySummary> {
  const root = await figma.getNodeByIdAsync(rootId);
  if (!root || root.type === 'DOCUMENT' || root.type === 'PAGE')
    throw new Error('The selected frame no longer exists.');
  const frame = root as SceneNode;
  if (reviewed)
    for (const source of reviewed.sources) {
      const n = await figma.getNodeByIdAsync(source.nodeId);
      if (!n || n.type !== 'TEXT' || (await fingerprint(n)) !== source.fingerprint)
        throw new Error('Canvas changed since review; review Apply again');
    }
  figma.commitUndo();

  const variables = new Map<string, Variable>();
  const keys = [
    ...new Set(decisions.flatMap((item) => (item.action === 'bind' ? [item.key] : []))),
  ];
  // One at a time: two new strings of one product must not each create its collection.
  for (const key of keys)
    try {
      variables.set(key, await variableByKey(key));
    } catch {
      // Reported per layer below.
    }

  const summary: ApplySummary = {
    boundInFrame: 0,
    boundAcrossPage: 0,
    framesTouched: 0,
    skipsCopied: 0,
    conflicts: [],
    failures: [],
    propagated: [],
  };
  const boundSources = new Map<string, Variable>();
  const skippedSources = new Set<string>();
  const sourceNodes = new Map<string, TextNode>();
  // Taken before binding renames layers, so duplicates still match on their original names.
  const snapshots = new Map<string, TextNodeSnapshot>();

  for (const decision of decisions) {
    const node = await figma.getNodeByIdAsync(decision.layerId);
    if (!node || node.type !== 'TEXT') continue;
    if (!isDescendantOf(node, rootId))
      throw new Error('Apply source is outside the reviewed frame');
    if (
      reviewed &&
      (await fingerprint(node)) !== reviewed.sources.find((s) => s.nodeId === node.id)?.fingerprint
    ) {
      summary.failures.push({ ...ref(node, frame.name), reason: 'Source changed during Apply' });
      continue;
    }
    sourceNodes.set(node.id, node);
    snapshots.set(node.id, snapshotText(node, frame));
    try {
      switch (decision.action) {
        case 'bind': {
          const variable = variables.get(decision.key);
          if (!variable) throw new ApplyFailure('String variable is not available in this file');
          if (await bind(node, variable)) summary.boundInFrame += 1;
          writeLayerState(node, null);
          boundSources.set(node.id, variable);
          break;
        }
        case 'unbind':
          node.setBoundVariable('characters', null);
          writeLayerState(node, null);
          break;
        case 'skip':
          writeLayerState(node, 'skip');
          skippedSources.add(node.id);
          break;
        case 'flag':
          writeLayerState(node, 'needs-new');
          break;
        case 'include':
          writeLayerState(node, 'include');
          break;
      }
    } catch (error) {
      summary.failures.push({ ...ref(node, frame.name), reason: reason(error) });
    }
  }

  // Layers already bound before this run still define what their duplicates should be.
  for (const [id, node] of sourceNodes) {
    if (boundSources.has(id) || skippedSources.has(id)) continue;
    const boundId = boundVariableId(node);
    const variable = boundId ? await variableById(boundId) : null;
    if (variable) boundSources.set(id, variable);
  }

  const sources: TextNodeSnapshot[] = [];
  for (const id of [...boundSources.keys(), ...skippedSources]) sources.push(snapshots.get(id)!);
  if (sources.length) {
    const candidates = pageCandidates(frame);
    const nodesById = new Map(candidates.map((item) => [item.node.id, item.node]));
    const frames = new Set<string>();
    for (const match of matchDuplicateLayers({
      sources,
      candidates: candidates.map((item) => item.snapshot),
    })) {
      const node = nodesById.get(match.nodeId)!;
      const layer = ref(node, match.frameName);
      if (reviewed) {
        const approved = reviewed.targets.find(
          (t) => t.nodeId === node.id && t.sourceId === match.sourceId,
        );
        if (!approved) continue;
        if ((await fingerprint(node)) !== approved.fingerprint) {
          summary.conflicts.push(layer);
          continue;
        }
      }
      const currentId = boundVariableId(node);
      const variable = boundSources.get(match.sourceId);
      try {
        if (variable) {
          if (currentId && currentId !== variable.id) {
            summary.conflicts.push(layer);
            continue;
          }
          if (await bind(node, variable)) {
            writeLayerState(node, null);
            summary.boundAcrossPage += 1;
            summary.propagated.push(layer);
            frames.add(match.frameId);
          }
        } else if (!currentId && readLayerState(node) === null) {
          writeLayerState(node, 'skip');
          summary.skipsCopied += 1;
          frames.add(match.frameId);
        }
      } catch (error) {
        summary.failures.push({ ...layer, reason: reason(error) });
      }
    }
    summary.framesTouched = frames.size;
  }

  figma.commitUndo();
  return summary;
}

async function fingerprint(n: TextNode) {
  const id = boundVariableId(n);
  const v = id ? await figma.variables.getVariableByIdAsync(id) : null;
  return canvasFingerprint({
    id: n.id,
    name: n.name,
    characters: n.characters,
    boundKey: v?.key ?? null,
  });
}
export async function previewApply(
  rootId: string,
  decisions: readonly LayerDecision[],
): Promise<ApplyPreview> {
  const root = await figma.getNodeByIdAsync(rootId);
  if (!root || root.type === 'DOCUMENT' || root.type === 'PAGE') throw new Error('Select a frame');
  const snapshots: TextNodeSnapshot[] = [];
  const sources: ApplyPreview['sources'] = [];
  const sourceAction = new Map<string, { action: LayerDecision['action']; key: string | null }>();
  for (const decision of decisions) {
    const n = await figma.getNodeByIdAsync(decision.layerId);
    if (!n || n.type !== 'TEXT' || !isDescendantOf(n, rootId))
      throw new Error('Source is outside selected frame');
    sources.push({ nodeId: n.id, fingerprint: await fingerprint(n) });
    const boundKey = await boundKeyOf(n);
    // Fonts only matter for layers this Apply rewrites.
    if (decision.action === 'bind' && boundKey !== decision.key) await loadFonts(n);
    if (decision.action === 'bind' || decision.action === 'skip' || boundKey)
      snapshots.push(snapshotText(n, root as SceneNode));
    sourceAction.set(n.id, {
      action: decision.action,
      key: decision.action === 'bind' ? decision.key : boundKey,
    });
  }
  const candidates = pageCandidates(root as SceneNode);
  const byId = new Map(candidates.map((c) => [c.node.id, c.node]));
  const targets: ApplyPreview['targets'] = [];
  for (const m of matchDuplicateLayers({
    sources: snapshots,
    candidates: candidates.map((c) => c.snapshot),
  })) {
    const node = byId.get(m.nodeId)!;
    const source = sourceAction.get(m.sourceId);
    const current = await boundKeyOf(node);
    const change: 'bind' | 'skip' | 'none' =
      source?.action === 'skip'
        ? current || readLayerState(node) !== null
          ? 'none'
          : 'skip'
        : current
          ? 'none'
          : source?.key
            ? 'bind'
            : 'none';
    targets.push({
      nodeId: m.nodeId,
      sourceId: m.sourceId,
      frameName: m.frameName,
      layerName: node.name,
      change,
      fingerprint: await fingerprint(node),
    });
  }
  return { sources, targets };
}

async function boundKeyOf(n: TextNode): Promise<string | null> {
  const id = boundVariableId(n);
  return id ? ((await figma.variables.getVariableByIdAsync(id))?.key ?? null) : null;
}
