import {
  normalizeForSearch,
  inProduct,
  roleOf,
  productLabel,
  queryTokens,
  SHARED_PRODUCT,
  type MatchDetail,
  type SearchResult,
  type SequenceSource,
} from '@string-binder/domain';
import { useEffect, useMemo, useRef, useState } from 'react';
import { displayRole, searchClient } from '../search/search-client';
import type { Product, StringEntry } from '../string-index';
import { Icon } from './Icon';
import { isPlaceholder } from './LayerRow';
import { Menu } from './Menu';

const PAGE = 20;

/** Product a page belongs to; `null` until guessed or chosen. */
export type Scope = string | null;

/** Leaf of a variable name: the developer key. */
export const keyOf = (name: string) => name.slice(name.lastIndexOf('/') + 1);

type Section = { id: string; title: string; count: number; items: StringEntry[]; more: boolean };

/** Strings around `key` in its legacy order, so the likely next string is one keystroke away. */
function neighbours(
  key: string | null,
  sequences: SequenceSource,
  entries: ReadonlyMap<string, StringEntry>,
): { items: StringEntry[]; next: string | null } {
  const position = key ? sequences.positions.get(key)?.[0] : undefined;
  if (!position) return { items: [], next: null };
  const keys = sequences.sequences.get(position.sequence) ?? [];
  const items = keys
    .slice(Math.max(0, position.index - 2), position.index + 12)
    .map((item) => entries.get(item))
    .filter((item): item is StringEntry => !!item);
  return { items, next: keys[position.index + 1] ?? null };
}

function Highlight({ text, tokens }: { text: string; tokens: readonly string[] }) {
  if (!tokens.length || !text) return <>{text}</>;
  const lower = normalizeForSearch(text);
  // NFKD can change length; only highlight when positions still line up.
  if (lower.length !== text.length) return <>{text}</>;
  const marks = new Array<boolean>(text.length).fill(false);
  for (const token of tokens) {
    let index = lower.indexOf(token);
    while (index !== -1 && token) {
      for (let i = index; i < index + token.length; i += 1) marks[i] = true;
      index = lower.indexOf(token, index + token.length);
    }
  }
  const parts: { text: string; mark: boolean }[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const last = parts.at(-1);
    if (last && last.mark === marks[i]) last.text += text[i];
    else parts.push({ text: text[i]!, mark: marks[i]! });
  }
  return (
    <>
      {parts.map((part, i) =>
        part.mark ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>,
      )}
    </>
  );
}

export function SearchPanel(props: {
  canvasText: string;
  layerName: string;
  contextNames: readonly string[];
  current: StringEntry | undefined;
  currentKey: string | null;
  anchorHint: string | null;
  list: readonly StringEntry[];
  entries: ReadonlyMap<string, StringEntry>;
  sequences: SequenceSource;
  used: ReadonlySet<string>;
  scope: Scope;
  /** Feature (stream inside the product) guessed for this frame; boosts its strings. */
  feature: string | null;
  products: readonly Product[];
  onScope: (scope: string) => void;
  onPick: (key: string) => void;
  /** Loads values of library strings shown before their values arrived. */
  onResolve: (keys: readonly string[]) => void;
  /** Starts new copy for this layer, prefilled from the canvas. */
  onCreateNew?: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  const [showRelated, setShowRelated] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Other products stay out unless the writer asks; it resets each time search opens.
  const [wide, setWide] = useState(false);
  const product = wide ? null : props.scope;
  const blocked = props.scope === null && !wide;

  useEffect(() => {
    input.current?.focus();
  }, [props.scope, wide]);
  useEffect(() => {
    setLimit(PAGE);
    setShowRelated(false);
  }, [query, product]);

  const near = useMemo(() => {
    const near = neighbours(props.currentKey ?? props.anchorHint, props.sequences, props.entries);
    return {
      ...near,
      items: blocked ? [] : near.items.filter((item) => inProduct(item, product)),
    };
  }, [props.currentKey, props.anchorHint, props.sequences, props.entries, blocked, product]);

  // Ranking runs in a worker; the panel keeps showing the last answer until the next arrives.
  const [answer, setAnswer] = useState<{ query: string; result: SearchResult } | null>(null);
  const searched = queryTokens(query).length > 0 && !blocked;
  useEffect(() => {
    if (!searched) return setAnswer(null);
    let live = true;
    void searchClient()
      .search({
        query,
        scope: product,
        feature: product ? props.feature : null,
        used: [...props.used],
        context: [props.layerName, ...props.contextNames],
        layerText: isPlaceholder(props.canvasText) ? '' : props.canvasText,
        role: roleOf([props.layerName, ...props.contextNames]),
        nearby: near.items.map((item) => item.key),
        currentKey: props.currentKey,
        limit,
        related: showRelated,
      })
      .then((result) => {
        if (live && result) setAnswer({ query, result });
      });
    return () => {
      live = false;
    };
  }, [
    searched,
    query,
    product,
    props.feature,
    props.used,
    props.contextNames,
    props.layerName,
    props.canvasText,
    props.currentKey,
    near.items,
    limit,
    showRelated,
    // A new list (values arrived, catalog synced) can change the answer.
    props.list,
  ]);
  const shown = searched ? answer : null;
  const result = shown?.result;
  const deferred = shown?.query ?? query;
  const caughtUp = !searched || answer?.query === query;
  const tokens = useMemo(() => queryTokens(deferred), [deferred]);
  const details = useMemo(
    () =>
      new Map<string, MatchDetail>(
        [...(result?.best ?? []), ...(result?.related ?? [])].map((hit) => [hit.key, hit]),
      ),
    [result],
  );
  const entriesOf = (hits: readonly { key: string }[]) =>
    hits.flatMap((hit) => props.entries.get(hit.key) ?? []);
  const strong = !!result?.strong;
  const relatedCount = result?.relatedCount ?? 0;

  const sections: Section[] = useMemo(() => {
    if (!tokens.length)
      return near.items.length
        ? [{ id: 'near', title: 'In legacy order', count: 0, items: near.items, more: false }]
        : [];
    const out: Section[] = [];
    if (result?.bestCount)
      out.push({
        id: 'scope',
        title: product ? `${productLabel(product)} + shared` : 'All products',
        count: result.bestCount,
        items: entriesOf(result.best),
        more: result.bestCount > result.best.length,
      });
    if (showRelated && result?.relatedCount)
      out.push({
        id: 'related',
        title: 'More keyword matches',
        count: result.relatedCount,
        items: entriesOf(result.related),
        more: result.relatedCount > result.related.length,
      });
    return out;
  }, [tokens, near, result, product, showRelated, props.entries]);

  const flat = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const initialActive = useMemo(() => {
    let index = tokens.length ? -1 : flat.findIndex((item) => item.key === props.currentKey);
    if (index === -1 && !tokens.length) index = flat.findIndex((item) => item.key === near.next);
    return index === -1 ? 0 : index;
  }, [flat, props.currentKey, tokens.length, near.next]);
  useEffect(() => setActive(initialActive), [initialActive, deferred, product]);

  // Library strings outside the registry load their values once someone sees them.
  const { onResolve } = props;
  useEffect(() => {
    const missing = flat.filter((item) => !item.loaded).map((item) => item.key);
    if (missing.length) onResolve(missing);
  }, [flat, onResolve]);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // Enter pressed before results caught up with typing picks once they do.
  const pendingPick = useRef(false);
  useEffect(() => {
    if (!pendingPick.current || !caughtUp) return;
    pendingPick.current = false;
    if (flat[initialActive]) props.onPick(flat[initialActive]!.key);
  });

  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.target as HTMLElement).closest('button') && event.key !== 'Escape') return;
    if (event.key === 'ArrowDown')
      setActive((value) => Math.max(0, Math.min(flat.length - 1, value + 1)));
    else if (event.key === 'ArrowUp') setActive((value) => Math.max(0, value - 1));
    else if (event.key === 'Enter' && !caughtUp) pendingPick.current = true;
    else if (event.key === 'Enter' && flat[active]) props.onPick(flat[active]!.key);
    else if (event.key === 'Escape') {
      if (query) setQuery('');
      else props.onClose();
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const activeItem = flat[active];
  const canvasQuiet = isPlaceholder(props.canvasText);
  let index = -1;

  return (
    <section
      className="search"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a string"
      onKeyDown={onKeyDown}
    >
      <header className="search__head">
        <button
          type="button"
          className="icon-button"
          onClick={props.onClose}
          aria-label="Back to layers"
          title="Back  esc"
        >
          <Icon name="back" />
        </button>
        <div className="search__layer">
          <span className="eyebrow">Choose a library string</span>
          <span className={`search__canvas ${canvasQuiet ? 'is-placeholder' : ''}`}>
            {props.canvasText || 'Empty text'}
          </span>
          <span className="search__sub">
            {props.layerName}
            {props.current?.loaded && (
              <>
                {' · now '}
                <span className="search__now">{props.current.en || props.current.id}</span>
              </>
            )}
          </span>
        </div>
      </header>

      <div className="search__bar">
        <div className="search__scope">
          <span className="eyebrow">Product</span>
          <Menu
            triggerClassName={`scope ${props.scope === null ? 'scope--unset' : ''}`}
            triggerLabel="Change search product stream"
            title="Search strings in"
            align="end"
            items={[
              ...props.products
                .filter((item) => item.id !== SHARED_PRODUCT)
                .map((item) => ({
                  id: item.id,
                  label: productLabel(item.id),
                  checked: item.id === props.scope,
                  onSelect: () => {
                    setWide(false);
                    props.onScope(item.id);
                  },
                })),
            ]}
            trigger={() => (
              <>
                <span className="scope__label">
                  {wide
                    ? 'All products'
                    : props.scope === null
                      ? 'Choose product'
                      : `${productLabel(props.scope)} + shared`}
                </span>
                <Icon name="chevron" />
              </>
            )}
          />
        </div>
        <label className="field">
          <Icon name="search" />
          <input
            ref={input}
            type="text"
            placeholder="Search copy, key, ID or context"
            aria-label="Search copy, key, ID or context"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls="search-results"
            aria-activedescendant={activeItem ? `result-${active}` : undefined}
            spellCheck={false}
          />
          {query && (
            <button
              type="button"
              className="field__clear"
              aria-label="Clear search"
              onClick={() => {
                setQuery('');
                input.current?.focus();
              }}
            >
              <Icon name="close" />
            </button>
          )}
        </label>
      </div>

      <div className="search__results" id="search-results" role="listbox" ref={listRef}>
        {blocked && (
          <div className="prompt">
            <p className="prompt__title">Which product is this page?</p>
            <p className="prompt__text">
              Search shows only this product and shared copy. Every frame on this page uses your
              choice, and you can change it any time.
            </p>
            <div className="chips">
              {props.products
                .filter((item) => item.id !== SHARED_PRODUCT)
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="chip"
                    onClick={() => props.onScope(item.id)}
                  >
                    {productLabel(item.id)}
                  </button>
                ))}
              <button type="button" className="chip chip--ghost" onClick={() => setWide(true)}>
                Search all products
              </button>
            </div>
          </div>
        )}

        {!tokens.length && !sections.length && !blocked && (
          <div className="empty">
            <p>Type to search copy, keys, IDs or screen context.</p>
            {props.onCreateNew && (
              <div className="empty__actions">
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={props.onCreateNew}
                >
                  Write new copy
                </button>
              </div>
            )}
          </div>
        )}
        {!blocked && tokens.length > 0 && result?.total === 0 && (
          <div className="empty">
            <p>
              No string matches “{deferred}”
              {product ? ` in ${productLabel(product)} or shared copy` : ''}.
            </p>
            <div className="empty__actions">
              {product && (
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => setWide(true)}
                >
                  Search all products
                </button>
              )}
              {props.onCreateNew && (
                <button
                  type="button"
                  className="button button--primary"
                  onClick={props.onCreateNew}
                >
                  Write new copy
                </button>
              )}
            </div>
          </div>
        )}

        {sections.map((section) => (
          <div key={section.id} className={`search__group search__group--${section.id}`}>
            <h3>
              <span>{section.title}</span>
              {section.count > 0 && <span className="count">{section.count.toLocaleString()}</span>}
            </h3>
            {section.items.map((item) => {
              index += 1;
              const i = index;
              const isCurrent = item.key === props.currentKey;
              const isNext = section.id === 'near' && item.key === near.next;
              return (
                <div
                  key={`${section.id}-${item.key}`}
                  id={`result-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  className={`result ${i === active ? 'is-active' : ''} ${isCurrent ? 'is-current' : ''}`}
                  onPointerMove={() => i !== active && setActive(i)}
                  onClick={() => props.onPick(item.key)}
                >
                  <div className="result__header">
                    <span className="result__product">
                      {productLabel(item.product)} · {displayRole(item) || 'text'}
                    </span>
                    <span className="result__badges">
                      {tokens.length > 0 && i === 0 && strong && (
                        <span className="tag tag--suggested">Top match</span>
                      )}
                      {isCurrent && <span className="tag tag--picked">Current</span>}
                      {isNext && <span className="tag tag--suggested">Next</span>}
                      {!isCurrent && props.used.has(item.key) && (
                        <span className="tag">On this page</span>
                      )}
                      {!isNext &&
                        near.items.some((n) => n.key === item.key) &&
                        tokens.length > 0 && <span className="tag">Same flow</span>}
                      {product &&
                        props.feature &&
                        details.get(item.key)?.reasons.includes('Same feature') && (
                          <span className="tag tag--feature">Same feature</span>
                        )}
                    </span>
                  </div>
                  <span className="result__en">
                    <span className="locale-label">EN</span>
                    {item.loaded ? (
                      <Highlight text={item.en || item.id || '—'} tokens={tokens} />
                    ) : (
                      <span className="shimmer">Loading string…</span>
                    )}
                  </span>
                  {item.loaded && item.id && item.en && (
                    <span className="result__id">
                      <span className="locale-label">ID</span>
                      <Highlight text={item.id} tokens={tokens} />
                    </span>
                  )}
                  <span className="result__meta">
                    <span className="result__path">
                      <Highlight text={item.path} tokens={tokens} />
                    </span>
                  </span>
                  <span className="result__key mono" title={item.name}>
                    <Highlight text={keyOf(item.name)} tokens={tokens} />
                  </span>
                  {tokens.length > 0 && (
                    <span className="result__hints">
                      {details
                        .get(item.key)
                        ?.reasons.filter(
                          (reason) =>
                            !['Same feature', 'Same flow', 'On this page', 'Current'].includes(
                              reason,
                            ),
                        )
                        .slice(0, 2)
                        .join(' · ')}
                      {(details.get(item.key)?.duplicates ?? 0) > 1 &&
                        ` · ${details.get(item.key)!.duplicates} identical copies`}
                    </span>
                  )}
                </div>
              );
            })}
            {section.more && (
              <button
                type="button"
                className="search__more"
                onClick={() => setLimit((current) => current + PAGE)}
              >
                Show {Math.min(PAGE, section.count - section.items.length)} more
              </button>
            )}
          </div>
        ))}
        {tokens.length > 0 && strong && relatedCount > 0 && !showRelated && (
          <button type="button" className="search__more" onClick={() => setShowRelated(true)}>
            Show {relatedCount} more keyword matches
          </button>
        )}
        {tokens.length > 0 && !!result?.total && (
          <div className="search__widen">
            {product ? (
              <button type="button" className="link-button" onClick={() => setWide(true)}>
                Not here? Search all products
              </button>
            ) : (
              props.scope && (
                <button type="button" className="link-button" onClick={() => setWide(false)}>
                  Back to {productLabel(props.scope)} + shared
                </button>
              )
            )}
            {props.onCreateNew && (
              <button type="button" className="link-button" onClick={props.onCreateNew}>
                Write new copy instead
              </button>
            )}
          </div>
        )}
      </div>

      <footer className="search__foot">
        {activeItem ? (
          <span className="search__selection">
            <span className="eyebrow">Selected key</span>
            <span className="search__key mono" title={activeItem.copyId || activeItem.name}>
              {keyOf(activeItem.name)}
            </span>
          </span>
        ) : (
          <span />
        )}
        <button
          type="button"
          className="button button--primary"
          disabled={!activeItem}
          onClick={() => activeItem && props.onPick(activeItem.key)}
        >
          Choose string <kbd>↵</kbd>
        </button>
      </footer>
    </section>
  );
}
