/** Immutable identity; generate entropy with Web Crypto (UI) or node:crypto (server).
 * Persist this ID and the request ID before sending. Retries must reuse both.
 * Allocation is only committed by a create-only server transaction, never by upsert.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ID_PATTERN = /^cp_[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;

export function createCopyId(timestamp: number, entropy: Uint8Array): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp >= 2 ** 48)
    throw new Error('Invalid UUIDv7 timestamp');
  if (entropy.length !== 10) throw new Error('Copy IDs require 10 CSPRNG bytes');
  let random = 0n;
  for (const byte of entropy) random = (random << 8n) | BigInt(byte);
  let value =
    (BigInt(timestamp) << 80n) |
    (7n << 76n) |
    (((random >> 62n) & 0xfffn) << 64n) |
    (2n << 62n) |
    (random & ((1n << 62n) - 1n));
  let encoded = '';
  for (let i = 0; i < 26; i += 1) {
    encoded = ALPHABET[Number(value & 31n)] + encoded;
    value >>= 5n;
  }
  return `cp_${encoded}`;
}

export function isCopyId(id: string): boolean {
  if (!ID_PATTERN.test(id)) return false;
  let value = 0n;
  for (const char of id.slice(3)) value = (value << 5n) | BigInt(ALPHABET.indexOf(char));
  return ((value >> 76n) & 15n) === 7n && ((value >> 62n) & 3n) === 2n;
}

const ROLES = new Set([
  'title',
  'subtitle',
  'description',
  'text',
  'cta',
  'label',
  'helper',
  'error',
  'placeholder',
  'value',
  'badge',
  'option',
  'link',
  'pushtitle',
  'pushbody',
  'toast',
  'tooltip',
  'banner',
  'tab',
  'disclaimer',
  'caption',
  'sms',
  'emailsubject',
  'emailbody',
  'a11y',
]);
const segment = (value: string) =>
  value
    .replaceAll('&', ' and ')
    .replaceAll('+', ' plus ')
    .replaceAll('%', ' percent ')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, '')
    .slice(0, 32);

/** Context determines the initial key. Wording edits and context moves never rename it. */
export function copyKeyStem(input: {
  product: string;
  feature?: string;
  screen?: string;
  context?: string;
  role: string;
  qualifier?: 'primary' | 'secondary' | 'tertiary';
}): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(input.product))
    throw new Error('Choose a valid product stream');
  const role = input.role.replaceAll('-', '');
  if (!ROLES.has(role)) throw new Error('Choose a supported copy role');
  if (input.qualifier && !['primary', 'secondary', 'tertiary'].includes(input.qualifier))
    throw new Error('Invalid copy qualifier');
  const optional = [input.feature, input.screen, input.context]
    .filter((value): value is string => !!value)
    .map(segment)
    .filter((value) => value && !['general', 'shared', 'main'].includes(value))
    .filter((value, index, all) => value !== segment(input.product) && value !== all[index - 1]);
  const parts = ['gopay', segment(input.product), ...optional, role, input.qualifier].filter(
    Boolean,
  ) as string[];
  // Shorten context, then screen, while retaining product/role and qualifiers.
  const ending = 1 + (input.qualifier ? 1 : 0);
  for (let index = parts.length - ending - 1; index >= 2 && parts.join('_').length > 100; index--) {
    const remove = parts.join('_').length - 100;
    parts[index] = parts[index]!.slice(0, Math.max(0, parts[index]!.length - remove));
  }
  const key = parts.filter(Boolean).join('_');
  if (key.length > 100) throw new Error('Shorten the copy context before creating its key');
  return key;
}

/** Read reservations INSIDE the transaction: current keys, aliases and tombstones.
 * This is a proposal, not a lock. Commit ID + key + request response atomically.
 */
export function nextCopyKey(stem: string, reserved: ReadonlySet<string>): string {
  if (!/^gopay_[a-z0-9]+(?:_[a-z0-9]+){1,9}$/u.test(stem) || stem.length > 100)
    throw new Error('Invalid copy key stem');
  const parts = stem.split('_');
  const tailLength = ['primary', 'secondary', 'tertiary'].includes(parts.at(-1)!) ? 2 : 1;
  const role = parts[parts.length - tailLength]!;
  if (!ROLES.has(role)) throw new Error('Invalid copy key role');
  const prefix = parts.slice(0, -tailLength).join('_');
  const ending = `_${parts.slice(-tailLength).join('_')}`;
  if (!reserved.has(stem)) return stem;
  for (let ordinal = 2; ; ordinal += 1) {
    const suffix = `_${ordinal}`;
    const key = `${prefix.slice(0, 100 - ending.length - suffix.length).replace(/_+$/u, '')}${ending}${suffix}`;
    if (!reserved.has(key)) return key;
  }
}
