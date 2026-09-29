import { describe, expect, it } from 'vitest';
import {
  matchDuplicateLayers,
  normalizeDuplicateName,
  scoreCandidate,
  type TextNodeSnapshot,
} from '../src/layer-similarity';

const node = (patch: Partial<TextNodeSnapshot> & { id: string }): TextNodeSnapshot => ({
  name: 'Title',
  characters: 'Lorem ipsum',
  frameId: 'f1',
  frameName: 'Home',
  frameWidth: 360,
  path: ['Header', 'Content'],
  textStyleId: 'S:title',
  offsetX: 100,
  offsetY: 50,
  ...patch,
});

describe('normalizeDuplicateName', () => {
  it('drops Figma duplicate suffixes', () => {
    expect(normalizeDuplicateName('Header Copy 2')).toBe('header');
    expect(normalizeDuplicateName('Card_3')).toBe('card');
  });
});

describe('scoreCandidate', () => {
  it('scores a duplicated layer as a match', () => {
    const source = node({ id: 's' });
    const copy = node({ id: 'c', frameId: 'f2', frameName: 'Home Copy', offsetY: 58 });
    expect(scoreCandidate(source, copy).score).toBeGreaterThanOrEqual(0.75);
  });

  it('keeps unrelated layers below the threshold', () => {
    const source = node({ id: 's' });
    const other = node({
      id: 'o',
      frameId: 'f2',
      frameName: 'Settings',
      name: 'Caption',
      characters: 'Something else',
      path: ['Footer'],
      textStyleId: 'S:caption',
      offsetY: 600,
    });
    expect(scoreCandidate(source, other).score).toBeLessThan(0.75);
  });

  it('treats the same slot of the same component as the same path', () => {
    const source = node({ id: 's', path: ['List', 'Item A'], instanceKey: 'cmp/title' });
    const copy = node({ id: 'c', path: ['Stack', 'Row'], instanceKey: 'cmp/title', frameId: 'f2' });
    expect(scoreCandidate(source, copy).reasons).toContain('Same layer path');
  });
});

describe('matchDuplicateLayers', () => {
  it('pairs layers one-to-one per frame and skips the sources themselves', () => {
    const sources = [
      node({ id: 's-title' }),
      node({ id: 's-body', name: 'Body', textStyleId: 'S:body', offsetY: 120 }),
    ];
    const candidates = [
      ...sources,
      node({ id: 'c-title', frameId: 'f2', frameName: 'Home Copy 2' }),
      node({
        id: 'c-body',
        frameId: 'f2',
        frameName: 'Home Copy 2',
        name: 'Body',
        textStyleId: 'S:body',
        offsetY: 124,
      }),
    ];
    const matches = matchDuplicateLayers({ sources, candidates });
    expect(matches.map((match) => [match.sourceId, match.nodeId]).sort()).toEqual([
      ['s-body', 'c-body'],
      ['s-title', 'c-title'],
    ]);
  });
});
