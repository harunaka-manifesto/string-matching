import { expect, it } from 'vitest';
import { createCopyId, isCopyId, copyKeyStem, nextCopyKey } from '../src/copy-identity';

it('keeps identity deterministic on retries and reserves every historical key', () => {
  const bytes = new Uint8Array(10);
  const id = createCopyId(0, bytes);
  expect(id).toBe('cp_0000000000E008000000000000');
  expect(createCopyId(0, bytes)).toBe(id);
  expect(isCopyId(id)).toBe(true);
  bytes[9] = 1;
  expect(createCopyId(0, bytes)).not.toBe(id);
  expect(createCopyId(1, bytes)).not.toBe(createCopyId(0, bytes));
  expect(isCopyId('cp_00000000000000000000000000')).toBe(false);
  expect(isCopyId('cp_0000000000E000000000000000')).toBe(false);
  expect(isCopyId(`${id}x`)).toBe(false);
  expect(() => createCopyId(-1, bytes)).toThrow();
  expect(() => createCopyId(2 ** 48, bytes)).toThrow();
  expect(() => createCopyId(0, new Uint8Array(9))).toThrow();
  const stem = copyKeyStem({
    product: 'split-bill',
    feature: 'Pay & split',
    screen: 'Confirm',
    context: 'Main',
    role: 'cta',
    qualifier: 'primary',
  });
  expect(stem).toBe('gopay_splitbill_payandsplit_confirm_cta_primary');
  // Include an active key, a historical alias and a tombstone. None can be reissued.
  const reservations = new Set([stem, `${stem}_2`, `${stem}_3`]);
  expect(nextCopyKey(stem, reservations)).toBe(`${stem}_4`);
  reservations.add(`${stem}_4`);
  expect(nextCopyKey(stem, reservations)).toBe(`${stem}_5`);
  expect(nextCopyKey(stem, new Set())).toBe(stem);
  expect(copyKeyStem({ product: 'transfer', role: 'push-title' })).toBe('gopay_transfer_pushtitle');
  expect(copyKeyStem({ product: 'transfer', role: 'tooltip' })).toBe('gopay_transfer_tooltip');
  const long = `gopay_${'a'.repeat(89)}_cta`;
  const next = nextCopyKey(long, new Set([long]));
  expect(next).toHaveLength(100);
  expect(next.endsWith('_cta_2')).toBe(true);
  const qualified = `gopay_${'a'.repeat(81)}_cta_primary`;
  expect(nextCopyKey(qualified, new Set([qualified])).endsWith('_cta_primary_2')).toBe(true);
  expect(nextCopyKey(long, new Set([long, next]))).not.toBe(next);
  expect(() => copyKeyStem({ product: 'Transfer/other', role: 'cta' })).toThrow();
  expect(() => copyKeyStem({ product: 'transfer', role: 'madeup' })).toThrow();
  expect(() => nextCopyKey('../bad', reservations)).toThrow();
});
