import { describe, expect, it } from 'vitest';
import { orderByVisualReading } from '../src/reading-order';

const item = (id: string, x: number, y: number) => ({ id, x, y, width: 10, height: 10 });

describe('orderByVisualReading', () => {
  it('orders vertical stacks then same-row items left to right', () => {
    expect(
      orderByVisualReading([item('b', 20, 100), item('a', 0, 0), item('c', 0, 100)]),
    ).toMatchObject([{ id: 'a' }, { id: 'c' }, { id: 'b' }]);
  });

  it('uses the stable id tie-breaker', () => {
    expect(
      orderByVisualReading([item('z', 10, 10), item('a', 10, 10)]).map((node) => node.id),
    ).toEqual(['a', 'z']);
  });

  it('treats three pixels as the same row', () => {
    expect(
      orderByVisualReading([item('right', 20, 3), item('left', 0, 0)]).map((node) => node.id),
    ).toEqual(['left', 'right']);
  });
});
