import { describe, expect, it } from 'vitest';
import type { PreviewSnapshot } from '@ux-copy-sync/contracts';
import { validateFigmaPreview } from '../src/main/snapshots';

const preview: PreviewSnapshot = {
  token: 'preview',
  pageId: 'page-1',
  rootId: 'root',
  rootType: 'FRAME',
  rootName: 'Root',
  createdAt: Date.now(),
  applied: false,
  mode: 'public-test',
  targets: [],
};

describe('preview freshness', () => {
  it('rejects a root that no longer belongs to the preview page', async () => {
    const root = {
      id: 'root',
      type: 'FRAME',
      parent: { id: 'page-2', type: 'PAGE', parent: null },
    } as any;
    await expect(
      validateFigmaPreview(
        preview,
        async () => root,
        () => [],
        'page-1',
      ),
    ).rejects.toMatchObject({ code: 'PREVIEW_STALE' });
  });
});
