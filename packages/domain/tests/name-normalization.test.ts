import { describe, expect, it } from 'vitest';
import { normalizeLayerName } from '../src/name-normalization';

describe('normalizeLayerName', () => {
  it.each([
    ['Hello', 'Hello'],
    ['  Hello  ', 'Hello'],
    ['Hello\nWorld', 'Hello World'],
    ['Hello\r\nWorld', 'Hello World'],
    ['Hello    World', 'Hello World'],
  ])('normalizes %j', (input, expected) => expect(normalizeLayerName(input)).toBe(expected));
});
