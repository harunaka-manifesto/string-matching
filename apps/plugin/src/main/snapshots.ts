import { AppError, type PreviewSnapshot, type TargetSnapshot } from '@ux-copy-sync/contracts';
import { containingPageId } from './selection';

export function createPreviewToken(): string {
  const cryptoObject = (
    globalThis as unknown as {
      crypto?: { randomUUID?: () => string; getRandomValues?: (array: Uint8Array) => Uint8Array };
    }
  ).crypto;
  if (cryptoObject?.randomUUID) return cryptoObject.randomUUID();
  if (cryptoObject?.getRandomValues) {
    const bytes = cryptoObject.getRandomValues(new Uint8Array(24));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function createPreview(
  input: Omit<PreviewSnapshot, 'token' | 'createdAt' | 'applied'>,
): PreviewSnapshot {
  return { ...input, token: createPreviewToken(), createdAt: Date.now(), applied: false };
}

export function sameTargetSnapshot(
  before: readonly TargetSnapshot[],
  after: readonly TargetSnapshot[],
): boolean {
  if (before.length !== after.length) return false;
  return before.every((oldTarget, index) => {
    const next = after[index];
    return (
      Boolean(next) &&
      oldTarget.id === next!.id &&
      oldTarget.originalCharacters === next!.originalCharacters &&
      oldTarget.visible === next!.visible &&
      Math.abs(oldTarget.x - next!.x) <= 0.01 &&
      Math.abs(oldTarget.y - next!.y) <= 0.01 &&
      Math.abs(oldTarget.width - next!.width) <= 0.01 &&
      Math.abs(oldTarget.height - next!.height) <= 0.01
    );
  });
}

export async function validateFigmaPreview(
  preview: PreviewSnapshot,
  resolveRoot: (id: string) => Promise<SceneNode | BaseNode | null>,
  discover: (root: SceneNode) => TargetSnapshot[],
  currentPageId: string,
): Promise<void> {
  if (currentPageId !== preview.pageId)
    throw new AppError(
      'PREVIEW_STALE',
      'The design changed pages. Refresh the preview before applying.',
    );
  const root = await resolveRoot(preview.rootId);
  if (!root || root.type !== preview.rootType)
    throw new AppError(
      'PREVIEW_STALE',
      'The selected design no longer exists. Refresh the preview before applying.',
    );
  if (containingPageId(root) !== preview.pageId)
    throw new AppError(
      'PREVIEW_STALE',
      'The selected design moved to another page. Refresh the preview before applying.',
    );
  const current = discover(root as SceneNode);
  if (!sameTargetSnapshot(preview.targets, current))
    throw new AppError(
      'PREVIEW_STALE',
      'The design changed after this pairing was built. Refresh the preview before applying.',
    );
}
