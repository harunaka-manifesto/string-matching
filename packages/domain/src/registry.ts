import type {
  CopyRecord,
  LocalCopy,
  DraftRow,
  Mutation,
  ProductConfig,
  LayerInfo,
} from '@string-binder/contracts';
import { copyKeyStem, createCopyId } from './copy-identity';
import { roleOf } from './string-ranking';

/** SHA-256 with a portable UTF-8 encoder: Figma main has no browser crypto/encoder. */
export function sha256(text: string): string {
  const bytes: number[] = [];
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    const c = cp >= 0xd800 && cp <= 0xdfff ? 0xfffd : cp;
    if (c < 128) bytes.push(c);
    else if (c < 2048) bytes.push(192 | (c >> 6), 128 | (c & 63));
    else if (c < 65536) bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
    else bytes.push(240 | (c >> 18), 128 | ((c >> 12) & 63), 128 | ((c >> 6) & 63), 128 | (c & 63));
  }
  const length = bytes.length * 8;
  bytes.push(128);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let n = 7; n >= 0; n--) bytes.push(Math.floor(length / 2 ** (n * 8)) & 255);
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const rotate = (v: number, n: number) => (v >>> n) | (v << (32 - n));
  for (let pos = 0; pos < bytes.length; pos += 64) {
    const w = new Array<number>(64);
    for (let j = 0; j < 16; j++)
      w[j] =
        ((bytes[pos + j * 4]! << 24) |
          (bytes[pos + j * 4 + 1]! << 16) |
          (bytes[pos + j * 4 + 2]! << 8) |
          bytes[pos + j * 4 + 3]!) >>>
        0;
    for (let j = 16; j < 64; j++) {
      const a = w[j - 15]!,
        b = w[j - 2]!;
      w[j] =
        (w[j - 16]! +
          (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) +
          w[j - 7]! +
          (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))) >>>
        0;
    }
    let [a, b, c, d, e, f, g, t] = h;
    for (let j = 0; j < 64; j++) {
      const v =
        (t! +
          (rotate(e!, 6) ^ rotate(e!, 11) ^ rotate(e!, 25)) +
          ((e! & f!) ^ (~e! & g!)) +
          k[j]! +
          w[j]!) >>>
        0;
      const u =
        ((rotate(a!, 2) ^ rotate(a!, 13) ^ rotate(a!, 22)) +
          ((a! & b!) ^ (a! & c!) ^ (b! & c!))) >>>
        0;
      t = g;
      g = f;
      f = e;
      e = (d! + v) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (u + v) >>> 0;
    }
    [a, b, c, d, e, f, g, t].forEach((v, j) => {
      h[j] = (h[j]! + v!) >>> 0;
    });
  }
  return h.map((v) => v.toString(16).padStart(8, '0')).join('');
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}
export const recordFingerprint = (r: CopyRecord) =>
  sha256(JSON.stringify([r.copyId, r.platformKey, r.revision, r.en, r.id]));
export const canvasFingerprint = (n: Pick<LayerInfo, 'id' | 'name' | 'characters' | 'boundKey'>) =>
  sha256(JSON.stringify([n.id, n.name, n.characters, n.boundKey]));
export function bilingualErrors(en: string, id: string): string[] {
  const errors: string[] = [];
  const placeholders = (text: string, label: string) => {
    if (!text.trim()) errors.push(`${label} is required`);
    if (/<[^>]+>|%[sd]|\[\w+\]|\{\{|\}\}|XXXXX/u.test(text))
      errors.push(`${label}: use {snake_case_name} placeholders`);
    const matches = [...text.matchAll(/\{([a-z][a-z0-9]*(?:_[a-z0-9]+)*)\}/gu)].map((m) => m[1]!);
    if (/[{}]/u.test(text.replace(/\{[a-z][a-z0-9]*(?:_[a-z0-9]+)*\}/gu, '')))
      errors.push(`${label}: invalid or unbalanced braces`);
    if (/^\s*\{[^}]+\}\s*$/u.test(text)) errors.push(`${label}: a data slot alone is not copy`);
    return [...new Set(matches)].sort().join(',');
  };
  if (placeholders(en, 'EN') !== placeholders(id, 'ID'))
    errors.push('EN and ID must use the same placeholders');
  return errors;
}
export const contentOf = (r: Pick<CopyRecord, 'en' | 'id' | 'context'>) =>
  canonical({ en: r.en, id: r.id, context: r.context });
export type DiffKind =
  'current' | 'local' | 'remote' | 'equal' | 'conflict' | 'new' | 'missing' | 'unbased' | 'invalid';
export function libraryDiff(
  local: LocalCopy | undefined,
  remote: CopyRecord | undefined,
): DiffKind {
  if (local?.error) return 'invalid';
  if (!local) return 'missing';
  if (!remote) return local.copyId ? 'invalid' : 'new';
  if (local.copyId !== remote.copyId) return 'invalid';
  if (local.name.slice(local.name.lastIndexOf('/') + 1) !== remote.platformKey) return 'invalid';
  const l = contentOf({ en: local.en, id: local.id, context: local.context ?? remote.context });
  const r = contentOf(remote);
  if (!local.baseline) return 'unbased';
  const b = contentOf(local.baseline);
  if (l === r) return local.baseline.revision === remote.revision ? 'current' : 'equal';
  if (l === b) return 'remote';
  if (local.baseline.revision === remote.revision && r === b) return 'local';
  return 'conflict';
}
export function describeRecord(r: CopyRecord): string {
  return [
    r.copyId,
    [r.product, r.context.feature, r.context.screen, r.context.context, r.context.role]
      .filter(Boolean)
      .join(' › '),
    r.context.note ? `Note: ${r.context.note}` : '',
    `Copy-Meta: ${JSON.stringify({ v: 1, revision: r.revision, hash: recordFingerprint(r), product: r.product })}`,
  ]
    .filter(Boolean)
    .join('\n');
}
export function operationOf(row: DraftRow): Mutation | null {
  if (row.action === 'keep') return null;
  if (row.action === 'reuse')
    return { action: 'reuse', copyId: row.copyId, expectedRevision: row.baseline!.revision };
  if (row.action === 'edit')
    return {
      action: 'edit',
      copyId: row.copyId,
      expectedRevision: row.baseline!.revision,
      context: row.context,
      en: row.en,
      id: row.id,
    };
  return {
    action: 'create',
    copyId: row.copyId,
    product: row.product,
    context: row.context,
    en: row.en,
    id: row.id,
    ...(row.action === 'variant' ? { forkedFrom: row.baseline!.copyId } : {}),
  };
}
export const newIdentity = (time: number, entropy: Uint8Array) => createCopyId(time, entropy);
export function proposedKey(row: DraftRow, products: readonly ProductConfig[]): string {
  if (row.action === 'reuse' || row.action === 'edit') return row.baseline?.platformKey ?? '';
  const product = products.find((p) => p.id === row.product);
  if (!product) throw new Error('Choose a product');
  return copyKeyStem({ product: product.keyToken, ...row.context });
}
export function initialRow(
  layer: LayerInfo,
  locale: 'en' | 'id',
  product: string,
  screen: string,
  copyId: string,
  baseline?: CopyRecord,
): DraftRow {
  return {
    layerId: layer.id,
    action: 'keep',
    locale,
    copyId: baseline?.copyId ?? copyId,
    baseline,
    canvasFingerprint: canvasFingerprint(layer),
    product: baseline?.product ?? product,
    context: baseline?.context ?? {
      feature: '',
      screen,
      context: '',
      role: roleOf([layer.name]) || 'text',
      note: '',
    },
    en: baseline?.en ?? (locale === 'en' ? layer.characters : ''),
    id: baseline?.id ?? (locale === 'id' ? layer.characters : ''),
  };
}

export const localFingerprint = (local: LocalCopy) =>
  canonical([local.variableId, local.name, local.en, local.id, local.context]);

export function canvasLocale(row: DraftRow, locale: 'en' | 'id', canvas: string): DraftRow {
  if (row.baseline || row.locale === locale) return { ...row, locale };
  if (row[locale]) return { ...row, locale };
  return {
    ...row,
    locale,
    [locale]: canvas,
    [row.locale]: row[row.locale] === canvas ? '' : row[row.locale],
  };
}
