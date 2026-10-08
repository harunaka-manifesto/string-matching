import { describe, expect, it } from 'vitest';
import {
  createSearchIndex,
  type SearchItem,
  type SearchOptions,
  type SearchResult,
} from '../src/string-search-index';
import {
  normalizedFields,
  rankStrings,
  roleOf,
  SHARED_PRODUCT,
  type RankFields,
} from '../src/string-ranking';

type Context = { product: string; path: string; role: string };
type Item = SearchItem & {
  copyId: string;
  aliases: string[];
  path: string;
  description: string;
  feature: string;
  contexts: Context[];
  fields: RankFields;
};

/** mulberry32: deterministic corpus across runs. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRODUCTS = ['investment', 'transfer', 'insurance', 'payments', SHARED_PRODUCT];
const FEATURES: Record<string, string[]> = {
  investment: ['onboarding', 'gold', 'mutual-fund', 'portfolio'],
  transfer: ['bank-transfer', 'confirmation', 'history'],
  insurance: ['claim', 'policy-detail'],
  payments: ['checkout', 'pin', 'top-up'],
  [SHARED_PRODUCT]: ['common', 'errors'],
};
const ROLES = ['cta', 'title', 'desc', 'label', 'error', 'toast', 'text'];
const EN = (
  'top up balance transfer send money continue cancel confirm payment success failed ' +
  'investment gold mutual fund insurance claim policy pin enter your account bank details ' +
  'got it try again later understand risk start investing portfolio return daily limit ' +
  'reached verify identity schedule recurring withdraw available'
).split(' ');
const ID = (
  'isi saldo kirim uang lanjut batal konfirmasi pembayaran berhasil gagal investasi emas ' +
  'reksa dana asuransi klaim polis masukkan akun rekening coba lagi nanti oke paham risiko ' +
  'mulai berinvestasi tarik tersedia batas harian'
).split(' ');

function corpus(size: number, seed: number): Item[] {
  const next = random(seed);
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!;
  const sentence = (words: readonly string[], max: number) =>
    Array.from({ length: 1 + Math.floor(next() * max) }, () => pick(words)).join(' ');
  const decorate = (text: string) => {
    const roll = next();
    if (roll < 0.1) return text.replace(/^./u, (c) => c.toUpperCase()) + '!';
    if (roll < 0.15) return text.replace(/ (\w)/u, (_, c: string) => c.toUpperCase());
    if (roll < 0.2) return `${text}, Rp{amount}`;
    return text;
  };
  const items: Item[] = [];
  for (let i = 0; i < size; i += 1) {
    const product = next() < 0.18 ? SHARED_PRODUCT : pick(PRODUCTS.slice(0, 4));
    const feature = pick(FEATURES[product]!);
    const role = pick(ROLES);
    const slug = `${pick(EN)}_${pick(EN)}`;
    const section = next() < 0.5 ? `${feature.replace(/-/gu, '_')}_` : '';
    const name = `${product}/gopay_${product}_${section}${slug}_${role}`;
    let en = decorate(sentence(EN, 8));
    let id = decorate(sentence(ID, 8));
    const copy = items.length && next() < 0.2 ? pick(items) : null;
    if (copy?.loaded) {
      en = copy.en;
      id = next() < 0.8 ? copy.id : id;
    }
    const loaded = next() > 0.08;
    const copyId = `cp_01H${Array.from({ length: 23 }, () => pick([...'0123456789ABCDEFGHJKMNPQRSTVWXYZ'])).join('')}`;
    const contexts: Context[] =
      product === SHARED_PRODUCT && next() < 0.3
        ? Array.from({ length: 1 + Math.floor(next() * 3) }, () => {
            const owner = pick(PRODUCTS.slice(0, 4));
            return {
              product: owner,
              path: `${pick(FEATURES[owner]!)} › ${sentence(EN, 2)}`,
              role: pick(['text', 'cta', 'title', 'label']),
            };
          })
        : [];
    const item: Item = {
      key: `registry:${copyId}`,
      name,
      order: next() < 0.1 ? Number.MAX_SAFE_INTEGER : i,
      product,
      loaded,
      en: loaded ? en : '',
      id: loaded ? id : '',
      copyId,
      aliases: next() < 0.2 ? [`legacy_${slug}_${i % 7}`, `${pick(EN)}${pick(EN)}`] : [],
      path: `${next() < 0.5 ? feature + ' › ' : ''}${sentence(EN, 2)}${next() < 0.3 ? ' · ' + role : ''}`,
      description: next() < 0.3 ? `${copyId}\nNote: ${sentence(EN, 5)}` : '',
      feature,
      contexts,
      fields: undefined as unknown as RankFields,
    };
    item.fields = normalizedFields({ ...item, role: next() < 0.5 ? role : undefined });
    items.push(item);
  }
  return items;
}

/** SearchPanel: shared copy takes the path and role of its contexts in this product. */
const scopedFields = (item: Item, scope: string | null): RankFields | null => {
  const contexts = item.contexts.filter((context) => !scope || context.product === scope);
  return contexts.length
    ? normalizedFields({
        ...item,
        path: contexts.map((context) => context.path).join(' '),
        role: contexts.find((context) => context.role !== 'text')?.role ?? item.fields.role,
      })
    : null;
};
const panelFields = new Map<string | null, Map<Item, RankFields>>();
const fieldsIn = (scope: string | null) => (item: Item) => {
  let cache = panelFields.get(scope);
  if (!cache) panelFields.set(scope, (cache = new Map()));
  let fields = cache.get(item);
  if (!fields) cache.set(item, (fields = scopedFields(item, scope) ?? item.fields));
  return fields;
};

/** rankStrings + the SearchPanel strong/related split, per limit. */
function expected<T extends Item>(
  items: readonly T[],
  query: string,
  options: Omit<SearchOptions, 'limit'>,
  fields: (item: T) => RankFields = fieldsIn(options.scope),
): (limit: number) => SearchResult {
  const ranked = rankStrings(items, query, {
    fields,
    scope: options.scope,
    feature: options.feature,
    used: options.used,
    context: options.context,
    layerText: options.layerText,
    role: options.role,
    nearby: options.nearby,
    currentKey: options.currentKey,
    identity: (item) =>
      item.loaded && item.en && item.id ? `value\u0000${item.en}\u0000${item.id}` : null,
  });
  const score = (item: T) => ranked.details.get(item.key)?.score ?? 0;
  const hit = (item: T) => ({ key: item.key, ...ranked.details.get(item.key)! });
  const strong = ranked.inScope.filter((item) => score(item) >= 1200);
  const best = strong.length ? strong : ranked.inScope;
  const related = strong.length ? ranked.inScope.filter((item) => score(item) < 1200) : [];
  return (limit) => ({
    total: ranked.total,
    best: best.slice(0, limit).map(hit),
    bestCount: best.length,
    strong: strong.length > 0,
    related: options.related ? related.slice(0, limit).map(hit) : [],
    relatedCount: related.length,
  });
}

const typos = (word: string) => [
  word.slice(0, 2) + word[3] + word[2] + word.slice(4),
  word.slice(0, -1),
  word + 's',
  word.slice(0, 1) + 'x' + word.slice(2),
];

function queries(items: readonly Item[]): string[] {
  const loaded = items.filter((item) => item.loaded);
  const sample = (step: number) => loaded.filter((_, i) => i % step === 0).slice(0, 4);
  const typing = (text: string) => Array.from(text, (_, i) => text.slice(0, i + 1));
  return [
    '',
    '  ',
    '!!',
    'zzqx',
    ...typing('continue'),
    ...typing('top up sal'),
    ...typing('transfer ke'),
    'got it',
    'i',
    'it',
    'pin',
    'in',
    'vest',
    'investment gold',
    'reksa dana',
    'Rp{amount}',
    ...typos('continue'),
    ...typos('payment'),
    'contineu payment',
    'contineu paymnet',
    'saldo transfr',
    ...sample(97).map((item) => item.en),
    ...sample(89).map((item) => item.id.toUpperCase()),
    ...sample(83).map((item) => item.en.split(' ').slice(1, 3).join(' ')),
    ...sample(79).map((item) => item.name),
    ...sample(73).map((item) => item.name.slice(item.name.lastIndexOf('/') + 1)),
    ...sample(71).map((item) => item.copyId),
    ...sample(67).map((item) => item.copyId.toLowerCase().slice(0, 8)),
    ...items
      .filter((item) => item.aliases.length)
      .slice(0, 2)
      .map((item) => item.aliases[0]!),
  ];
}

function scenarios(items: readonly Item[]): SearchOptions[] {
  const keys = (step: number, offset: number) =>
    new Set(items.filter((_, i) => i % step === offset).map((item) => item.key));
  const layer = items.find((item) => item.loaded && item.product === 'investment')!;
  return [
    { scope: null, limit: 20 },
    {
      scope: 'investment',
      feature: 'gold',
      used: keys(9, 1),
      context: ['Button', 'Investment - Gold onboarding', 'Portfolio page', 'got it'],
      layerText: layer.en,
      role: roleOf(['Button']),
      nearby: keys(13, 2),
      currentKey: items[40]!.key,
      limit: 20,
      related: true,
    },
    {
      scope: SHARED_PRODUCT,
      feature: 'errors',
      context: ['Toast', 'Error - try again'],
      role: 'toast',
      limit: 20,
      related: true,
    },
    {
      scope: 'transfer',
      feature: null,
      context: ['Title', 'Bank transfer confirmation', 'History screen'],
      role: 'title',
      used: keys(5, 0),
      limit: 20,
      related: true,
    },
    {
      scope: null,
      feature: null,
      context: ['Frame 12', 'Insurance claim detail', 'Policy'],
      layerText: 'Lanjut',
      role: 'cta',
      nearby: keys(7, 3),
      currentKey: items[3]!.key,
      limit: 20,
      related: true,
    },
    { scope: 'payments', feature: 'pin', context: ['Enter PIN'], limit: 20 },
    { scope: 'unknown-product', limit: 20, related: true },
  ];
}

const items = corpus(2000, 42);
const index = createSearchIndex(items, (item) => item.fields, scopedFields);
const QUERIES = queries(items);
const SCENARIOS = scenarios(items);

describe('createSearchIndex', () => {
  it('builds over every item', () => {
    expect(index.size).toBe(items.length);
    // The corpus exercises grouping, contexts, ties and empty values.
    expect(items.filter((item) => item.contexts.length).length).toBeGreaterThan(20);
    expect(items.filter((item) => !item.loaded).length).toBeGreaterThan(20);
    expect(items.filter((item) => item.order === Number.MAX_SAFE_INTEGER).length).toBeGreaterThan(
      20,
    );
  });

  SCENARIOS.forEach((options, s) => {
    it(`matches rankStrings + SearchPanel split, scenario ${s} (${options.scope})`, () => {
      let grouped = 0;
      let strong = 0;
      for (const query of QUERIES) {
        const results = expected(items, query, options);
        const want = results(Infinity);
        expect(index.search(query, { ...options, limit: Infinity }), query).toEqual(want);
        expect(index.search(query, options), query).toEqual(results(options.limit));
        grouped += want.best.filter((hit) => hit.duplicates > 1).length;
        if (want.strong) strong += 1;
      }
      expect(grouped).toBeGreaterThan(0);
      expect(strong).toBeGreaterThan(0);
    });
  });

  it('stays exact across rebuilds that reuse unchanged fields', () => {
    // Values arrive for every tenth string; the rest keep their fields objects, so the
    // rebuild reuses their word ids while adding new words the first index never saw.
    const next = items.map((item, i) => {
      if (i % 10) return item;
      const changed = { ...item, loaded: true, en: `${item.en} kangaroo`, id: 'wombat lanjut' };
      changed.fields = normalizedFields(changed);
      return changed;
    });
    const rebuilt = createSearchIndex(next, (item) => item.fields, scopedFields);
    for (const options of SCENARIOS.slice(0, 2))
      for (const query of ['kangaroo', 'kang', 'wombat lanjut', 'continue', 'gold', 'kangaro']) {
        const all = { ...options, limit: Infinity };
        expect(rebuilt.search(query, all), query).toEqual(expected(next, query, options)(Infinity));
        expect(index.search(query, all), query).toEqual(expected(items, query, options)(Infinity));
      }
  });

  it('omits related unless asked and honours small limits', () => {
    const options: SearchOptions = { scope: 'investment', limit: 3 };
    for (const query of ['gold', 'continue', 'kirim uang', 'contineu']) {
      const result = index.search(query, options);
      const results = expected(items, query, options);
      expect(result).toEqual(results(3));
      expect(result.related).toEqual([]);
      expect(index.search(query, { ...options, limit: 0 })).toEqual(results(0));
    }
  });

  it('keeps rankStrings order on full ties and merges shared groups', () => {
    const base = corpus(6, 3).map((item) => ({
      ...item,
      name: 'shared/gopay_shared_common_got_it_cta',
      order: 5,
      aliases: ['legacy key'],
    }));
    const copy = (i: number, product: string, en: string, id: string): Item => {
      const item = { ...base[i]!, product, en, id };
      return { ...item, fields: normalizedFields(item) };
    };
    const tied = [
      copy(0, 'investment', 'Got it', 'Oke'),
      copy(1, SHARED_PRODUCT, 'Got it', 'Oke deh'),
      copy(2, 'transfer', 'Something else', 'Lain'),
      copy(3, SHARED_PRODUCT, 'Got it', 'Oke'),
      copy(4, 'investment', 'Got it', 'Sip'),
      copy(5, 'investment', 'Got it', 'Sip'),
    ];
    const tiedIndex = createSearchIndex(tied, (item) => item.fields);
    const options = {
      scope: 'investment',
      used: new Set([tied[0]!.key]),
      currentKey: tied[1]!.key,
      related: true,
    };
    // Aliases split on ' ' keep "cta\nlegacy" as one word for the typo check.
    for (const query of ['got it', 'got', 'ctalegacy', 'legacx key'])
      expect(tiedIndex.search(query, { ...options, limit: 20 }), query).toEqual(
        expected(tied, query, options, (item) => item.fields)(20),
      );
    expect(
      tiedIndex.search('got it', { ...options, limit: 20 }).best.map((hit) => hit.key),
    ).toEqual([tied[3]!.key, tied[1]!.key, tied[4]!.key]);
    const typo = tiedIndex.search('ctalegacy', { ...options, limit: 20 });
    expect([typo.total, typo.best[0]?.reasons[0]]).toEqual([3, 'Similar spelling']);
  });

  it('returns nothing for queries without searchable text', () => {
    for (const query of ['', '  ', '—', '!?'])
      expect(index.search(query, { scope: null, limit: 20 })).toEqual({
        total: 0,
        best: [],
        bestCount: 0,
        strong: false,
        related: [],
        relatedCount: 0,
      });
  });

  it('scores fields with unusual whitespace exactly like lexicalMatch', () => {
    const raw = corpus(300, 7);
    // Unnormalized fields: tabs, newlines and double spaces change how lexicalMatch splits words.
    const fields = (item: Item): RankFields => ({
      ...item.fields,
      en: item.order % 3 ? item.fields.en : item.fields.en.replace(' ', '\t'),
      id: item.order % 5 ? item.fields.id : item.fields.id.replace(' ', '  '),
      description: item.description.toLowerCase(),
      copyId: `${item.fields.copyId}\nalt ${item.order}`,
    });
    const rawIndex = createSearchIndex(raw, fields);
    for (const options of scenarios(raw).slice(0, 3))
      for (const query of [...queries(raw), 'alt 12', 'note', 'contnue'])
        expect(rawIndex.search(query, { ...options, limit: Infinity }), query).toEqual(
          expected(raw, query, options, fields)(Infinity),
        );
  });
});
