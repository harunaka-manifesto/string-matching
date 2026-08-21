import {
  AppError,
  type PreviewSnapshot,
  type ReviewedPair,
  type TargetSnapshot,
} from '@ux-copy-sync/contracts';
import { normalizeLayerName } from '@ux-copy-sync/domain';
import { isDescendantOf, targetSnapshots, discoverTextNodes } from './selection';
import { loadFontsForNodes } from './fonts';
import { sameTargetSnapshot, validateFigmaPreview } from './snapshots';

type ApplyNode = TextNode & { autoRename?: boolean; hasMissingFont?: boolean };
type ApplyBackup = {
  layerId: string;
  characters: string;
  name: string;
  autoRename: boolean;
  styleFingerprint?: string;
  complexStyle: boolean;
};

function styleFingerprint(node: ApplyNode): string | undefined {
  try {
    const getSegments = (
      node as unknown as {
        getStyledTextSegments?: (fields: string[], start?: number, end?: number) => unknown;
      }
    ).getStyledTextSegments;
    if (getSegments)
      return JSON.stringify(
        getSegments.call(node, [
          'fontName',
          'fontSize',
          'fontWeight',
          'fills',
          'strokes',
          'textDecoration',
          'textCase',
          'letterSpacing',
          'lineHeight',
          'hyperlink',
          'openTypeFeatures',
        ]),
      );
    if (typeof node.getRangeAllFontNames === 'function')
      return JSON.stringify(node.getRangeAllFontNames(0, node.characters.length));
  } catch {
    return undefined;
  }
  return undefined;
}

function hasComplexStyle(node: ApplyNode): boolean {
  try {
    const getSegments = (
      node as unknown as {
        getStyledTextSegments?: (fields: string[], start?: number, end?: number) => unknown[];
      }
    ).getStyledTextSegments;
    if (getSegments)
      return getSegments.call(node, ['fontName', 'fontSize', 'fills', 'strokes']).length > 1;
    return node.getRangeAllFontNames(0, node.characters.length).length > 1;
  } catch {
    return true;
  }
}

export function replaceTextUsingFirstStyle(node: ApplyNode, nextCharacters: string): void {
  if (node.characters === nextCharacters) return;
  const original = node.characters;
  if (
    original.length > 0 &&
    typeof node.insertCharacters === 'function' &&
    typeof node.deleteCharacters === 'function'
  ) {
    node.insertCharacters(0, nextCharacters, 'AFTER');
    node.deleteCharacters(nextCharacters.length, nextCharacters.length + original.length);
  } else {
    node.characters = nextCharacters;
  }
  if (node.characters !== nextCharacters) node.characters = nextCharacters;
}

export function setFinalLayerName(node: ApplyNode, value: string): void {
  const normalized = normalizeLayerName(value);
  node.name = normalized;
  try {
    node.autoRename = true;
  } catch {
    /* older Figma API */
  }
  if (node.name !== normalized) {
    node.name = normalized;
    if (node.autoRename !== true) node.autoRename = false;
  }
}

function lockedAncestorName(node: BaseNode): string | null {
  let current: BaseNode | null = node;
  while (current && current.type !== 'PAGE') {
    if ('locked' in current && current.locked) return current.name;
    current = current.parent;
  }
  return null;
}

function uniquePairs(
  pairs: ReviewedPair[],
  preview: PreviewSnapshot,
  sourceValues: Map<string, string>,
): void {
  const known = new Set(preview.targets.map((target) => target.id));
  const used = new Set<string>();
  const usedReplacements = new Set<string>();
  for (const pair of pairs) {
    if (
      !known.has(pair.layerId) ||
      used.has(pair.layerId) ||
      usedReplacements.has(pair.replacementId)
    )
      throw new AppError('APPLY_FAILED', 'The reviewed pairing is invalid.');
    const sourceValue = sourceValues.get(pair.replacementId);
    if (sourceValue === undefined || sourceValue !== pair.value)
      throw new AppError(
        'APPLY_FAILED',
        'The reviewed Sheet copy is invalid. Refresh the preview.',
      );
    used.add(pair.layerId);
    usedReplacements.add(pair.replacementId);
  }
}

export async function applyReviewedPairs(input: {
  preview: PreviewSnapshot;
  sourceValues: Array<{ id: string; value: string }>;
  pairs: ReviewedPair[];
  resolveNode: (id: string) => Promise<BaseNode | null>;
  resolveRoot: (id: string) => Promise<BaseNode | null>;
  verifySource: () => Promise<void>;
  discoverSnapshots: (root: SceneNode) => TargetSnapshot[];
  currentPageId: string;
  getCurrentPageId?: () => string;
}): Promise<{ appliedCount: number; layerIds: string[] }> {
  const { preview, pairs } = input;
  if (preview.applied || preview.applying)
    throw new AppError('PREVIEW_ALREADY_APPLIED', 'These changes are already being applied.');
  if (!pairs.length) throw new AppError('APPLY_FAILED', 'Choose at least one change to apply.');
  uniquePairs(
    pairs,
    preview,
    new Map(input.sourceValues.map((source) => [source.id, source.value])),
  );
  preview.applying = true;
  try {
    await validateFigmaPreview(
      preview,
      input.resolveRoot,
      input.discoverSnapshots,
      input.currentPageId,
    );
    await input.verifySource();
    const resolved: Array<{
      pair: ReviewedPair;
      node: ApplyNode;
      backup: ApplyBackup;
      changes: boolean;
    }> = [];
    for (const pair of pairs) {
      const node = await input.resolveNode(pair.layerId);
      if (!node || node.type !== 'TEXT' || !isDescendantOf(node, preview.rootId))
        throw new AppError(
          'PREVIEW_STALE',
          'A reviewed text layer is no longer inside the selected design. Refresh the preview.',
        );
      const textNode = node as ApplyNode;
      const lockedBy = lockedAncestorName(node);
      if (lockedBy)
        throw new AppError(
          'LOCKED_LAYER',
          `Some target copy is inside a locked layer (“${lockedBy}”). Unlock it before applying changes.`,
          { layers: [textNode.name] },
        );
      const normalized = normalizeLayerName(pair.value);
      resolved.push({
        pair,
        node: textNode,
        backup: {
          layerId: textNode.id,
          characters: textNode.characters,
          name: textNode.name,
          autoRename: textNode.autoRename ?? false,
          styleFingerprint: styleFingerprint(textNode),
          complexStyle: hasComplexStyle(textNode),
        },
        changes: textNode.characters !== pair.value || textNode.name !== normalized,
      });
    }
    const changes = resolved.filter((item) => item.changes);
    if (!changes.length)
      throw new AppError('APPLY_FAILED', 'Everything in this review is already synced.');
    await loadFontsForNodes(changes.map((item) => item.node));
    if (input.getCurrentPageId && input.getCurrentPageId() !== input.currentPageId)
      throw new AppError(
        'PREVIEW_STALE',
        'The design changed pages. Refresh the preview before applying.',
      );
    const api = figma as PluginAPI & { commitUndo?: () => void; triggerUndo?: () => void };
    if (changes.some((item) => item.backup.complexStyle) && !api.triggerUndo)
      throw new AppError(
        'ROLLBACK_FAILED',
        'This text uses mixed styling and the Figma undo API is unavailable. No changes were made.',
      );
    api.commitUndo?.();
    const written: typeof changes = [];
    try {
      for (const item of changes) {
        written.push(item);
        replaceTextUsingFirstStyle(item.node, item.pair.value);
        setFinalLayerName(item.node, item.pair.value);
      }
      api.commitUndo?.();
    } catch (cause) {
      console.error('[UX Copy Sync] Apply mutation failed.', {
        name: cause instanceof Error ? cause.name : typeof cause,
      });
      let undoSucceeded = false;
      try {
        if (!api.triggerUndo) throw new Error('Figma undo is unavailable.');
        api.triggerUndo();
        undoSucceeded = true;
      } catch {
        // Plain/single-style text can still use the verified fallback below.
      }
      let rollbackFailed = false;
      for (const item of [...written].reverse()) {
        try {
          const currentStyle = styleFingerprint(item.node);
          const styleRestored =
            item.backup.styleFingerprint !== undefined &&
            currentStyle === item.backup.styleFingerprint;
          if (!styleRestored && item.backup.complexStyle) {
            rollbackFailed = true;
            continue;
          }
          if (item.node.characters !== item.backup.characters)
            item.node.characters = item.backup.characters;
          item.node.name = item.backup.name;
          item.node.autoRename = item.backup.autoRename;
          if (
            item.node.characters !== item.backup.characters ||
            item.node.name !== item.backup.name ||
            item.node.autoRename !== item.backup.autoRename ||
            (item.backup.styleFingerprint !== undefined &&
              styleFingerprint(item.node) !== item.backup.styleFingerprint) ||
            (item.backup.styleFingerprint === undefined && undoSucceeded)
          )
            rollbackFailed = true;
        } catch {
          rollbackFailed = true;
        }
      }
      throw new AppError(
        rollbackFailed ? 'ROLLBACK_FAILED' : 'APPLY_FAILED',
        rollbackFailed
          ? 'The apply failed and the document could not be fully restored.'
          : `The apply failed and changes were rolled back.`,
      );
    }
    preview.applied = true;
    return { appliedCount: changes.length, layerIds: changes.map((item) => item.node.id) };
  } finally {
    preview.applying = false;
  }
}
