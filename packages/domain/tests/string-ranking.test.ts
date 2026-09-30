import { describe, expect, it } from 'vitest';
import { buildSequenceSource, filterSequenceSource } from '../src/sequence-prefill';
import {
  guessProduct,
  normalizedFields,
  productLabel,
  productOf,
  productVocabulary,
  rankStrings,
} from '../src/string-ranking';

type S = { key: string; name: string; order: number; en: string; id: string; path: string };
const s = (key: string, name: string, en: string, id = '', order = 0, path = ''): S => ({
  key,
  name,
  order,
  en,
  id,
  path,
});
const strings = [
  s('inv-ok', 'investment/gopay_investment_onboarding_cta', 'Got it', 'Oke', 5),
  s(
    'inv-long',
    'investment/gopay_investment_tnc_text',
    'Got it, I understand the risk',
    'Paham',
    1,
  ),
  s('tr-ok', 'transfer/gopay_transfer_success_cta', 'Got it', 'Oke', 0),
  s('sh-ok', 'shared/gopay_shared_cta_gotit', 'Got it', 'Oke', 9),
  s('inv-title', 'investment/gopay_investment_gotit_title', 'Start investing', 'Mulai', 2),
];
const keys = (items: readonly S[]) => items.map((item) => item.key);
const rank = (query: string, scope: string | null, used?: Set<string>) =>
  rankStrings(strings, query, { fields: normalizedFields, scope, used });

describe('productOf / productLabel', () => {
  it('reads the first group', () => {
    expect(productOf('split-bill/gopay_x')).toBe('split-bill');
    expect(productOf('no_group')).toBe('');
    expect(productLabel('split-bill')).toBe('Split bill');
    expect(productLabel('insurance-health-insurance-pre-ut')).toBe(
      'Insurance health insurance pre UT',
    );
  });
});

describe('rankStrings', () => {
  it('puts the scoped product and shared strings first, other products after', () => {
    const result = rank('got it', 'investment');
    expect(keys(result.inScope)).toEqual(['inv-ok', 'sh-ok', 'inv-long', 'inv-title']);
    expect(keys(result.other)).toEqual(['tr-ok']);
    expect(result.total).toBe(5);
  });

  it('ranks exact value matches above longer values and key-name matches', () => {
    const result = rank('got it', null);
    expect(keys(result.inScope).slice(0, 3).sort()).toEqual(['inv-ok', 'sh-ok', 'tr-ok']);
    expect(keys(result.inScope).at(-1)).toBe('inv-title');
    expect(result.other).toEqual([]);
  });

  it('boosts strings already used on the page', () => {
    expect(keys(rank('got it', null, new Set(['tr-ok'])).inScope)[0]).toBe('tr-ok');
  });

  it('requires every word to match some field', () => {
    expect(rank('got banana', null).total).toBe(0);
    expect(keys(rank('oke', 'transfer').inScope)).toEqual(['tr-ok', 'sh-ok']);
  });

  it('returns nothing for an empty query', () => {
    expect(rank('  ', null).total).toBe(0);
  });
});

describe('guessProduct', () => {
  const vocabulary = productVocabulary([
    { name: 'investment/a', section: 'Mutual Fund Asset Details Screen' },
    { name: 'investment/b', section: 'Investment Leaderboard' },
    { name: 'transfer/a', section: 'Transfer - Cross Border Remittance' },
    { name: 'savings/a', section: 'Term Deposit' },
    { name: 'shared/a', section: 'Shared' },
  ]);

  it('trusts strings already bound in the frame', () => {
    expect(
      guessProduct({
        boundNames: ['shared/x', 'transfer/y', 'transfer/z', 'savings/q'],
        contextNames: ['Mutual fund'],
        vocabulary,
      }),
    ).toBe('transfer');
  });

  it('matches frame and page names against product vocabulary', () => {
    expect(
      guessProduct({ boundNames: [], contextNames: ['Mutual fund – buy', 'Flows'], vocabulary }),
    ).toBe('investment');
    expect(
      guessProduct({ boundNames: [], contextNames: ['Term deposit / detail'], vocabulary }),
    ).toBe('savings');
  });

  it('gives up when names say nothing', () => {
    expect(guessProduct({ boundNames: [], contextNames: ['Frame 123'], vocabulary })).toBeNull();
  });
});

describe('filterSequenceSource', () => {
  it('drops other products and reindexes', () => {
    const source = buildSequenceSource({
      orderedNames: { T: ['investment/a', 'transfer/b', 'shared/c', 'investment/d'] },
      variables: ['investment/a', 'transfer/b', 'shared/c', 'investment/d'].map((name, order) => ({
        key: name,
        name,
        collection: 'L',
        order,
      })),
    });
    const scoped = filterSequenceSource(source, (key) => productOf(key) !== 'transfer');
    expect(scoped.sequences.get('sheet:T')).toEqual(['investment/a', 'shared/c', 'investment/d']);
    expect(scoped.positions.get('investment/d')).toEqual([{ sequence: 'sheet:T', index: 2 }]);
    expect(scoped.positions.has('transfer/b')).toBe(false);
  });
});
