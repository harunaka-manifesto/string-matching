import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  sha256,
  bilingualErrors,
  libraryDiff,
  initialRow,
  canonical,
  canvasLocale,
} from './registry';
import type { CopyRecord, LocalCopy } from '@string-binder/contracts';
const r: CopyRecord = {
  copyId: 'cp_01K0000000E00R000000000001',
  platformKey: 'gopay_shared_confirm_cta',
  revision: 1,
  en: 'Confirm',
  id: 'Konfirmasi',
  product: 'shared',
  context: { feature: '', screen: 'confirm', context: '', role: 'cta', note: '' },
  status: 'active',
  aliases: [],
};
const l: LocalCopy = {
  copyId: r.copyId,
  variableId: 'v',
  variableKey: 'vk',
  name: r.platformKey,
  collection: 'Shared',
  en: r.en,
  id: r.id,
  baseline: r,
  context: r.context,
};
describe('revision and bilingual domain rules', () => {
  it.each(['', 'abc', '  世界\n🚀 ', '\ud800', 'a'.repeat(10000)])(
    'portable SHA-256 matches native SHA for %j',
    (text) => expect(sha256(text)).toBe(createHash('sha256').update(text).digest('hex')),
  );
  it('uses deterministic canonical request hashing', () =>
    expect(canonical({ z: 1, b: { d: 2, a: 3 } })).toBe(canonical({ b: { a: 3, d: 2 }, z: 1 })));
  it('validates placeholders while preserving original copy', () => {
    expect(bilingualErrors(' Hello {first_name}\n', ' Halo {first_name}\n')).toEqual([]);
    expect(bilingualErrors('Pay {amount}', 'Bayar {price}')).toContain(
      'EN and ID must use the same placeholders',
    );
    expect(bilingualErrors('{amount}', '{amount}')).toHaveLength(2);
    expect(bilingualErrors('Hello', ' ')).toContain('ID is required');
  });
  it('classifies every three-way sync state', () => {
    expect(libraryDiff(l, r)).toBe('current');
    expect(libraryDiff({ ...l, en: 'Local' }, r)).toBe('local');
    const newer = { ...r, revision: 2, en: 'Remote' };
    expect(libraryDiff(l, newer)).toBe('remote');
    expect(libraryDiff({ ...l, en: 'Local' }, newer)).toBe('conflict');
    expect(libraryDiff({ ...l, en: 'Remote' }, newer)).toBe('equal');
    expect(libraryDiff({ ...l, baseline: null }, r)).toBe('unbased');
    expect(libraryDiff(undefined, r)).toBe('missing');
    expect(libraryDiff({ ...l, copyId: null }, undefined)).toBe('new');
    expect(libraryDiff({ ...l, error: 'Missing mode' }, r)).toBe('invalid');
    expect(libraryDiff({ ...l, name: 'renamed' }, r)).toBe('invalid');
  });
  it('new rows keep canvas text in the selected locale and default to keep', () => {
    const row = initialRow(
      {
        id: 'n',
        name: 'Title',
        characters: ' Hello\n',
        inInstance: false,
        boundKey: null,
        boundName: null,
        stored: null,
        autoSkipReason: null,
      },
      'en',
      'shared',
      'frame',
      'cp_new',
    );
    expect(row.action).toBe('keep');
    expect(row.en).toBe(' Hello\n');
    expect(row.id).toBe('');
  });
});

it('corrects the canvas locale without discarding a written translation', () => {
  const row = initialRow(
    {
      id: 'n',
      name: 'Title',
      characters: 'Canvas',
      inInstance: false,
      boundKey: null,
      boundName: null,
      stored: null,
      autoSkipReason: null,
    },
    'id',
    'shared',
    'frame',
    'cp_new',
  );
  const moved = canvasLocale(row, 'en', 'Canvas');
  expect(moved.en).toBe('Canvas');
  expect(moved.id).toBe('');
  const translated = canvasLocale({ ...row, en: 'Written translation' }, 'en', 'Canvas');
  expect(translated.en).toBe('Written translation');
  expect(translated.id).toBe('Canvas');
});
