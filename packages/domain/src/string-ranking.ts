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

export const ROLE_ALIASES: Record<string, string> = {
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

export function searchText(value: string): string {
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
  /** Normalized feature id or legacy section; boosts, never matched as text. */
  feature?: string;
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
export function oneTypo(a: string, b: string): boolean {
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

export function tokenScore(text: string, token: string): number {
  const words = text.split(/\s+/u);
  if (words.includes(token)) return 60;
  if (words.some((word) => word.startsWith(token))) return 40;
  // Short substrings ("it" in "investment") produce misleading results.
  if (token.length >= 3 && text.includes(token)) return 15;
  return 0;
}

/**
 * Match quality buckets. Results sort by tier first, so context and feature can
 * reorder strings of equal quality but never lift a weak match above a strong one.
 */
export const TIER = {
  metadataTypo: 0,
  partial: 1,
  words: 2,
  phrase: 3,
  correctedExact: 4,
  exactText: 5,
  exactKey: 6,
} as const;

export type Lexical = { score: number; tier: number; reason: string };

export type PreparedQuery = { phrase: string; tokens: string[] };

export function prepareQuery(query: string): PreparedQuery {
  const phrase = searchText(query);
  return { phrase, tokens: phrase.split(' ').filter(Boolean) };
}

/** A whole identifier field, or one of its lines, equals the phrase. */
function isExactIdentifier(value: string, phrase: string): boolean {
  if (value === phrase) return true;
  return value.includes(phrase) && value.split('\n').includes(phrase);
}

export function lexicalMatch(fields: RankFields, query: string | PreparedQuery): Lexical {
  const none = { score: 0, tier: -1, reason: '' };
  // Ranking calls this per entry; the query is normalized once by the caller.
  const { phrase, tokens } = typeof query === 'string' ? prepareQuery(query) : query;
  if (!tokens.length) return none;
  const field = (name: keyof typeof WEIGHTS) => fields[name] ?? '';
  if (
    isExactIdentifier(field('name'), phrase) ||
    isExactIdentifier(field('aliases'), phrase) ||
    isExactIdentifier(field('copyId'), phrase)
  )
    return { score: 4000, tier: TIER.exactKey, reason: 'Exact key or ID' };
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
        return none;
      typo = true;
      best = 5;
    }
    words += best;
  }
  const covers = (value: string) =>
    tokens.every(
      (token) =>
        tokenScore(value, token) > 0 ||
        (typo && value.split(' ').some((word) => oneTypo(token, word))),
    );
  const copyMatch = [fields.en, fields.id].some(covers);
  let base = typo ? (copyMatch ? 700 : 100) : copyMatch ? 900 : 500;
  let tier: number = typo
    ? copyMatch
      ? TIER.partial
      : TIER.metadataTypo
    : copyMatch
      ? TIER.words
      : TIER.partial;
  if (typo && copyMatch) {
    const length = Math.min(
      ...[fields.en, fields.id].filter(covers).map((value) => value.split(' ').length),
    );
    // Short corrected copy is more useful than a long disclaimer mentioning that word.
    if (length === tokens.length) {
      base = 2200;
      tier = TIER.correctedExact;
    } else {
      base += Math.floor((500 * tokens.length) / length);
      if (tokens.length * 3 >= length) tier = TIER.words;
    }
  }
  let reason = typo ? 'Similar spelling' : 'Keywords match';
  for (const locale of ['en', 'id'] as const) {
    const value = fields[locale];
    if (value === phrase) {
      base = 3000;
      tier = TIER.exactText;
      reason = `Exact ${locale.toUpperCase()}`;
      break;
    }
    if (!typo && value.startsWith(phrase) && base < 1800) {
      base = 1800;
      tier = TIER.phrase;
      reason = `Starts with ${locale.toUpperCase()}`;
    } else if (!typo && value.includes(phrase) && base < 1200) {
      base = 1200;
      tier = TIER.phrase;
      reason = `Phrase in ${locale.toUpperCase()}`;
    }
  }
  return { score: base + Math.min(words, 150), tier, reason };
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
export type MatchDetail = {
  score: number;
  tier: number;
  boost: number;
  reasons: string[];
  duplicates: number;
};
export type RankedStrings<T> = {
  inScope: T[];
  total: number;
  details: ReadonlyMap<string, MatchDetail>;
};

export function inProduct(variable: Rankable, scope: string | null): boolean {
  const product = variable.product ?? productOf(variable.name, variable.collection);
  return !scope || product === scope || product === SHARED_PRODUCT;
}

const productOfRankable = (item: Rankable) => item.product ?? productOf(item.name, item.collection);

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
    /** Feature (stream inside the product) the frame most likely belongs to. */
    feature?: string | null;
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
  const feature = options.feature ? searchText(options.feature) : '';
  const owners = new Map(context.map((token) => [token, 0]));
  const prepared = scoped.map((item) => {
    const fields = options.fields(item);
    const location = `${fields.path} ${fields.name} ${fields.description ?? ''} ${fields.feature ?? ''}`;
    const matched = context.filter((token) => tokenScore(location, token) > 0);
    for (const token of matched) owners.set(token, owners.get(token)! + 1);
    return { item, fields, matched };
  });
  const layerText = searchText(options.layerText ?? '');
  type Match = {
    item: T;
    score: number;
    tier: number;
    boost: number;
    reasons: string[];
    duplicates: number;
  };
  const matches: Match[] = [];
  const preparedQuery = prepareQuery(query);
  for (const { item, fields, matched } of prepared) {
    const match = lexicalMatch(fields, preparedQuery);
    if (match.tier < 0) continue;
    let boost = 0;
    const reasons = [match.reason];
    if (feature && fields.feature === feature) {
      boost += 120;
      reasons.push('Same feature');
    }
    const useful = matched.filter((token) => owners.get(token)! / Math.max(scoped.length, 1) < 1);
    if (useful.length) {
      boost += Math.min(
        100,
        useful.reduce(
          (sum, token) => sum + 20 * Math.log2(1 + scoped.length / owners.get(token)!),
          0,
        ),
      );
      reasons.push(`Context: ${useful.slice(0, 3).join(', ')}`);
    }
    if (options.role && fields.role === options.role) {
      boost += 45;
      reasons.push(`Same role: ${options.role.toUpperCase()}`);
    }
    if (layerText && (fields.en === layerText || fields.id === layerText)) {
      boost += 65;
      reasons.push('Matches layer text');
    }
    if (options.nearby?.has(item.key)) {
      boost += 20;
      reasons.push('Same flow');
    }
    if (options.used?.has(item.key)) {
      boost += 15;
      reasons.push('On this page');
    }
    if (item.key === options.currentKey) {
      boost += 5;
      reasons.push('Current');
    }
    if (productOfRankable(item) === SHARED_PRODUCT) boost += 10;
    matches.push({ item, score: match.score, tier: match.tier, boost, reasons, duplicates: 1 });
  }
  const order = (a: Match, b: Match) =>
    b.tier - a.tier ||
    b.boost - a.boost ||
    b.score - a.score ||
    a.item.order - b.item.order ||
    a.item.name.localeCompare(b.item.name);
  matches.sort(order);
  const grouped = new Map<string, Match>();
  for (const match of matches) {
    const identity = options.identity?.(match.item) ?? match.item.key;
    const previous = grouped.get(identity);
    if (!previous) {
      grouped.set(identity, match);
      continue;
    }
    const shared = productOfRankable(match.item) === SHARED_PRODUCT;
    const wasShared = productOfRankable(previous.item) === SHARED_PRODUCT;
    if (shared && !wasShared) {
      match.duplicates = previous.duplicates + 1;
      match.tier = Math.max(match.tier, previous.tier);
      match.boost = Math.max(match.boost, previous.boost);
      match.score = Math.max(match.score, previous.score);
      grouped.set(identity, match);
    } else previous.duplicates += 1;
  }
  const results = [...grouped.values()].sort(order);
  return {
    inScope: results.map(({ item }) => item),
    total: results.length,
    details: new Map(
      results.map(({ item, score, tier, boost, reasons, duplicates }) => [
        item.key,
        { score, tier, boost, reasons, duplicates },
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

/** Name evidence per product: rare words count more, product names count most. */
function nameScores(
  contextNames: readonly string[],
  vocabulary: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, number> {
  const products = [...vocabulary.keys()];
  const names = new Map(products.map((product) => [product, contextTokens([product])]));
  const scores = new Map<string, number>();
  for (const token of contextTokens(contextNames)) {
    const named = products.filter((product) => names.get(product)!.has(token));
    if (named.length) {
      // "account" only half-names account-safety; "transfer" fully names transfer.
      for (const product of named)
        scores.set(product, (scores.get(product) ?? 0) + 3 / names.get(product)!.size);
      continue;
    }
    const owners = products.filter((product) => vocabulary.get(product)!.has(token));
    // Words most products use ("page", "detail") say nothing about which one this is.
    if (!owners.length || owners.length > Math.max(2, products.length / 3)) continue;
    for (const product of owners)
      scores.set(product, (scores.get(product) ?? 0) + 1 / owners.length);
  }
  return scores;
}

/**
 * Best guess at the frame's product, or null when unsure. Bound strings and
 * frame/page names both vote: a product needs at least a quarter of the bound
 * strings to count, so one borrowed component (a payment sheet inside an
 * investment flow) cannot flip the whole frame.
 */
export function guessProduct(input: {
  boundNames: readonly string[];
  contextNames: readonly string[];
  vocabulary: ReadonlyMap<string, ReadonlySet<string>>;
}): string | null {
  const bound = new Map<string, number>();
  let total = 0;
  for (const name of input.boundNames) {
    const product = productOf(name);
    if (!product || product === SHARED_PRODUCT) continue;
    bound.set(product, (bound.get(product) ?? 0) + 1);
    total += 1;
  }
  const scores = nameScores(input.contextNames, input.vocabulary);
  for (const [product, count] of bound) {
    if (count * 4 < total) continue;
    // Two bound strings weigh about as much as one rare word; capped so a big frame
    // full of borrowed components cannot drown out clear frame and page names.
    scores.set(product, (scores.get(product) ?? 0) + Math.min(8, count) / 2);
  }
  const [first, second] = [...scores].sort((a, b) => b[1] - a[1]);
  if (!first || first[1] < 1) return null;
  if (second && first[1] < second[1] * 1.5) return null;
  return first[0];
}

/** Words describing each feature of one product, from feature ids and legacy sections. */
export function featureVocabulary(
  strings: Iterable<{ product: string; feature?: string; section?: string }>,
  product: string,
): Map<string, Set<string>> {
  const vocabulary = new Map<string, Set<string>>();
  const productWords = contextTokens([product]);
  for (const item of strings) {
    if (item.product !== product || !item.feature) continue;
    let words = vocabulary.get(item.feature);
    if (!words) vocabulary.set(item.feature, (words = new Set()));
    for (const word of contextTokens([item.feature, item.section ?? '']))
      if (!productWords.has(word)) words.add(word);
  }
  return vocabulary;
}

/** Feature whose words best match frame and page names, or null when unclear. */
export function guessFeature(
  contextNames: readonly string[],
  vocabulary: ReadonlyMap<string, ReadonlySet<string>>,
): string | null {
  const features = [...vocabulary.keys()];
  if (!features.length) return null;
  const scores = new Map<string, number>();
  for (const token of contextTokens(contextNames)) {
    const owners = features.filter((feature) => vocabulary.get(feature)!.has(token));
    if (!owners.length || owners.length > Math.max(3, features.length / 4)) continue;
    const weight = Math.log2(1 + features.length / owners.length);
    for (const feature of owners) scores.set(feature, (scores.get(feature) ?? 0) + weight);
  }
  const [first, second] = [...scores].sort((a, b) => b[1] - a[1]);
  if (!first || first[1] < 2) return null;
  if (second && first[1] < second[1] * 1.25) return null;
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
  feature?: string;
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
    feature: input.feature ? searchText(input.feature) : '',
  };
}
