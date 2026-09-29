import { describe, expect, it } from 'vitest';
import { contextTokens, searchVariables, type SearchableVariable } from '../src/variable-search';

const v = (
  key: string,
  name: string,
  en: string,
  id = '',
  collection = 'Legacy 1',
  order = 0,
): SearchableVariable => ({ key, name, collection, order, en, id, description: '' });

const variables = [
  v('a', 'home/gopay_home_header_title', 'Welcome back', 'Selamat datang', 'Legacy 4', 2),
  v('b', 'home/gopay_home_header_subtitle', 'Pay faster', 'Bayar lebih cepat', 'Legacy 4', 1),
  v('c', 'transfer/gopay_transfer_confirm_cta', 'Transfer now', 'Transfer sekarang', 'Legacy 2', 0),
  v('d', 'shared/gopay_shared_cta_continue', 'Continue', 'Lanjut', 'Legacy 1', 0),
];

const flat = (groups: ReturnType<typeof searchVariables>) =>
  groups.flatMap((group) => group.items.map((item) => item.key));

describe('searchVariables', () => {
  it('matches names, EN values and ID values case-insensitively', () => {
    expect(flat(searchVariables(variables, 'WELCOME'))).toEqual(['a']);
    expect(flat(searchVariables(variables, 'lanjut'))).toEqual(['d']);
    expect(flat(searchVariables(variables, 'header_sub'))).toEqual(['b']);
  });

  it('requires every word to match somewhere', () => {
    expect(flat(searchVariables(variables, 'transfer sekarang'))).toEqual(['c']);
    expect(flat(searchVariables(variables, 'transfer welcome'))).toEqual([]);
  });

  it('matches the group path', () => {
    expect(flat(searchVariables(variables, 'home/'))).toEqual(['b', 'a']);
  });

  it('ignores accents', () => {
    expect(flat(searchVariables([v('x', 'a/b', 'Café')], 'cafe'))).toEqual(['x']);
  });

  it('groups by collection › group and keeps library order inside a group', () => {
    const groups = searchVariables(variables, 'gopay', {
      collectionOrder: ['Legacy 1', 'Legacy 2', 'Legacy 4'],
    });
    expect(groups.map((group) => `${group.collection}›${group.group}`)).toEqual([
      'Legacy 1›shared',
      'Legacy 2›transfer',
      'Legacy 4›home',
    ]);
    expect(groups[2]!.items.map((item) => item.key)).toEqual(['b', 'a']);
  });

  it('floats groups matching the frame context', () => {
    const groups = searchVariables(variables, 'gopay', {
      collectionOrder: ['Legacy 1', 'Legacy 2', 'Legacy 4'],
      context: ['Transfer - Confirm'],
    });
    expect(groups[0]!.group).toBe('transfer');
  });
});

describe('contextTokens', () => {
  it('splits names and drops short or numeric tokens', () => {
    expect([...contextTokens(['Investment Landing_Page 02', 'Frame 12'])]).toEqual([
      'investment',
      'landing',
      'page',
      'frame',
    ]);
  });
});
