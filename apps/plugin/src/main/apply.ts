import type { ApplySummary, LayerDecision, LayerRef } from '@string-binder/contracts';
import { matchDuplicateLayers, type TextNodeSnapshot } from '@string-binder/domain';
import { boundVariableId, readLayerState, variableById, writeLayerState } from './layer-state';
import { variableByKey } from './library-index';
import { pageCandidates, snapshotText } from './propagate';

class ApplyFailure extends Error {}

async function loadFonts(node: TextNode): Promise<void> {
  if (node.hasMissingFont) throw new ApplyFailure('Missing font');
  const fonts =
    node.characters.length > 0
      ? node.getRangeAllFontNames(0, node.characters.length)
      : [node.fontName as FontName];
  await Promise.all(fonts.map((font) => figma.loadFontAsync(font)));
}

/** Binds and names the layer after its string, e.g. `investment/gopay_investment_…_title`. */
async function bind(node: TextNode, variable: Variable): Promise<boolean> {
  if (node.name !== variable.name) node.name = variable.name;
  if (boundVariableId(node) === variable.id) return false;
  await loadFonts(node);
  node.setBoundVariable('characters', variable);
  return true;
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
): Promise<ApplySummary> {
  const root = await figma.getNodeByIdAsync(rootId);
  if (!root || root.type === 'DOCUMENT' || root.type === 'PAGE')
    throw new Error('The selected frame no longer exists.');
  const frame = root as SceneNode;
  figma.commitUndo();

  const variables = new Map<string, Variable>();
  const keys = [
    ...new Set(decisions.flatMap((item) => (item.action === 'bind' ? [item.key] : []))),
  ];
  await Promise.all(
    keys.map(async (key) => {
      try {
        variables.set(key, await variableByKey(key));
      } catch {
        // Reported per layer below.
      }
    }),
  );

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
