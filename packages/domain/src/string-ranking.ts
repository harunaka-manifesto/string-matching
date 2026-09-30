/**
 * Relevance ranking for the string picker. The library holds ~20k strings from
 * many products, and values like "Got it" exist hundreds of times, so results
 * are scoped to the frame's product and ordered by how well they match.
 */
import { contextTokens, normalizeForSearch, queryTokens } from './variable-search';

/** Strings every product reuses (`shared/…`). They count as in scope everywhere. */
export const SHARED_PRODUCT = 'shared';

/** Product (domain) of a variable name: its first group, e.g. `investment/…` → `investment`. */
export function productOf(name: string): string {
  const slash = name.indexOf('/');
  return slash === -1 ? '' : name.slice(0, slash);
}

export function productLabel(product: string): string {
  if (!product) return 'Ungrouped';
  const words = product.split(/[-_\s]+/u).filter(Boolean);
  return words
    .map((word, i) =>
      word.length <= 2
        ? word.toUpperCase()
        : i === 0
          ? word[0]!.toUpperCase() + word.slice(1)
          : word,
    )
    .join(' ');
}

/** Normalized text of each searchable field (see `normalizeForSearch`). */
export type RankFields = { en: string; id: string; name: string; path: string };

const FIELD_WEIGHT: Record<keyof RankFields, number> = { en: 1, id: 0.85, path: 0.5, name: 0.45 };
const FIELDS = Object.keys(FIELD_WEIGHT) as (keyof RankFields)[];

const EXACT = 1000;
const PREFIX = 400;
const WORD = 60;
const SUBSTRING = 25;
const USED_ON_PAGE = 80;
const OWN_PRODUCT = 15;

function isWordStart(text: string, index: number): boolean {
  return index === 0 || !/[\p{L}\p{N}]/u.test(text[index - 1]!);
}

function tokenScore(text: string, token: string): number {
  let index = text.indexOf(token);
  if (index === -1) return 0;
  while (index !== -1) {
    if (isWordStart(text, index)) return WORD;
    index = text.indexOf(token, index + 1);
  }
  return SUBSTRING;
}

/** Relevance of one string for a query, or 0 when some query word matches nothing. */
export function matchScore(fields: RankFields, query: string, tokens = queryTokens(query)): number {
  if (!tokens.length) return 0;
  const phrase = tokens.join(' ');
  let score = 0;
  for (const token of tokens) {
    let best = 0;
    for (const field of FIELDS)
      best = Math.max(best, tokenScore(fields[field], token) * FIELD_WEIGHT[field]);
    if (!best) return 0;
    score += best;
  }
  let whole = 0;
  for (const field of ['en', 'id'] as const) {
    const value = fields[field].trim().replace(/\s+/gu, ' ');
    if (value === phrase) whole = Math.max(whole, EXACT * FIELD_WEIGHT[field]);
    else if (value && value.startsWith(phrase))
      whole = Math.max(whole, PREFIX * FIELD_WEIGHT[field]);
  }
  score += whole;
  // Among equal matches, shorter values are closer to what was typed.
  return score - Math.min(fields.en.length, 200) * 0.05;
}

export type Rankable = { key: string; name: string; order: number };

export type RankedStrings<T> = {
  /** Strings of the scoped product and shared strings, best first. */
  inScope: T[];
  /** Everything else, best first. Empty when there is no scope. */
  other: T[];
  total: number;
};

export function rankStrings<T extends Rankable>(
  variables: readonly T[],
  query: string,
  options: {
    fields: (variable: T) => RankFields;
    /** Product to rank first; null searches every product equally. */
    scope: string | null;
    /** Keys already bound on the page. */
    used?: ReadonlySet<string>;
  },
): RankedStrings<T> {
  const tokens = queryTokens(query);
  if (!tokens.length) return { inScope: [], other: [], total: 0 };
  const inScope: { item: T; score: number }[] = [];
  const other: { item: T; score: number }[] = [];
  for (const variable of variables) {
    let score = matchScore(options.fields(variable), query, tokens);
    if (!score) continue;
    if (options.used?.has(variable.key)) score += USED_ON_PAGE;
    const product = productOf(variable.name);
    if (!options.scope || product === options.scope) {
      if (options.scope) score += OWN_PRODUCT;
      inScope.push({ item: variable, score });
    } else if (product === SHARED_PRODUCT) inScope.push({ item: variable, score });
    else other.push({ item: variable, score });
  }
  const byScore = (a: { item: T; score: number }, b: { item: T; score: number }) =>
    b.score - a.score || a.item.order - b.item.order || a.item.name.localeCompare(b.item.name);
  inScope.sort(byScore);
  other.sort(byScore);
  return {
    inScope: inScope.map((entry) => entry.item),
    other: other.map((entry) => entry.item),
    total: inScope.length + other.length,
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
}): RankFields {
  return {
    en: normalizeForSearch(input.en),
    id: normalizeForSearch(input.id),
    name: normalizeForSearch(input.name),
    path: normalizeForSearch(input.path),
  };
}
