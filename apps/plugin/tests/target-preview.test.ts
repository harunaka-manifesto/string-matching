import { describe, expect, it } from 'vitest';
import { TargetPreviewManager, type TargetPreviewAdapter } from '../src/main/target-preview';

type FakeNode = {
  id: string;
  type: string;
};

const frame: FakeNode = { id: 'frame', type: 'FRAME' };
const alternateFrame: FakeNode = { id: 'alternate-frame', type: 'FRAME' };
const textA: FakeNode = { id: 'text-a', type: 'TEXT' };
const textB: FakeNode = { id: 'text-b', type: 'TEXT' };
const external: FakeNode = { id: 'external', type: 'TEXT' };

function createHarness(
  options: {
    initialSelection?: FakeNode[];
    nodes?: FakeNode[];
    resolveNode?: (id: string) => Promise<FakeNode | null>;
    resolveRoot?: (id: string) => Promise<FakeNode | null>;
  } = {},
) {
  let selection = [...(options.initialSelection ?? [frame])];
  const nodes = new Map(
    (options.nodes ?? [frame, alternateFrame, textA, textB, external]).map((node) => [
      node.id,
      node,
    ]),
  );
  const selections: string[][] = [];
  const adapter: TargetPreviewAdapter<FakeNode> = {
    getSelection: () => selection,
    setSelection: (next) => {
      selection = [...next];
      selections.push(selection.map((node) => node.id));
    },
    resolveNode: options.resolveNode ?? ((id) => Promise.resolve(nodes.get(id) ?? null)),
    resolveRoot: options.resolveRoot ?? ((id) => Promise.resolve(nodes.get(id) ?? null)),
  };
  const manager = new TargetPreviewManager(adapter);
  return {
    manager,
    selections,
    selectionIds: () => selection.map((node) => node.id),
    setExternalSelection: (next: FakeNode[]) => {
      selection = [...next];
    },
  };
}

function previewRequest(layerId: string, previewToken = 'preview') {
  return {
    previewToken,
    layerId,
    targetIds: ['text-a', 'text-b'],
    rootId: 'frame',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('TargetPreviewManager', () => {
  it('temporarily selects a text target and restores the original selection', async () => {
    const harness = createHarness({ initialSelection: [frame] });

    await expect(harness.manager.preview(previewRequest('text-a'))).resolves.toBe(true);
    expect(harness.selectionIds()).toEqual(['text-a']);
    expect(harness.selections).toEqual([['text-a']]);
    expect(harness.manager.activeLayerId).toBe('text-a');
    expect(harness.manager.consumeSelectionChange(['text-a'])).toBe(true);

    await expect(harness.manager.clear()).resolves.toBe(true);
    expect(harness.selectionIds()).toEqual(['frame']);
    expect(harness.manager.consumeSelectionChange(['frame'])).toBe(true);
    expect(harness.manager.hasSession).toBe(false);
  });

  it('preserves the original selection across target changes', async () => {
    const harness = createHarness({ initialSelection: [frame, alternateFrame] });

    await harness.manager.preview(previewRequest('text-a'));
    harness.manager.consumeSelectionChange(['text-a']);
    await harness.manager.preview(previewRequest('text-b'));
    harness.manager.consumeSelectionChange(['text-b']);
    await harness.manager.clear();

    expect(harness.selectionIds()).toEqual(['frame', 'alternate-frame']);
  });

  it('drops missing original nodes and falls back to the preview root', async () => {
    const harness = createHarness({
      initialSelection: [frame],
      nodes: [alternateFrame, textA, textB],
      resolveRoot: (id) => (id === 'frame' ? Promise.resolve(frame) : Promise.resolve(null)),
    });

    await harness.manager.preview(previewRequest('text-a'));
    await harness.manager.clear();

    expect(harness.selectionIds()).toEqual(['frame']);
    expect(harness.selections.at(-1)).toEqual(['frame']);
  });

  it('restores only surviving original nodes when part of the selection is gone', async () => {
    const harness = createHarness({
      initialSelection: [frame, alternateFrame],
      nodes: [frame, textA, textB],
    });

    await harness.manager.preview(previewRequest('text-a'));
    await harness.manager.clear();

    expect(harness.selectionIds()).toEqual(['frame']);
  });

  it('rejects skipped IDs and non-text nodes without selecting them', async () => {
    const harness = createHarness({ nodes: [frame, alternateFrame, textA, textB] });

    await expect(
      harness.manager.preview({
        ...previewRequest('skipped'),
        targetIds: ['text-a', 'text-b'],
      }),
    ).resolves.toBe(false);
    expect(harness.selectionIds()).toEqual(['frame']);

    await expect(
      harness.manager.preview({
        ...previewRequest('alternate-frame'),
        targetIds: ['alternate-frame'],
      }),
    ).resolves.toBe(false);
    expect(harness.selectionIds()).toEqual(['frame']);
    await harness.manager.clear({ restore: false });
  });

  it('ignores an older async target when a newer target wins the race', async () => {
    const first = deferred<FakeNode | null>();
    const second = deferred<FakeNode | null>();
    const harness = createHarness({
      resolveNode: (id) => (id === 'text-a' ? first.promise : second.promise),
    });

    const firstPreview = harness.manager.preview(previewRequest('text-a'));
    const secondPreview = harness.manager.preview(previewRequest('text-b'));
    second.resolve(textB);
    await expect(secondPreview).resolves.toBe(true);
    expect(harness.selectionIds()).toEqual(['text-b']);
    first.resolve(textA);
    await expect(firstPreview).resolves.toBe(false);
    expect(harness.selectionIds()).toEqual(['text-b']);
  });

  it('does not let a late target win after clear starts', async () => {
    const target = deferred<FakeNode | null>();
    const harness = createHarness({
      resolveNode: (id) => (id === 'text-a' ? target.promise : Promise.resolve(frame)),
    });

    const pendingPreview = harness.manager.preview(previewRequest('text-a'));
    const pendingClear = harness.manager.clear();
    await pendingClear;
    target.resolve(textA);

    await expect(pendingPreview).resolves.toBe(false);
    expect(harness.selectionIds()).toEqual(['frame']);
    expect(harness.manager.consumeSelectionChange(['frame'])).toBe(true);
    expect(harness.manager.hasSession).toBe(false);
  });

  it('cancels without restoring when the user takes control of selection', async () => {
    const harness = createHarness();

    await harness.manager.preview(previewRequest('text-a'));
    harness.manager.consumeSelectionChange(['text-a']);
    harness.setExternalSelection([external]);
    harness.manager.cancelForExternalSelection();

    expect(harness.manager.hasSession).toBe(false);
    await expect(harness.manager.clear()).resolves.toBe(false);
    expect(harness.selectionIds()).toEqual(['external']);
  });

  it('accepts only selection events generated by the manager', async () => {
    const harness = createHarness();

    await harness.manager.preview(previewRequest('text-a'));
    expect(harness.manager.consumeSelectionChange(['external'])).toBe(false);
    expect(harness.manager.hasSession).toBe(true);
    harness.manager.cancelForExternalSelection();
    expect(harness.manager.hasSession).toBe(false);
  });
});
