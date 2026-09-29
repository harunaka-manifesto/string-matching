/**
 * Filters string variables like Figma's variables panel search: case-insensitive
 * substring match on name (with group path) and values, every query word must
 * match, results stay in library order grouped by collection › group.
 */

export type SearchableVariable = {
  key: string;
  name: string;
  collection: string;
  order: number;
  en: string;
  id: string;
  description: string;
};

export type SearchGroup<T extends SearchableVariable> = {
  collection: string;
  group: string;
  items: T[];
};

export function normalizeForSearch(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

export function searchHaystack(variable: SearchableVariable): string {
  return normalizeForSearch(
    [variable.name, variable.en, variable.id, variable.description, variable.collection].join('\n'),
  );
}

export function queryTokens(query: string): string[] {
  return normalizeForSearch(query).split(/\s+/u).filter(Boolean);
}

export function groupOf(name: string): string {
  const slash = name.lastIndexOf('/');
  return slash === -1 ? '' : name.slice(0, slash);
}

/** Splits names like `investment-landing_homepage` into comparable word tokens. */
export function contextTokens(names: readonly string[]): Set<string> {
  const tokens = new Set<string>();
  for (const name of names)
    for (const token of normalizeForSearch(name).split(/[^\p{L}\p{N}]+/u))
      if (token.length >= 3 && !/^\d+$/u.test(token)) tokens.add(token);
  return tokens;
}

function contextScore(group: SearchGroup<SearchableVariable>, tokens: Set<string>): number {
  if (!tokens.size) return 0;
  const haystack = normalizeForSearch(
    `${group.collection} ${group.group} ${group.items
      .slice(0, 20)
      .map((item) => item.name)
      .join(' ')}`,
  );
  let score = 0;
  for (const token of tokens) if (haystack.includes(token)) score += 1;
  return score;
}

export function searchVariables<T extends SearchableVariable>(
  variables: readonly T[],
  query: string,
  options: {
    haystack?: (variable: T) => string;
    /** Frame/section names; groups mentioning them float up. */
    context?: readonly string[];
    collectionOrder?: readonly string[];
  } = {},
): SearchGroup<T>[] {
  const tokens = queryTokens(query);
  const haystack = options.haystack ?? searchHaystack;
  const matches = tokens.length
    ? variables.filter((variable) => {
        const text = haystack(variable);
        return tokens.every((token) => text.includes(token));
      })
    : [...variables];
  const groups = new Map<string, SearchGroup<T>>();
  for (const variable of matches) {
    const group = groupOf(variable.name);
    const id = `${variable.collection}\n${group}`;
    const entry = groups.get(id) ?? { collection: variable.collection, group, items: [] };
    entry.items.push(variable);
    groups.set(id, entry);
  }
  const collectionRank = new Map((options.collectionOrder ?? []).map((name, i) => [name, i]));
  const ctx = contextTokens(options.context ?? []);
  const ranked = [...groups.values()].map((group) => {
    group.items.sort((a, b) => a.order - b.order);
    return { group, context: contextScore(group, ctx), first: group.items[0]!.order };
  });
  ranked.sort(
    (a, b) =>
      b.context - a.context ||
      (collectionRank.get(a.group.collection) ?? Number.MAX_SAFE_INTEGER) -
        (collectionRank.get(b.group.collection) ?? Number.MAX_SAFE_INTEGER) ||
      a.group.collection.localeCompare(b.group.collection) ||
      a.first - b.first,
  );
  return ranked.map((item) => item.group);
}
