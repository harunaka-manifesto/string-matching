import {
  AppError,
  MAX_PLUGIN_TARGETS,
  type RootType,
  type TargetSnapshot,
} from '@ux-copy-sync/contracts';
import {
  collectVisuallyPresentText,
  orderByVisualReading,
  type VisibilityNode,
} from '@ux-copy-sync/domain';

export const SUPPORTED_ROOTS = new Set<RootType>(['FRAME', 'COMPONENT', 'INSTANCE']);

export type FigmaNodeLike = BaseNode & {
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null;
  opacity?: number;
  clipsContent?: boolean;
  fills?: unknown;
  strokes?: unknown;
  autoRename?: boolean;
  hasMissingFont?: boolean;
  characters?: string;
};
type FigmaTextNodeLike = FigmaNodeLike & { type: 'TEXT'; characters: string };

export type SelectionSummary = {
  containerId: string;
  containerName: string;
  containerType: RootType;
  visibleTextCount: number;
};

function bounds(node: FigmaNodeLike) {
  const box = node.absoluteBoundingBox;
  return box
    ? { x: box.x, y: box.y, width: box.width, height: box.height }
    : { x: 0, y: 0, width: 0, height: 0 };
}

function asVisibilityNode(node: FigmaNodeLike): VisibilityNode {
  return node as unknown as VisibilityNode;
}

export function selectedRoot(): FigmaNodeLike {
  const selection = figma.currentPage.selection;
  if (selection.length !== 1)
    throw new AppError('INVALID_SELECTION_COUNT', 'Select one Frame, Component, or Instance.');
  const node = selection[0] as FigmaNodeLike;
  if (!SUPPORTED_ROOTS.has(node.type as RootType))
    throw new AppError('UNSUPPORTED_SELECTION', 'Select one Frame, Component, or Instance.');
  return node;
}

export function discoverTextNodes(root: FigmaNodeLike): FigmaTextNodeLike[] {
  const visible = collectVisuallyPresentText(asVisibilityNode(root));
  const byId = new Map(visible.map((node) => [node.id, node]));
  return orderByVisualReading(
    visible.map((node) => ({ ...bounds(node as FigmaNodeLike), id: node.id })),
  )
    .map((item) => byId.get(item.id) as FigmaTextNodeLike)
    .filter(Boolean);
}

export function targetSnapshot(node: FigmaTextNodeLike): TargetSnapshot {
  const box = bounds(node);
  return {
    id: node.id,
    name: node.name,
    originalCharacters: node.characters,
    originalName: node.name,
    originalAutoRename: node.autoRename ?? false,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    visible: node.visible !== false,
  };
}

export function targetSnapshots(nodes: readonly FigmaTextNodeLike[]): TargetSnapshot[] {
  return nodes.map(targetSnapshot);
}

export function selectionSummary(
  root: FigmaNodeLike,
  targets = discoverTextNodes(root),
): SelectionSummary {
  return {
    containerId: root.id,
    containerName: root.name,
    containerType: root.type as RootType,
    visibleTextCount: targets.length,
  };
}

export function currentSelectionSummary(): SelectionSummary | null {
  const selection = figma.currentPage.selection;
  if (selection.length !== 1 || !SUPPORTED_ROOTS.has(selection[0]!.type as RootType)) return null;
  const root = selection[0] as FigmaNodeLike;
  return selectionSummary(root);
}

export function containingPageId(node: BaseNode | null): string | null {
  let current: BaseNode | null = node;
  while (current) {
    if (current.type === 'PAGE') return current.id;
    current = current.parent;
  }
  return null;
}

export function previewRelevantNodeIds(
  root: FigmaNodeLike,
  targets: readonly FigmaTextNodeLike[],
): Set<string> {
  const ids = new Set<string>([root.id]);
  for (const target of targets) {
    let current: BaseNode | null = target;
    while (current) {
      ids.add(current.id);
      if (current.id === root.id) break;
      current = current.parent;
    }
  }
  return ids;
}

export function targetCountIsSupported(count: number): boolean {
  return count <= MAX_PLUGIN_TARGETS;
}

export function isDescendantOf(node: BaseNode | null, rootId: string): boolean {
  let current = node;
  while (current) {
    if (current.id === rootId) return true;
    current = current.parent;
  }
  return false;
}
