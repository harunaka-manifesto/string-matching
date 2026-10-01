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
  it('excludes other products even when their text is an exact match', () => {
    const result = rank('got it', 'investment');
    expect(keys(result.inScope)).toEqual(['sh-ok', 'inv-ok', 'inv-long']);
    expect(result.total).toBe(3);
  });

  it('ranks exact value matches above longer values and key-name matches', () => {
    const result = rank('got it', null);
    expect(keys(result.inScope).slice(0, 3).sort()).toEqual(['inv-ok', 'sh-ok', 'tr-ok']);
    expect(keys(result.inScope).at(-1)).toBe('inv-long');
  });

  it('boosts strings already used on the page', () => {
    expect(keys(rank('got it', null, new Set(['tr-ok'])).inScope)[0]).toBe('tr-ok');
  });

  it('requires every word to match some field', () => {
    expect(rank('got banana', null).total).toBe(0);
    expect(keys(rank('oke', 'transfer').inScope)).toEqual(['sh-ok', 'tr-ok']);
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

it('handles flat product collections and insurance partitions', () => {
  expect(productOf('gopay_transfer_cta', 'Transfer 2')).toBe('transfer');
  expect(productOf('insurance-health-insurance-pre-ut/gopay_health_title')).toBe('insurance');
  expect(
    rankStrings([s('foreign', 'transfer/key', 'Deposit')], 'Deposit', {
      fields: normalizedFields,
      scope: 'investment',
    }).total,
  ).toBe(0);
});

it('uses screen context and role before page usage while preserving exact-text priority', () => {
  const candidates = [
    s('used', 'investment/gopay_investment_other_title', 'Continue', 'Lanjut', 0, 'Leaderboard'),
    s('cta', 'investment/gopay_investment_buy_cta', 'Continue', 'Lanjutkan', 3, 'Mutual Fund Buy'),
    s(
      'long',
      'investment/gopay_investment_buy_title',
      'Continue investing today',
      'Mulai',
      1,
      'Mutual Fund Buy',
    ),
  ];
  const result = rankStrings(candidates, 'continue', {
    fields: normalizedFields,
    scope: 'investment',
    context: ['Mutual Fund Buy'],
    role: 'cta',
    used: new Set(['used']),
  });
  expect(keys(result.inScope)).toEqual(['cta', 'used', 'long']);
  expect(result.details.get('cta')?.reasons).toContain('Same role: CTA');
  expect(result.details.get('cta')?.reasons.some((reason) => reason.startsWith('Context:'))).toBe(
    true,
  );
});

it('searches legacy keys, immutable IDs and descriptions', () => {
  const item = {
    ...s('a', 'shared/gopay_shared_new_cta', 'Continue', 'Lanjut'),
    aliases: ['gopay_transfer_old_cta'],
    copyId: 'cp_01M3NX2028EDT9BABB16P3MVWM',
    description: 'Confirm recipient',
  };
  for (const query of ['gopay_transfer_old_cta', item.copyId, 'confirm recipient'])
    expect(rankStrings([item], query, { fields: normalizedFields, scope: 'transfer' }).total).toBe(
      1,
    );
  expect(
    rankStrings([item], item.copyId, { fields: normalizedFields, scope: 'transfer' }).details.get(
      'a',
    )?.reasons[0],
  ).toBe('Exact key or ID');
});

it('tolerates one typo but does not turn a missing word into unrelated results', () => {
  const candidates = [s('a', 'savings/gopay_savings_cta', 'Deposit funds', 'Setor dana')];
  expect(
    rankStrings(candidates, 'deopsit funds', { fields: normalizedFields, scope: 'savings' }).total,
  ).toBe(1);
  expect(
    rankStrings(candidates, 'deopsit fnuds', { fields: normalizedFields, scope: 'savings' }).total,
  ).toBe(0);
  expect(
    rankStrings(candidates, 'deposit banana', { fields: normalizedFields, scope: 'savings' }).total,
  ).toBe(0);
});

it('collapses exact bilingual copies into a shared result and preserves translation variants', () => {
  const candidates = [...strings, s('variant', 'investment/variant', 'Got it', 'Oke, paham')];
  const result = rankStrings(candidates, 'Got it', {
    fields: normalizedFields,
    scope: 'investment',
    identity: (item) => JSON.stringify([item.en, item.id]),
  });
  expect(keys(result.inScope)).toEqual(['sh-ok', 'variant', 'inv-long']);
  expect(result.details.get('sh-ok')?.duplicates).toBe(2);
  expect(keys(result.inScope)).not.toContain('tr-ok');
});

it('ranks a spelling correction in copy above the same correction in unrelated metadata', () => {
  const items = [
    s('context-only', 'shared/continue_cta', 'Continue', 'Lanjut', 0, 'Deposit confirmation'),
    s('copy', 'savings/deposit_label', 'Deposit', 'Deposito', 2, 'Savings home'),
  ];
  const result = rankStrings(items, 'deopsit', {
    fields: normalizedFields,
    scope: 'savings',
    context: ['Deposit confirmation'],
  });
  expect(keys(result.inScope)[0]).toBe('copy');
});

it('prefers concise corrected copy over a long disclaimer mentioning the keyword', () => {
  const items = [
    s(
      'long',
      'savings/legal_text',
      'Licensed by authorities and covered under the deposit insurance program',
      'Legal',
      0,
      'Deposit confirmation',
    ),
    s('short', 'savings/deposit_cta', 'Top up Deposit', 'Setor', 3, 'Savings home'),
    s('exact', 'savings/deposit_label', 'Deposit', 'Deposito', 5, 'Savings home'),
  ];
  const result = rankStrings(items, 'deopsit', {
    fields: normalizedFields,
    scope: 'savings',
    context: ['Deposit confirmation'],
  });
  expect(keys(result.inScope)).toEqual(['exact', 'short', 'long']);
});
