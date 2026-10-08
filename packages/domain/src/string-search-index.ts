/**
 * rankStrings() for interactive search, prebuilt once per catalog. Same results,
 * order and details as rankStrings + the SearchPanel strong/related split, but each
 * query token is classified once against a word dictionary and only entries from its
 * postings are scored, so a keystroke costs ~1 ms instead of a full scan.
 */
import {
  lexicalMatch,
  oneTypo,
  prepareQuery,
  ROLE_ALIASES,
  searchText,
  SHARED_PRODUCT,
  tokenScore,
  type PreparedQuery,
  type RankFields,
} from './string-ranking';
import { contextTokens } from './variable-search';

export type SearchItem = {
  key: string;
  name: string;
  order: number;
  product: string;
  /** Raw values, for identity grouping. */
  loaded: boolean;
  en: string;
  id: string;
};
export type SearchHit = {
  key: string;
  score: number;
  tier: number;
  boost: number;
  reasons: string[];
  duplicates: number;
};
export type SearchOptions = {
  scope: string | null;
  /** Callers pass null when scope is null, same as rankStrings callers. */
  feature?: string | null;
  used?: ReadonlySet<string>;
  context?: readonly string[];
  layerText?: string;
  role?: string;
  nearby?: ReadonlySet<string>;
  currentKey?: string | null;
  /** How many hits to return from each section. */
  limit: number;
  /** Also return the related section (score < 1200 when strong hits exist). */
  related?: boolean;
};
export type SearchResult = {
  /** Groups after identity grouping (what rankStrings returns as `total`). */
  total: number;
  /** Section shown first: hits with score >= 1200 if any exist, else all hits. Sorted, first `limit`. */
  best: SearchHit[];
  bestCount: number;
  /** True when `best` is the strong (>=1200) subset. */
  strong: boolean;
  /** Hits with score < 1200, only when `strong` is true (else empty / 0). First `limit` when options.related. */
  related: SearchHit[];
  relatedCount: number;
};
export type SearchIndex = {
  search(query: string, options: SearchOptions): SearchResult;
  size: number;
};

const STRONG = 1200;
// Mirrors rankStrings: context words that say nothing about the frame.
const STOP_CONTEXT = ['frame', 'page', 'screen', 'text', 'gopay', 'flows', 'default'];
// lexicalMatch() fields and weights, in its order.
const FIELDS = ['en', 'id', 'name', 'aliases', 'copyId', 'path', 'description'] as const;
const WEIGHTS = [1, 1, 0.65, 0.65, 0.65, 0.55, 0.4];
const EN = 0;
const ID = 1;
const NAME = 2;
const ALIASES = 3;
const PATH = 5;
const DESCRIPTION = 6;
/** Aliases split on ' ' like the typo check does, keeping '\n'-joined lines as one word. */
const ALIAS_WORDS = 7;
const FEATURE = 8;
const SLOTS = 9;
const CACHE = 64;

type Dictionary = { vocabulary: Map<string, number>; words: string[] };
type RowWords = {
  dictionary: Dictionary;
  /** Word ids of every slot, back to back; slot s ends at ends[s]. */
  ids: Int32Array;
  ends: Int32Array;
  irregular: boolean;
};
// Word ids outlive a rebuild: the dictionary only grows (words no entry uses have no
// postings), so fields objects that did not change keep their ids. It starts over
// once mostly unused.
let dictionary: Dictionary = { vocabulary: new Map(), words: [] };
const rowWords = new WeakMap<RankFields, RowWords>();
function wordsOf(f: RankFields): RowWords {
  const cached = rowWords.get(f);
  if (cached?.dictionary === dictionary) return cached;
  const { vocabulary, words } = dictionary;
  const ids: number[] = [];
  const ends = new Int32Array(SLOTS);
  for (let slot = 0; slot < SLOTS; slot += 1) {
    const text =
      slot < ALIAS_WORDS
        ? (f[FIELDS[slot]!] ?? '')
        : slot === ALIAS_WORDS
          ? (f.aliases ?? '')
          : (f.feature ?? '');
    for (const word of slot === ALIAS_WORDS ? text.split(' ') : text.split(/\s+/u)) {
      let id = vocabulary.get(word);
      if (id === undefined) {
        id = words.length;
        vocabulary.set(word, id);
        words.push(word);
      }
      ids.push(id);
    }
    ends[slot] = ids.length;
  }
  // Fields lexicalMatch splits differently from /\s+/ are rare; score them directly.
  const irregular = FIELDS.some((name) => name !== 'aliases' && /[^\S ]| {2}/u.test(f[name] ?? ''));
  const row = { dictionary, ids: Int32Array.from(ids), ends, irregular };
  rowWords.set(f, row);
  return row;
}

type Match = {
  i: number;
  score: number;
  tier: number;
  boost: number;
  reason: string;
  duplicates: number;
  /** Best member of the identity group; rankStrings keeps groups in that member's order on ties. */
  first: Match | null;
};
type TokenClass = {
  token: string;
  /** Per word id: 60 exact, 40 prefix, 15 substring, like tokenScore(). */
  cls: Uint8Array;
  hit: number[];
  /** Word ids one typo away (tokens of 4+ characters). */
  typo: number[];
  typoSet: Uint8Array | null;
};
type ScopeState = {
  /** In-scope entries scored through the postings. */
  mask: Uint32Array;
  /** In-scope entries scored with lexicalMatch on their own fields. */
  direct: Map<number, RankFields>;
  size: number;
};
type ContextStats = { useful: Map<number, { boost: number; reason: string }> };

const empty = (): SearchResult => ({
  total: 0,
  best: [],
  bestCount: 0,
  strong: false,
  related: [],
  relatedCount: 0,
});

/** Bounded heap keeping the `k` first items by `compare`, returned sorted. */
function topK<T>(items: T[], k: number, compare: (a: T, b: T) => number): T[] {
  if (k <= 0) return [];
  if (items.length <= k * 4) return items.sort(compare).slice(0, k);
  // heap[0] is the worst kept item.
  const heap: T[] = [];
  const swap = (a: number, b: number) => {
    const item = heap[a]!;
    heap[a] = heap[b]!;
    heap[b] = item;
  };
  for (const item of items) {
    if (heap.length < k) {
      heap.push(item);
      for (let i = heap.length - 1; i > 0;) {
        const parent = (i - 1) >> 1;
        if (compare(heap[i]!, heap[parent]!) <= 0) break;
        swap(i, parent);
        i = parent;
      }
    } else if (compare(item, heap[0]!) < 0) {
      heap[0] = item;
      for (let i = 0; ;) {
        const left = 2 * i + 1;
        let worst = i;
        if (left < k && compare(heap[left]!, heap[worst]!) > 0) worst = left;
        if (left + 1 < k && compare(heap[left + 1]!, heap[worst]!) > 0) worst = left + 1;
        if (worst === i) break;
        swap(i, worst);
        i = worst;
      }
    }
  }
  return heap.sort(compare);
}

export function createSearchIndex<T extends SearchItem>(
  items: readonly T[],
  fields: (item: T) => RankFields,
  /** Fields that differ per scope (shared copy with per-product contexts). Return null when the item uses `fields` for that scope. */
  scopedFields?: (item: T, scope: string | null) => RankFields | null,
): SearchIndex {
  const n = items.length;
  // Row r < n is item r. Scoped fields for the scopes items belong to are extra rows,
  // indexed up front, so every scope searches through the postings.
  const rows: RankFields[] = items.map(fields);
  const owner: number[] = [];
  const variants = new Map<string, Map<number, number>>();
  if (scopedFields) {
    // scopedFields may return the same fields for several scopes; they share a row.
    const rowOf = new Map<RankFields, number>();
    rows.forEach((f, i) => rowOf.set(f, i));
    for (const scope of [null, ...new Set(items.map((item) => item.product))]) {
      const scoped = new Map<number, number>();
      for (let i = 0; i < n; i += 1) {
        const item = items[i]!;
        if (scope && item.product !== scope && item.product !== SHARED_PRODUCT) continue;
        const f = scopedFields(item, scope);
        if (!f) continue;
        let r = rowOf.get(f);
        if (r === undefined || (r < n ? r : owner[r - n]) !== i) {
          r = rows.length;
          rowOf.set(f, r);
          owner.push(i);
          rows.push(f);
        }
        scoped.set(i, r);
      }
      variants.set(scope ?? '\u0000all', scoped);
    }
  }
  const rowCount = rows.length;
  const itemOf = (r: number) => (r < n ? r : owner[r - n]!);
  const shared = new Uint8Array(n);
  const order = new Float64Array(n);
  const product: string[] = [];
  // Identity group id per item: equal loaded en/id values share one, others are unique.
  const identity = new Int32Array(n);
  const identityIds = new Map<string, number>();
  for (let i = 0; i < n; i += 1) {
    const item = items[i]!;
    shared[i] = item.product === SHARED_PRODUCT ? 1 : 0;
    order[i] = item.order;
    product.push(item.product);
    const key =
      item.loaded && item.en && item.id ? `value\u0000${item.en}\u0000${item.id}` : item.key;
    let id = identityIds.get(key);
    if (id === undefined) identityIds.set(key, (id = i));
    identity[i] = id;
  }
  const split = rows.map(wordsOf);
  const irregular = Uint8Array.from(split, (row) => (row.irregular ? 1 : 0));

  // Names ranked once at build, ordered as String#localeCompare() orders them; queries compare integers.
  const collate = new Intl.Collator().compare;
  const byName = Array.from(items.keys()).sort((a, b) => collate(items[a]!.name, items[b]!.name));
  const nameRank = new Int32Array(n);
  for (let r = 0, rank = 0; r < n; r += 1) {
    if (r && collate(items[byName[r]!]!.name, items[byName[r - 1]!]!.name) !== 0) rank = r;
    nameRank[byName[r]!] = rank;
  }
  const compare = (a: Match, b: Match) =>
    b.tier - a.tier ||
    b.boost - a.boost ||
    b.score - a.score ||
    order[itemOf(a.i)]! - order[itemOf(b.i)]! ||
    nameRank[itemOf(a.i)]! - nameRank[itemOf(b.i)]!;
  // rankStrings sorts stably, so full ties keep list order.
  const before = (a: Match, b: Match) => compare(a, b) || itemOf(a.i) - itemOf(b.i);
  const compareGroups = (a: Match, b: Match) => compare(a, b) || before(a.first!, b.first!);

  // Word dictionary; every field stored as word ids (CSR: entry * SLOTS + slot).
  const { vocabulary } = dictionary;
  // Later builds append to the dictionary; this index only knows the words up to now.
  const words = dictionary.words.slice();
  const offsets = new Int32Array(rowCount * SLOTS + 1);
  let size = 0;
  for (const row of split) size += row.ids.length;
  const occ = new Int32Array(size);
  for (let i = 0, at = 0; i < rowCount; i += 1) {
    const { ids, ends } = split[i]!;
    occ.set(ids, at);
    for (let slot = 0; slot < SLOTS; slot += 1)
      offsets[i * SLOTS + slot] = at + (slot ? ends[slot - 1]! : 0);
    at += ids.length;
  }
  offsets[rowCount * SLOTS] = size;

  // Postings: word id -> distinct entries (CSR).
  const starts = new Int32Array(words.length + 1);
  const seen = new Int32Array(words.length).fill(-1);
  for (let i = 0; i < rowCount; i += 1)
    for (let p = offsets[i * SLOTS]!; p < offsets[(i + 1) * SLOTS]!; p += 1) {
      const w = occ[p]!;
      if (seen[w] === i) continue;
      seen[w] = i;
      starts[w + 1] += 1;
    }
  for (let w = 0; w < words.length; w += 1) starts[w + 1] += starts[w]!;
  const postings = new Int32Array(starts[words.length]!);
  const fill = starts.slice(0, words.length);
  seen.fill(-1);
  for (let i = 0; i < rowCount; i += 1)
    for (let p = offsets[i * SLOTS]!; p < offsets[(i + 1) * SLOTS]!; p += 1) {
      const w = occ[p]!;
      if (seen[w] === i) continue;
      seen[w] = i;
      postings[fill[w]!++] = i;
    }

  let live = 0;
  for (let w = 0; w < words.length; w += 1) if (starts[w + 1]! > starts[w]!) live += 1;
  if (words.length > 4 * live + 10_000) dictionary = { vocabulary: new Map(), words: [] };

  // Sorted dictionary: tokens under 3 characters match word prefixes only.
  const sorted = Int32Array.from(words.keys()).sort((a, b) =>
    words[a]! < words[b]! ? -1 : words[a]! > words[b]! ? 1 : 0,
  );
  const lowerBound = (token: string) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (words[sorted[mid]!]! < token) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const byLength = new Map<number, number[]>();
  for (let w = 0; w < words.length; w += 1) {
    const length = words[w]!.length;
    const list = byLength.get(length);
    if (list) list.push(w);
    else byLength.set(length, [w]);
  }

  // isExactIdentifier(name | aliases | copyId) <=> one of their lines equals the phrase.
  const identLines = new Map<string, number[]>();
  for (let i = 0; i < rowCount; i += 1) {
    const f = rows[i]!;
    for (const value of [f.name, f.aliases ?? '', f.copyId ?? ''])
      for (const line of value.split('\n')) {
        const list = identLines.get(line);
        if (!list) identLines.set(line, [i]);
        else if (list.at(-1) !== i) list.push(i);
      }
  }

  const classes = new Map<string, TokenClass>();
  function classify(token: string): TokenClass {
    const cached = classes.get(token);
    if (cached) return cached;
    const cls = new Uint8Array(words.length);
    const hit: number[] = [];
    if (token.length >= 3) {
      // Typing forward: the new token's words contain the previous token.
      const previous = classes.get(token.slice(0, -1));
      const scan = previous && previous.token.length >= 3 ? previous.hit : null;
      const test = (w: number) => {
        const word = words[w]!;
        if (word.length < token.length || !word.includes(token)) return;
        cls[w] = word.startsWith(token) ? 40 : 15;
        hit.push(w);
      };
      if (scan) for (const w of scan) test(w);
      else for (let w = 0; w < words.length; w += 1) test(w);
    } else
      for (let r = lowerBound(token); r < sorted.length; r += 1) {
        const w = sorted[r]!;
        if (!words[w]!.startsWith(token)) break;
        cls[w] = 40;
        hit.push(w);
      }
    const exact = vocabulary.get(token);
    if (exact !== undefined && exact < words.length) cls[exact] = 60;
    const typo: number[] = [];
    if (token.length >= 4)
      for (const length of [token.length - 1, token.length, token.length + 1])
        for (const w of byLength.get(length) ?? []) if (oneTypo(token, words[w]!)) typo.push(w);
    let typoSet: Uint8Array | null = null;
    if (typo.length) {
      typoSet = new Uint8Array(words.length);
      for (const w of typo) typoSet[w] = 1;
    }
    const result = { token, cls, hit, typo, typoSet };
    classes.set(token, result);
    if (classes.size > CACHE) classes.delete(classes.keys().next().value!);
    return result;
  }

  const fieldScore = (i: number, slot: number, cls: Uint8Array) => {
    let best = 0;
    const end = offsets[i * SLOTS + slot + 1]!;
    for (let p = offsets[i * SLOTS + slot]!; p < end; p += 1) {
      const value = cls[occ[p]!]!;
      if (value > best) {
        best = value;
        if (value === 60) break;
      }
    }
    return best;
  };
  const anyTypo = (i: number, slot: number, typoSet: Uint8Array | null) => {
    if (!typoSet) return false;
    const end = offsets[i * SLOTS + slot + 1]!;
    for (let p = offsets[i * SLOTS + slot]!; p < end; p += 1) if (typoSet[occ[p]!]) return true;
    return false;
  };
  const wordCount = (i: number, slot: number) =>
    offsets[i * SLOTS + slot + 1]! - offsets[i * SLOTS + slot]!;

  /** lexicalMatch() on word ids; null when it would return tier -1. */
  function lexical(
    i: number,
    phrase: string,
    tokens: readonly TokenClass[],
    exactKey: boolean,
  ): Match | null {
    const match = (score: number, tier: number, reason: string): Match => ({
      i,
      score,
      tier,
      reason,
      boost: 0,
      duplicates: 1,
      first: null,
    });
    if (exactKey) return match(4000, 6, 'Exact key or ID');
    let total = 0;
    let typo = false;
    for (const token of tokens) {
      let best = 0;
      for (let slot = 0; slot < ALIAS_WORDS; slot += 1) {
        const value = fieldScore(i, slot, token.cls) * WEIGHTS[slot]!;
        if (value > best) best = value;
      }
      if (!best) {
        if (typo) return null;
        let found = false;
        for (let slot = 0; slot < ALIAS_WORDS && !found; slot += 1)
          found = anyTypo(i, slot === ALIASES ? ALIAS_WORDS : slot, token.typoSet);
        if (!found) return null;
        typo = true;
        best = 5;
      }
      total += best;
    }
    const covers = (slot: number) =>
      tokens.every(
        (token) => fieldScore(i, slot, token.cls) > 0 || (typo && anyTypo(i, slot, token.typoSet)),
      );
    const coverEn = covers(EN);
    const coverId = covers(ID);
    const copyMatch = coverEn || coverId;
    let score = typo ? (copyMatch ? 700 : 100) : copyMatch ? 900 : 500;
    let tier = typo ? (copyMatch ? 1 : 0) : copyMatch ? 2 : 1;
    if (typo && copyMatch) {
      const length = Math.min(
        coverEn ? wordCount(i, EN) : Infinity,
        coverId ? wordCount(i, ID) : Infinity,
      );
      if (length === tokens.length) {
        score = 2200;
        tier = 4;
      } else {
        score += Math.floor((500 * tokens.length) / length);
        if (tokens.length * 3 >= length) tier = 2;
      }
    }
    let reason = typo ? 'Similar spelling' : 'Keywords match';
    const f = rows[i]!;
    for (const locale of ['en', 'id'] as const) {
      const value = f[locale];
      if (value === phrase) {
        score = 3000;
        tier = 5;
        reason = `Exact ${locale.toUpperCase()}`;
        break;
      }
      if (!typo && value.startsWith(phrase) && score < 1800) {
        score = 1800;
        tier = 3;
        reason = `Starts with ${locale.toUpperCase()}`;
      } else if (!typo && value.includes(phrase) && score < 1200) {
        score = 1200;
        tier = 3;
        reason = `Phrase in ${locale.toUpperCase()}`;
      }
    }
    return match(score + Math.min(total, 150), tier, reason);
  }

  const blocks = (rowCount + 31) >>> 5;
  const scopes = new Map<string, ScopeState>();
  function scopeState(scope: string | null): ScopeState {
    const cacheKey = scope ?? '\u0000all';
    const cached = scopes.get(cacheKey);
    if (cached) return cached;
    const mask = new Uint32Array(blocks);
    const direct = new Map<number, RankFields>();
    const indexed = variants.get(cacheKey);
    let size = 0;
    for (let i = 0; i < n; i += 1) {
      if (scope && product[i] !== scope && !shared[i]) continue;
      size += 1;
      let r = i;
      if (indexed) r = indexed.get(i) ?? i;
      else {
        // A scope no item belongs to: its scoped fields were not indexed.
        const scoped = scopedFields?.(items[i]!, scope) ?? null;
        if (scoped) {
          direct.set(i, scoped);
          continue;
        }
      }
      if (irregular[r]) direct.set(r, rows[r]!);
      else mask[r >>> 5]! |= 1 << (r & 31);
    }
    const state = { mask, direct, size };
    if (scopes.size >= CACHE) scopes.delete(scopes.keys().next().value!);
    scopes.set(cacheKey, state);
    return state;
  }
  const fieldsOf = (state: ScopeState, i: number) => state.direct.get(i) ?? rows[i]!;

  // Context token ownership per (scope, context); independent of the query.
  const contexts = new Map<string, ContextStats>();
  const stamp = new Int32Array(rowCount).fill(-1);
  function contextStats(
    scope: string | null,
    state: ScopeState,
    names: readonly string[],
  ): ContextStats {
    const scopeWords = contextTokens(scope ? [scope] : []);
    const context = [...contextTokens(names)].filter(
      (token) => !scopeWords.has(token) && !ROLE_ALIASES[token] && !STOP_CONTEXT.includes(token),
    );
    const cacheKey = `${scope ?? '\u0000all'}\u0000${context.join(' ')}`;
    const cached = contexts.get(cacheKey);
    if (cached) return cached;
    const owners = context.map(() => 0);
    const matched = new Map<number, number[]>();
    const own = (i: number, t: number) => {
      owners[t] += 1;
      const list = matched.get(i);
      if (list) list.push(t);
      else matched.set(i, [t]);
    };
    const locations = [...state.direct].map(([i, f]) => ({
      i,
      text: `${f.path} ${f.name} ${f.description ?? ''} ${f.feature ?? ''}`,
    }));
    stamp.fill(-1);
    context.forEach((token, t) => {
      // Context tokens have 3+ characters: tokenScore > 0 <=> some word contains them.
      const { hit, cls } = classify(token);
      for (const w of hit)
        for (let p = starts[w]!; p < starts[w + 1]!; p += 1) {
          const i = postings[p]!;
          if (stamp[i] === t || !(state.mask[i >>> 5]! & (1 << (i & 31)))) continue;
          stamp[i] = t;
          if (
            fieldScore(i, PATH, cls) ||
            fieldScore(i, NAME, cls) ||
            fieldScore(i, DESCRIPTION, cls) ||
            fieldScore(i, FEATURE, cls)
          )
            own(i, t);
        }
      for (const { i, text } of locations) if (tokenScore(text, token) > 0) own(i, t);
    });
    const useful = new Map<number, { boost: number; reason: string }>();
    for (const [i, list] of matched) {
      // rankStrings lists tokens in context order.
      const tokens = list
        .sort((a, b) => a - b)
        .filter((t) => owners[t]! / Math.max(state.size, 1) < 1);
      if (!tokens.length) continue;
      useful.set(i, {
        boost: Math.min(
          100,
          tokens.reduce((sum, t) => sum + 20 * Math.log2(1 + state.size / owners[t]!), 0),
        ),
        reason: `Context: ${tokens
          .slice(0, 3)
          .map((t) => context[t])
          .join(', ')}`,
      });
    }
    const stats = { useful };
    if (contexts.size >= 16) contexts.delete(contexts.keys().next().value!);
    contexts.set(cacheKey, stats);
    return stats;
  }

  function search(query: string, options: SearchOptions): SearchResult {
    const prepared: PreparedQuery = prepareQuery(query);
    if (!prepared.tokens.length) return empty();
    const scope = options.scope || null;
    const state = scopeState(scope);
    const stats = contextStats(scope, state, options.context ?? []);
    const tokens = prepared.tokens.map(classify);
    const exactKeys = new Set(identLines.get(prepared.phrase));

    // Candidates: scope ∩ every token's (word hits ∪ one-typo words).
    const candidates = state.mask.slice();
    const tokenBits = new Uint32Array(blocks);
    for (const token of tokens) {
      tokenBits.fill(0);
      for (const list of [token.hit, token.typo])
        for (const w of list)
          for (let p = starts[w]!; p < starts[w + 1]!; p += 1) {
            const i = postings[p]!;
            tokenBits[i >>> 5]! |= 1 << (i & 31);
          }
      for (let k = 0; k < blocks; k += 1) candidates[k]! &= tokenBits[k]!;
    }
    const matches: Match[] = [];
    for (let k = 0; k < blocks; k += 1)
      for (let bits = candidates[k]!; bits; bits &= bits - 1) {
        const i = (k << 5) | (31 - Math.clz32(bits & -bits));
        const match = lexical(i, prepared.phrase, tokens, exactKeys.has(i));
        if (match) matches.push(match);
      }
    for (const [i, f] of state.direct) {
      const { score, tier, reason } = lexicalMatch(f, prepared);
      if (tier >= 0) matches.push({ i, score, tier, reason, boost: 0, duplicates: 1, first: null });
    }

    const feature = options.feature ? searchText(options.feature) : '';
    const layerText = searchText(options.layerText ?? '');
    const boostOf = (i: number, reasons: string[] | null) => {
      const f = fieldsOf(state, i);
      const key = items[itemOf(i)]!.key;
      let boost = 0;
      if (feature && f.feature === feature) {
        boost += 120;
        reasons?.push('Same feature');
      }
      const context = stats.useful.get(i);
      if (context) {
        boost += context.boost;
        reasons?.push(context.reason);
      }
      if (options.role && f.role === options.role) {
        boost += 45;
        reasons?.push(`Same role: ${options.role.toUpperCase()}`);
      }
      if (layerText && (f.en === layerText || f.id === layerText)) {
        boost += 65;
        reasons?.push('Matches layer text');
      }
      if (options.nearby?.has(key)) {
        boost += 20;
        reasons?.push('Same flow');
      }
      if (options.used?.has(key)) {
        boost += 15;
        reasons?.push('On this page');
      }
      if (key === options.currentKey) {
        boost += 5;
        reasons?.push('Current');
      }
      if (shared[itemOf(i)]) boost += 10;
      return boost;
    };

    // Identity groups: the best member represents the group unless a shared member
    // exists; then the first shared member takes the best member's tier, boost and score.
    const slot = new Int32Array(n).fill(-1);
    const firsts: Match[] = [];
    const members: (Match | null)[] = [];
    const counts: number[] = [];
    for (const match of matches) {
      match.boost = boostOf(match.i, null);
      const id = identity[itemOf(match.i)]!;
      const g = slot[id]!;
      const member = shared[itemOf(match.i)] === 1 ? match : null;
      if (g < 0) {
        slot[id] = firsts.length;
        firsts.push(match);
        members.push(member);
        counts.push(1);
        continue;
      }
      counts[g] += 1;
      if (before(match, firsts[g]!) < 0) firsts[g] = match;
      const current = members[g];
      if (member && (!current || before(member, current) < 0)) members[g] = member;
    }
    const strong: Match[] = [];
    const weak: Match[] = [];
    for (let g = 0; g < firsts.length; g += 1) {
      const first = firsts[g]!;
      const member = members[g];
      // Matches are fresh per search, so the best member can be its own representative.
      const rep =
        member && member !== first
          ? {
              ...member,
              tier: Math.max(member.tier, first.tier),
              boost: Math.max(member.boost, first.boost),
              score: Math.max(member.score, first.score),
            }
          : first;
      rep.duplicates = counts[g]!;
      rep.first = first;
      (rep.score >= STRONG ? strong : weak).push(rep);
    }

    const hits = (pool: Match[]) =>
      (options.limit >= pool.length
        ? pool.sort(compareGroups)
        : topK(pool, options.limit, compareGroups)
      ).map((match): SearchHit => {
        const reasons = [match.reason];
        boostOf(match.i, reasons);
        return {
          key: items[itemOf(match.i)]!.key,
          score: match.score,
          tier: match.tier,
          boost: match.boost,
          reasons,
          duplicates: match.duplicates,
        };
      });
    const total = firsts.length;
    if (!strong.length)
      return {
        total,
        best: hits(weak),
        bestCount: total,
        strong: false,
        related: [],
        relatedCount: 0,
      };
    return {
      total,
      best: hits(strong),
      bestCount: strong.length,
      strong: true,
      related: options.related ? hits(weak) : [],
      relatedCount: weak.length,
    };
  }

  return { search, size: n };
}
