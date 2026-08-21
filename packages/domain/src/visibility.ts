export const VISIBILITY_EPSILON = 0.0001;

export type Rect = { x: number; y: number; width: number; height: number };

export type PaintLike = {
  visible?: boolean;
  opacity?: number;
  color?: { a?: number };
};

export type VisibilityNode = {
  id: string;
  type: string;
  visible?: boolean;
  opacity?: number;
  characters?: string;
  absoluteBoundingBox?: Rect | null;
  fills?: PaintLike[] | unknown;
  strokes?: PaintLike[] | unknown;
  clipsContent?: boolean;
  parent?: VisibilityNode | null;
  children?: VisibilityNode[];
};

export function intersection(a: Rect, b: Rect): Rect | null {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function hasRenderablePaint(value: unknown): boolean {
  if (!Array.isArray(value)) return true;
  return (
    value.length > 0 &&
    value.some((paint) => {
      const item = paint as PaintLike;
      return (
        item.visible !== false && (item.opacity ?? 1) * (item.color?.a ?? 1) > VISIBILITY_EPSILON
      );
    })
  );
}

function ancestorChain(node: VisibilityNode, root: VisibilityNode): VisibilityNode[] {
  const chain: VisibilityNode[] = [];
  let current: VisibilityNode | null | undefined = node;
  while (current) {
    chain.push(current);
    if (current.id === root.id) break;
    current = current.parent;
  }
  return chain;
}

export function isVisuallyPresentText(node: VisibilityNode, root: VisibilityNode): boolean {
  if (node.type !== 'TEXT' || (node.characters ?? '').trim().length === 0) return false;
  const chain = ancestorChain(node, root);
  if (chain.at(-1)?.id !== root.id) return false;
  if (chain.some((ancestor) => ancestor.visible === false)) return false;
  const opacity = chain.reduce((product, ancestor) => product * (ancestor.opacity ?? 1), 1);
  if (opacity <= VISIBILITY_EPSILON) return false;
  if (!hasRenderablePaint(node.fills) && !hasRenderablePaint(node.strokes)) return false;

  const nodeBounds = node.absoluteBoundingBox;
  const rootBounds = root.absoluteBoundingBox;
  if (!nodeBounds || !rootBounds) return true;
  let visibleRegion = intersection(nodeBounds, rootBounds);
  if (!visibleRegion) return false;
  for (const ancestor of chain) {
    if (ancestor.clipsContent && ancestor.absoluteBoundingBox) {
      visibleRegion = intersection(visibleRegion, ancestor.absoluteBoundingBox);
      if (!visibleRegion) return false;
    }
  }
  return true;
}

export function collectVisuallyPresentText(root: VisibilityNode): VisibilityNode[] {
  const result: VisibilityNode[] = [];
  const visit = (node: VisibilityNode) => {
    if (node.id !== root.id && node.type === 'TEXT' && isVisuallyPresentText(node, root))
      result.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  for (const child of root.children ?? []) visit(child);
  return result;
}
