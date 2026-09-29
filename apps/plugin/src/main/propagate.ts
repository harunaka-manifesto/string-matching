import { normalizeDuplicateName, type TextNodeSnapshot } from '@string-binder/domain';

const FRAME_TYPES = new Set<NodeType>(['FRAME', 'COMPONENT', 'INSTANCE']);

/**
 * The screen a candidate belongs to. Prefers an ancestor named like the source
 * frame (duplicates of a nested sheet or card), else the top-level screen.
 */
export function screenFrameOf(node: BaseNode, sourceName: string): SceneNode | null {
  const wanted = normalizeDuplicateName(sourceName);
  let topLevel: SceneNode | null = null;
  let current = node.parent;
  while (current && current.type !== 'PAGE' && current.type !== 'DOCUMENT') {
    if (FRAME_TYPES.has(current.type)) {
      const frame = current as SceneNode;
      if (normalizeDuplicateName(frame.name) === wanted) return frame;
      topLevel = frame;
    }
    // Sections group screens; the screen is the frame right below them.
    if (current.parent?.type === 'SECTION') break;
    current = current.parent;
  }
  return topLevel;
}

function center(node: SceneNode) {
  const bounds = node.absoluteBoundingBox;
  return bounds
    ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    : { x: 0, y: 0 };
}

export function snapshotText(node: TextNode, frame: SceneNode): TextNodeSnapshot {
  const path: string[] = [];
  let instancePath: string[] | null = null;
  let current = node.parent;
  while (current && current.id !== frame.id) {
    path.unshift(current.name);
    if (!instancePath && current.type === 'INSTANCE')
      instancePath = [current.name, ...path.slice(1)];
    current = current.parent;
  }
  const origin = frame.absoluteBoundingBox ?? { x: 0, y: 0, width: 0, height: 0 };
  const position = center(node);
  const fontName = node.fontName === figma.mixed ? null : node.fontName;
  return {
    id: node.id,
    name: node.name,
    characters: node.characters,
    frameId: frame.id,
    frameName: frame.name,
    frameWidth: origin.width,
    path,
    fontKey: fontName ? `${fontName.family}/${fontName.style}` : undefined,
    fontSize: node.fontSize === figma.mixed ? undefined : node.fontSize,
    textStyleId: node.textStyleId === figma.mixed ? undefined : node.textStyleId || undefined,
    // Instance names default to the component name, so this identifies the component slot
    // without an async main-component lookup per node.
    instanceKey: instancePath
      ? [...instancePath, node.name].map(normalizeDuplicateName).join('/')
      : undefined,
    offsetX: position.x - origin.x,
    offsetY: position.y - origin.y,
  };
}

/** Text layers on the current page outside `root`, with the screen each belongs to. */
export function pageCandidates(root: SceneNode): { node: TextNode; snapshot: TextNodeSnapshot }[] {
  const candidates: { node: TextNode; snapshot: TextNodeSnapshot }[] = [];
  for (const node of figma.currentPage.findAllWithCriteria({ types: ['TEXT'] })) {
    if (node.id === root.id || isInside(node, root.id)) continue;
    const frame = screenFrameOf(node, root.name);
    if (!frame) continue;
    candidates.push({ node, snapshot: snapshotText(node, frame) });
  }
  return candidates;
}

function isInside(node: BaseNode, ancestorId: string): boolean {
  let current = node.parent;
  while (current) {
    if (current.id === ancestorId) return true;
    current = current.parent;
  }
  return false;
}
