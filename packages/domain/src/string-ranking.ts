/** Stream-scoped search. Text relevance wins; context breaks ties. */
import { contextTokens, normalizeForSearch } from './variable-search';

export const SHARED_PRODUCT = 'shared';

export function productOf(name: string, collection = ''): string {
  const slash = name.indexOf('/');
  const product = slash === -1 ? collection : name.slice(0, slash);
  if (!product || /^#?\s*legacy\b/iu.test(product)) return '';
  const slug = normalizeForSearch(product)
    .trim()
    .replace(/\s+\d+$/u, '')
    .replace(/[\s_]+/gu, '-');
  return slug === 'insurance-health-insurance-pre-ut' ? 'insurance' : slug;
}

export function productLabel(product: string): string {
  if (!product) return 'Ungrouped';
  return product
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((word, i) =>
      word.length <= 2
        ? word.toUpperCase()
        : i === 0
          ? word[0]!.toUpperCase() + word.slice(1)
          : word,
    )
    .join(' ');
}

const ROLE_ALIASES: Record<string, string> = {
  button: 'cta',
  action: 'cta',
  cta: 'cta',
  title: 'title',
  heading: 'title',
  header: 'title',
  subtitle: 'subtitle',
  body: 'description',
  desc: 'description',
  description: 'description',
  label: 'label',
  placeholder: 'placeholder',
  helper: 'helper',
  error: 'error',
  toast: 'toast',
  caption: 'caption',
  link: 'link',
  tooltip: 'tooltip',
  disclaimer: 'disclaimer',
};

export function roleOf(names: readonly string[]): string {
  for (const name of names) {
    const words = searchText(name).split(' ');
    // "Button label" describes an action, not a field label.
    if (words.includes('button') || words.includes('cta')) return 'cta';
    for (const word of words) if (ROLE_ALIASES[word]) return ROLE_ALIASES[word]!;
  }
  return '';
}

function searchText(value: string): string {
  return normalizeForSearch(value.replace(/([a-z])([A-Z])/gu, '$1 $2'))
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

export type RankFields = {
  en: string;
  id: string;
  name: string;
  path: string;
  description?: string;
  aliases?: string;
  copyId?: string;
  role?: string;
};
const WEIGHTS = {
  en: 1,
  id: 1,
  name: 0.65,
  aliases: 0.65,
  copyId: 0.65,
  path: 0.55,
  description: 0.4,
};
const FIELDS = Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[];

/** One insertion, deletion, substitution, or adjacent transposition. */
function oneTypo(a: string, b: string): boolean {
  if (a.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i += 1;
  if (a.length === b.length)
    return (
      a.slice(i + 1) === b.slice(i + 1) ||
      (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2))
    );
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

function tokenScore(text: string, token: string): number {
  const words = text.split(/\s+/u);
  if (words.includes(token)) return 60;
  if (words.some((word) => word.startsWith(token))) return 40;
  // Short substrings ("it" in "investment") produce misleading results.
  if (token.length >= 3 && text.includes(token)) return 15;
  return 0;
}

function lexicalMatch(fields: RankFields, query: string): { score: number; reason: string } {
  const phrase = searchText(query);
  const tokens = phrase.split(' ').filter(Boolean);
  if (!tokens.length) return { score: 0, reason: '' };
  const field = (name: keyof typeof WEIGHTS) => fields[name] ?? '';
  const identifiers = [field('name'), field('aliases'), field('copyId')].flatMap((value) => [
    value,
    ...value.split('\n'),
  ]);
  if (identifiers.some((value) => value === phrase))
    return { score: 4000, reason: 'Exact key or ID' };
  let words = 0;
  let typo = false;
  for (const token of tokens) {
    let best = Math.max(...FIELDS.map((name) => tokenScore(field(name), token) * WEIGHTS[name]));
    if (!best) {
      // ponytail: one typo per query, add a search index only if corpus latency warrants it.
      if (
        typo ||
        !FIELDS.some((name) =>
          field(name)
            .split(' ')
            .some((word) => oneTypo(token, word)),
        )
      )
        return { score: 0, reason: '' };
      typo = true;
      best = 5;
    }
    words += best;
  }
  const copyMatch = [fields.en, fields.id].some((value) =>
    tokens.every(
      (token) =>
        tokenScore(value, token) > 0 ||
        (typo && value.split(' ').some((word) => oneTypo(token, word))),
    ),
  );
  let base = typo ? (copyMatch ? 700 : 100) : copyMatch ? 900 : 500;
  if (typo && copyMatch) {
    const length = Math.min(
      ...[fields.en, fields.id]
        .filter((value) =>
          tokens.every(
            (token) =>
              tokenScore(value, token) || value.split(' ').some((word) => oneTypo(token, word)),
          ),
        )
        .map((value) => value.split(' ').length),
    );
    // Short corrected copy is more useful than a long disclaimer mentioning that word.
    base = length === tokens.length ? 2200 : base + Math.floor((500 * tokens.length) / length);
  }
  let reason = typo ? 'Similar spelling' : 'Keywords match';
  for (const locale of ['en', 'id'] as const) {
    const value = fields[locale];
    if (value === phrase) {
      base = 3000;
      reason = `Exact ${locale.toUpperCase()}`;
      break;
    }
    if (!typo && value.startsWith(phrase) && base < 1800) {
      base = 1800;
      reason = `Starts with ${locale.toUpperCase()}`;
    } else if (!typo && value.includes(phrase) && base < 1200) {
      base = 1200;
      reason = `Phrase in ${locale.toUpperCase()}`;
    }
  }
  return { score: base + Math.min(words, 150), reason };
}

export function matchScore(fields: RankFields, query: string): number {
  return lexicalMatch(fields, query).score;
}

export type Rankable = {
  key: string;
  name: string;
  order: number;
  collection?: string;
  product?: string;
};
export type MatchDetail = { score: number; reasons: string[]; duplicates: number };
export type RankedStrings<T> = {
  inScope: T[];
  total: number;
  details: ReadonlyMap<string, MatchDetail>;
};

export function inProduct(variable: Rankable, scope: string | null): boolean {
  const product = variable.product ?? productOf(variable.name, variable.collection);
  return !scope || product === scope || product === SHARED_PRODUCT;
}

export function rankStrings<T extends Rankable>(
  variables: readonly T[],
  query: string,
  options: {
    fields: (variable: T) => RankFields;
    scope: string | null;
    used?: ReadonlySet<string>;
    context?: readonly string[];
    layerText?: string;
    role?: string;
    nearby?: ReadonlySet<string>;
    currentKey?: string | null;
    /** Exact raw locale values, never search-normalized text. Unloaded entries return null. */
    identity?: (variable: T) => string | null;
  },
): RankedStrings<T> {
  if (!searchText(query)) return { inScope: [], total: 0, details: new Map() };
  const scoped = variables.filter((item) => inProduct(item, options.scope));
  const scopeWords = contextTokens(options.scope ? [options.scope] : []);
  const context = [...contextTokens(options.context ?? [])].filter(
    (token) =>
      !scopeWords.has(token) &&
      !ROLE_ALIASES[token] &&
      !['frame', 'page', 'screen', 'text', 'gopay', 'flows', 'default'].includes(token),
  );
  const owners = new Map(context.map((token) => [token, 0]));
  const prepared = scoped.map((item) => {
    const fields = options.fields(item);
    const location = `${fields.path} ${fields.name} ${fields.description ?? ''}`;
    const matched = context.filter((token) => tokenScore(location, token) > 0);
    for (const token of matched) owners.set(token, owners.get(token)! + 1);
    return { item, fields, matched };
  });
  const layerText = searchText(options.layerText ?? '');
  const matches: { item: T; score: number; reasons: string[]; duplicates: number }[] = [];
  for (const { item, fields, matched } of prepared) {
    const match = lexicalMatch(fields, query);
    if (!match.score) continue;
    let score = match.score;
    const reasons = [match.reason];
    const useful = matched.filter((token) => owners.get(token)! / Math.max(scoped.length, 1) < 1);
    if (useful.length) {
      score += Math.min(
        100,
        useful.reduce(
          (sum, token) => sum + 20 * Math.log2(1 + scoped.length / owners.get(token)!),
          0,
        ),
      );
      reasons.push(`Context: ${useful.slice(0, 3).join(', ')}`);
    }
    if (options.role && fields.role === options.role) {
      score += 45;
      reasons.push(`Same role: ${options.role.toUpperCase()}`);
    }
    if (layerText && (fields.en === layerText || fields.id === layerText)) {
      score += 65;
      reasons.push('Matches layer text');
    }
    if (options.nearby?.has(item.key)) {
      score += 20;
      reasons.push('Nearby in flow');
    }
    if (options.used?.has(item.key)) {
      score += 15;
      reasons.push('On page');
    }
    if (item.key === options.currentKey) {
      score += 5;
      reasons.push('Current');
    }
    if ((item.product ?? productOf(item.name, item.collection)) === SHARED_PRODUCT) score += 10;
    matches.push({ item, score, reasons, duplicates: 1 });
  }
  matches.sort(
    (a, b) =>
      b.score - a.score || a.item.order - b.item.order || a.item.name.localeCompare(b.item.name),
  );
  const grouped = new Map<string, (typeof matches)[number]>();
  for (const match of matches) {
    const identity = options.identity?.(match.item) ?? match.item.key;
    const previous = grouped.get(identity);
    if (!previous) {
      grouped.set(identity, match);
      continue;
    }
    const shared =
      (match.item.product ?? productOf(match.item.name, match.item.collection)) === SHARED_PRODUCT;
    const wasShared =
      (previous.item.product ?? productOf(previous.item.name, previous.item.collection)) ===
      SHARED_PRODUCT;
    if (shared && !wasShared) {
      match.duplicates = previous.duplicates + 1;
      match.score = Math.max(match.score, previous.score);
      grouped.set(identity, match);
    } else previous.duplicates += 1;
  }
  const results = [...grouped.values()].sort(
    (a, b) =>
      b.score - a.score || a.item.order - b.item.order || a.item.name.localeCompare(b.item.name),
  );
  return {
    inScope: results.map(({ item }) => item),
    total: results.length,
    details: new Map(
      results.map(({ item, score, reasons, duplicates }) => [
        item.key,
        { score, reasons, duplicates },
      ]),
    ),
  };
}

/** Words that describe each product: its name, its legacy section names and its key words. */
export function productVocabulary(
  strings: Iterable<{ name: string; section?: string }>,
): Map<string, Set<string>> {
  const vocabulary = new Map<string, Set<string>>();
  const seenSections = new Map<string, Set<string>>();
  for (const item of strings) {
    const product = productOf(item.name);
    if (!product || product === SHARED_PRODUCT) continue;
    let words = vocabulary.get(product);
    if (!words) {
      words = contextTokens([product]);
      vocabulary.set(product, words);
      seenSections.set(product, new Set());
    }
    for (const word of contextTokens([item.name.slice(product.length + 1)])) words.add(word);
    const section = item.section ?? '';
    if (!section || seenSections.get(product)!.has(section)) continue;
    seenSections.get(product)!.add(section);
    for (const word of contextTokens([section])) words.add(word);
  }
  return vocabulary;
}

/**
 * Best guess at the frame's product. Strings already bound in the frame decide
 * first; otherwise frame, section and page names are matched against each
 * product's vocabulary, rare words counting more. Null when unsure.
 */
export function guessProduct(input: {
  boundNames: readonly string[];
  contextNames: readonly string[];
  vocabulary: ReadonlyMap<string, ReadonlySet<string>>;
}): string | null {
  const bound = new Map<string, number>();
  for (const name of input.boundNames) {
    const product = productOf(name);
    if (product && product !== SHARED_PRODUCT) bound.set(product, (bound.get(product) ?? 0) + 1);
  }
  if (bound.size) return [...bound].sort((a, b) => b[1] - a[1])[0]![0];

  const products = [...input.vocabulary.keys()];
  if (!products.length) return null;
  const names = new Map(products.map((product) => [product, contextTokens([product])]));
  const scores = new Map<string, number>();
  for (const token of contextTokens(input.contextNames)) {
    const named = products.filter((product) => names.get(product)!.has(token));
    if (named.length) {
      // "account" only half-names account-safety; "transfer" fully names transfer.
      for (const product of named)
        scores.set(product, (scores.get(product) ?? 0) + 3 / names.get(product)!.size);
      continue;
    }
    const owners = products.filter((product) => input.vocabulary.get(product)!.has(token));
    // Words most products use ("page", "detail") say nothing about which one this is.
    if (!owners.length || owners.length > Math.max(2, products.length / 3)) continue;
    for (const product of owners)
      scores.set(product, (scores.get(product) ?? 0) + 1 / owners.length);
  }
  const [first, second] = [...scores].sort((a, b) => b[1] - a[1]);
  if (!first || first[1] < 1) return null;
  if (second && first[1] < second[1] * 1.5) return null;
  return first[0];
}

export function normalizedFields(input: {
  en: string;
  id: string;
  name: string;
  path: string;
  description?: string;
  aliases?: readonly string[];
  copyId?: string;
  role?: string;
}): RankFields {
  return {
    en: searchText(input.en),
    id: searchText(input.id),
    name: searchText(input.name),
    path: searchText(input.path),
    description: searchText(input.description ?? ''),
    aliases: [input.name.slice(input.name.lastIndexOf('/') + 1), ...(input.aliases ?? [])]
      .map(searchText)
      .join('\n'),
    copyId: searchText(input.copyId ?? ''),
    role: input.role ? roleOf([input.role]) : roleOf([input.name.split('_').at(-1) ?? '']),
  };
}
