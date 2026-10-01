import type { LayerInfo, SelectionInfo } from '@string-binder/contracts';
import {
  collectVisuallyPresentText,
  nonCopyReason,
  orderByVisualReading,
  type VisibilityNode,
} from '@string-binder/domain';
import { boundVariableId, readLayerState, variableById } from './layer-state';

const SUPPORTED_ROOTS = new Set<NodeType>(['FRAME', 'COMPONENT', 'INSTANCE']);

export function isSupportedRoot(node: BaseNode | null | undefined): node is SceneNode {
  return !!node && SUPPORTED_ROOTS.has(node.type);
}

export function isDescendantOf(node: BaseNode | null, ancestorId: string): boolean {
  let current = node?.parent ?? null;
  while (current) {
    if (current.id === ancestorId) return true;
    current = current.parent;
  }
  return false;
}

/** Ancestor names from the node's parent up to (and including) `root`. */
export function ancestorNames(node: BaseNode, root: BaseNode): string[] {
  const names: string[] = [];
  let current = node.parent;
  while (current) {
    names.push(current.name);
    if (current.id === root.id) break;
    current = current.parent;
  }
  return names;
}

function contextNames(root: SceneNode): string[] {
  const names = [root.name];
  let current = root.parent;
  while (current && current.type !== 'DOCUMENT') {
    names.push(current.name);
    current = current.parent;
  }
  return names;
}

function box(node: SceneNode) {
  const bounds = node.absoluteBoundingBox;
  return bounds
    ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
    : { x: 0, y: 0, width: 0, height: 0 };
}

/** Visible text layers in reading order (top-down, then left-right). */
export function visibleTextLayers(root: SceneNode): TextNode[] {
  const visible = collectVisuallyPresentText(
    root as unknown as VisibilityNode,
  ) as unknown as TextNode[];
  const byId = new Map(visible.map((node) => [node.id, node]));
  return orderByVisualReading(visible.map((node) => ({ ...box(node), id: node.id }))).map((item) =>
    byId.get(item.id)!,
  );
}

function insideInstance(node: BaseNode, root: BaseNode): boolean {
  let current = node.parent;
  while (current) {
    if (current.type === 'INSTANCE') return true;
    if (current.id === root.id) return false;
    current = current.parent;
  }
  return false;
}

async function layerInfo(node: TextNode, root: SceneNode): Promise<LayerInfo> {
  const boundId = boundVariableId(node);
  const variable = boundId ? await variableById(boundId) : null;
  return {
    id: node.id,
    name: node.name,
    characters: node.characters,
    inInstance: insideInstance(node, root),
    contextNames: ancestorNames(node, root),
    boundKey: variable?.key ?? null,
    boundName: variable?.name ?? null,
    stored: readLayerState(node),
    autoSkipReason: nonCopyReason({
      characters: node.characters,
      layerName: node.name,
      ancestorNames: ancestorNames(node, root),
    }),
  };
}

export async function selectionInfo(root: SceneNode): Promise<SelectionInfo> {
  const layers = await Promise.all(visibleTextLayers(root).map((node) => layerInfo(node, root)));
  return { frameId: root.id, frameName: root.name, contextNames: contextNames(root), layers };
}
