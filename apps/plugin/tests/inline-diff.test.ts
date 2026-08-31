import { describe, expect, it } from 'vitest';
import { diffText } from '../src/ui/components/InlineDiff';

function changedValues(parts: ReturnType<typeof diffText>['current']) {
  return parts
    .filter((part) => part.changed)
    .map((part) => part.value)
    .join('');
}

describe('inline copy diff', () => {
  it('renders identical values plainly', () => {
    expect(diffText('Same copy', 'Same copy')).toEqual({
      current: [{ value: 'Same copy', changed: false }],
      next: [{ value: 'Same copy', changed: false }],
    });
  });

  it('marks punctuation-only changes', () => {
    const result = diffText('Save.', 'Save!');
    expect(changedValues(result.current)).toBe('.');
    expect(changedValues(result.next)).toBe('!');
  });

  it('marks capitalization and whitespace changes without normalizing them', () => {
    const result = diffText('Hello world', 'hello  world');
    expect(changedValues(result.current)).toBe('Hello ');
    expect(changedValues(result.next)).toBe('hello  ');
  });

  it('preserves Unicode and multiline copy', () => {
    const result = diffText('Café\n住所', 'Café\n住所を入力');
    expect(result.current.map((part) => part.value).join('')).toBe('Café\n住所');
    expect(result.next.map((part) => part.value).join('')).toBe('Café\n住所を入力');
    expect(changedValues(result.next)).toBe('を入力');
  });

  it('marks a whole replacement on both sides', () => {
    const result = diffText('Alpha', 'Bravo');
    expect(changedValues(result.current)).toBe('Alpha');
    expect(changedValues(result.next)).toBe('Bravo');
  });
});
