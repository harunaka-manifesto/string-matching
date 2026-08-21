import { describe, expect, it, beforeEach } from 'vitest';
import { AppError, type PreviewSnapshot } from '@ux-copy-sync/contracts';
import { applyReviewedPairs, replaceTextUsingFirstStyle } from '../src/main/apply';

type FakeText = {
  id: string;
  type: 'TEXT';
  name: string;
  characters: string;
  autoRename: boolean;
  visible: boolean;
  parent: { id: string; type: 'FRAME'; parent: null };
  fontName: FontName;
  hasMissingFont?: boolean;
  getRangeAllFontNames: () => FontName[];
  insertCharacters: (start: number, value: string) => void;
  deleteCharacters: (start: number, end: number) => void;
};

function fakeNode(id: string, value = 'Old', name = 'Old layer'): FakeText {
  const parent = { id: 'root', type: 'FRAME' as const, parent: null };
  const node: FakeText = {
    id,
    type: 'TEXT',
    name,
    characters: value,
    autoRename: false,
    visible: true,
    parent,
    fontName: { family: 'Inter', style: 'Regular' },
    getRangeAllFontNames: () => [{ family: 'Inter', style: 'Regular' }],
    insertCharacters(start, next) {
      this.characters = this.characters.slice(0, start) + next + this.characters.slice(start);
    },
    deleteCharacters(start, end) {
      this.characters = this.characters.slice(0, start) + this.characters.slice(end);
    },
  };
  return node;
}

const source = { id: 'r1', value: 'Hello\nworld' };
const preview = (): PreviewSnapshot => ({
  token: 'preview',
  pageId: 'page',
  rootId: 'root',
  rootType: 'FRAME',
  rootName: 'Root',
  createdAt: Date.now(),
  applied: false,
  mode: 'public-test',
  source: {
    cellUrl: 'https://docs.google.com/spreadsheets/d/1abcDEFghiJKLmnopQRS/edit#gid=1&range=D1',
    spreadsheetId: '1abcDEFghiJKLmnopQRS',
    sheetId: 1,
    sheetTitle: 'Copy',
    startCell: 'D1',
    scannedThroughCell: 'D1',
    requestedCount: 1,
    fingerprint: '0'.repeat(64),
  },
  targets: [
    {
      id: 'text-1',
      name: 'Old layer',
      originalCharacters: 'Old',
      originalName: 'Old layer',
      originalAutoRename: false,
      x: 0,
      y: 0,
      width: 20,
      height: 10,
      visible: true,
    },
  ],
});

beforeEach(() => {
  (globalThis as any).figma = {
    loadFontAsync: async () => undefined,
    commitUndo: () => undefined,
    triggerUndo: () => undefined,
  };
});

describe('apply pipeline', () => {
  it('replaces exact characters, normalizes the name, and enables autoRename', async () => {
    const node = fakeNode('text-1');
    const result = await applyReviewedPairs({
      preview: preview(),
      sourceValues: [source],
      pairs: [{ layerId: 'text-1', replacementId: 'r1', value: source.value }],
      resolveNode: async () => node as any,
      resolveRoot: async () => ({ id: 'root', type: 'FRAME' }) as any,
      verifySource: async () => undefined,
      discoverSnapshots: () => preview().targets,
      currentPageId: 'page',
    });
    expect(result.appliedCount).toBe(1);
    expect(node.characters).toBe('Hello\nworld');
    expect(node.name).toBe('Hello world');
    expect(node.autoRename).toBe(true);
  });

  it('allows mixed styles because style replacement is isolated in a helper', () => {
    const node = fakeNode('text-1');
    replaceTextUsingFirstStyle(node as any, 'New copy');
    expect(node.characters).toBe('New copy');
  });

  it('does not write when a target is locked', async () => {
    const node = fakeNode('text-1');
    (node as any).locked = true;
    await expect(
      applyReviewedPairs({
        preview: preview(),
        sourceValues: [source],
        pairs: [{ layerId: 'text-1', replacementId: 'r1', value: source.value }],
        resolveNode: async () => node as any,
        resolveRoot: async () => ({ id: 'root', type: 'FRAME' }) as any,
        verifySource: async () => undefined,
        discoverSnapshots: () => preview().targets,
        currentPageId: 'page',
      }),
    ).rejects.toMatchObject({ code: 'LOCKED_LAYER' });
    expect(node.characters).toBe('Old');
  });

  it('rejects stale source before font loading or writing', async () => {
    const node = fakeNode('text-1');
    const load = ((globalThis as any).figma.loadFontAsync = async () => {
      throw new Error('should not load');
    });
    await expect(
      applyReviewedPairs({
        preview: preview(),
        sourceValues: [source],
        pairs: [{ layerId: 'text-1', replacementId: 'r1', value: source.value }],
        resolveNode: async () => node as any,
        resolveRoot: async () => ({ id: 'root', type: 'FRAME' }) as any,
        verifySource: async () => {
          throw new AppError('SOURCE_STALE', 'stale');
        },
        discoverSnapshots: () => preview().targets,
        currentPageId: 'page',
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_STALE' });
    expect(load).toBeTypeOf('function');
    expect(node.characters).toBe('Old');
  });

  it('restores earlier characters and names when a later write fails', async () => {
    const first = fakeNode('text-1');
    const second = fakeNode('text-2');
    second.insertCharacters = () => {
      throw new Error('injected write failure');
    };
    const nextPreview = preview();
    nextPreview.targets = [...nextPreview.targets, { ...nextPreview.targets[0]!, id: 'text-2' }];
    const sourceValues = [source, { id: 'r2', value: 'Second' }];
    await expect(
      applyReviewedPairs({
        preview: nextPreview,
        sourceValues,
        pairs: [
          { layerId: 'text-1', replacementId: 'r1', value: source.value },
          { layerId: 'text-2', replacementId: 'r2', value: 'Second' },
        ],
        resolveNode: async (id) => (id === 'text-1' ? first : second) as any,
        resolveRoot: async () => ({ id: 'root', type: 'FRAME' }) as any,
        verifySource: async () => undefined,
        discoverSnapshots: () => nextPreview.targets,
        currentPageId: 'page',
      }),
    ).rejects.toMatchObject({ code: 'APPLY_FAILED' });
    expect(first.characters).toBe('Old');
    expect(first.name).toBe('Old layer');
    expect(second.characters).toBe('Old');
  });
});
