import { describe, expect, it } from 'vitest';
import { collectVisuallyPresentText, isVisuallyPresentText } from '../src/visibility';

const bounds = { x: 0, y: 0, width: 100, height: 100 };
const root = {
  id: 'root',
  type: 'FRAME',
  visible: true,
  opacity: 1,
  absoluteBoundingBox: bounds,
  clipsContent: true,
  children: [] as any[],
};
const text = (overrides: Record<string, unknown> = {}) => ({
  id: 'text',
  type: 'TEXT',
  characters: 'Copy',
  visible: true,
  opacity: 1,
  absoluteBoundingBox: { x: 10, y: 10, width: 20, height: 10 },
  parent: root,
  fills: [{ visible: true, opacity: 1 }],
  ...overrides,
});

describe('visual presence', () => {
  it('includes a visible text node and excludes whitespace', () => {
    expect(isVisuallyPresentText(text(), root)).toBe(true);
    expect(isVisuallyPresentText(text({ characters: '  ' }), root)).toBe(false);
  });

  it('rejects hidden, transparent, outside, and fully clipped text', () => {
    expect(isVisuallyPresentText(text({ visible: false }), root)).toBe(false);
    expect(isVisuallyPresentText(text({ opacity: 0 }), root)).toBe(false);
    expect(
      isVisuallyPresentText(
        text({ absoluteBoundingBox: { x: 200, y: 200, width: 10, height: 10 } }),
        root,
      ),
    ).toBe(false);
    expect(
      isVisuallyPresentText(
        text({ absoluteBoundingBox: { x: 99, y: 99, width: 10, height: 10 } }),
        root,
      ),
    ).toBe(true);
  });

  it('includes partially visible text and rejects a hidden ancestor', () => {
    const hiddenAncestor = { id: 'hidden', type: 'FRAME', visible: false, parent: root };
    expect(isVisuallyPresentText(text({ parent: hiddenAncestor }), root)).toBe(false);
    expect(
      isVisuallyPresentText(
        text({ absoluteBoundingBox: { x: -5, y: 10, width: 20, height: 10 } }),
        root,
      ),
    ).toBe(true);
  });

  it('walks only descendants of the selected root', () => {
    root.children = [
      text({ id: 'one' }),
      { id: 'shape', type: 'RECTANGLE', children: [text({ id: 'two' })], parent: root },
    ];
    expect(collectVisuallyPresentText(root).map((node) => node.id)).toEqual(['one', 'two']);
  });
});
