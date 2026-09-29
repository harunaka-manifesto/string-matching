import { describe, expect, it } from 'vitest';
import { nonCopyReason } from '../src/non-copy-heuristics';

const reason = (characters: string, layerName = 'Text', ancestorNames: string[] = []) =>
  nonCopyReason({ characters, layerName, ancestorNames });

describe('nonCopyReason', () => {
  it.each([
    ['Rp10.000', 'Number or amount'],
    ['Rp 1.250.000', 'Number or amount'],
    ['-Rp50.000', 'Number or amount'],
    ['12,5%', 'Number or amount'],
    ['3x', 'Number or amount'],
    ['2 jt', 'Number or amount'],
    ['9:41', 'Time'],
    ['14.30 WIB', 'Time'],
    ['12/08/2026', 'Date'],
    ['12 Agu 2026', 'Date'],
    ['Aug 12, 2026', 'Date'],
    ['12 Des 2026, 14:30', 'Date'],
    ['0812 3456 7890', 'Phone number'],
    ['+62 812-3456-7890', 'Phone number'],
    ['user@example.com', 'Email'],
    ['•••• 1234', 'Masked data'],
    ['A', 'Single character'],
  ])('skips %s', (text, expected) => {
    expect(reason(text)).toBe(expected);
  });

  it.each([
    'Lorem ipsum dolor sit amet',
    'Top up',
    'Bayar sekarang',
    'Pay Rp10.000 now',
    '2 steps left',
    'Mei',
  ])('keeps %s', (text) => {
    expect(reason(text)).toBeNull();
  });

  it('skips text inside system chrome', () => {
    expect(reason('Carrier', 'Text', ['Status Bar / iOS', 'Screen'])).toBe('System UI');
    expect(reason('return', 'Key', ['Keyboard'])).toBe('System UI');
  });

  it('skips layers named after dynamic data', () => {
    expect(reason('Budi Santoso', 'Name')).toBe('Dynamic data layer');
    expect(reason('Lorem ipsum', 'Saldo')).toBe('Dynamic data layer');
  });
});
