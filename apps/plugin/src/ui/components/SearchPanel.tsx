import {
  normalizeForSearch,
  normalizedFields,
  inProduct,
  roleOf,
  productLabel,
  queryTokens,
  rankStrings,
  SHARED_PRODUCT,
  type SequenceSource,
} from '@string-binder/domain';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Product, StringEntry } from '../string-index';
import { Icon } from './Icon';
import { isPlaceholder } from './LayerRow';
import { Menu } from './Menu';

const PAGE = 20;

/** `null`: not chosen yet. `'all'`: the writer chose every product. */
export type Scope = string | 'all' | null;

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
  products: readonly Product[];
  onScope: (scope: Exclude<Scope, null>) => void;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [active, setActive] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  const [showRelated, setShowRelated] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const product = props.scope && props.scope !== 'all' ? props.scope : null;

  useEffect(() => {
    input.current?.focus();
  }, [props.scope]);
  useEffect(() => {
    setLimit(PAGE);
    setShowRelated(false);
  }, [deferred, product]);

  const tokens = useMemo(() => queryTokens(deferred), [deferred]);
  const near = useMemo(() => {
    const near = neighbours(props.currentKey ?? props.anchorHint, props.sequences, props.entries);
    return {
      ...near,
      items: props.scope === null ? [] : near.items.filter((item) => inProduct(item, product)),
    };
  }, [props.currentKey, props.anchorHint, props.sequences, props.entries, props.scope, product]);
  const ranked = useMemo(
    () =>
      rankStrings(props.scope === null ? [] : props.list, deferred, {
        fields: (item) => {
          const contexts = item.contexts.filter(
            (context) => !product || context.product === product,
          );
          return contexts.length
            ? normalizedFields({
                ...item,
                path: contexts.map((context) => context.path).join(' '),
                role: contexts.find((context) => context.role !== 'text')?.role ?? item.fields.role,
              })
            : item.fields;
        },
        scope: product,
        used: props.used,
        context: [props.layerName, ...props.contextNames],
        layerText: isPlaceholder(props.canvasText) ? '' : props.canvasText,
        role: roleOf([props.layerName, ...props.contextNames]),
        nearby: new Set(near.items.map((item) => item.key)),
        currentKey: props.currentKey,
        identity: (item) =>
          item.loaded && item.en && item.id ? JSON.stringify([item.en, item.id]) : null,
      }),
    [
      props.list,
      deferred,
      product,
      props.used,
      props.scope,
      props.contextNames,
      props.layerName,
      props.canvasText,
      props.currentKey,
      near.items,
    ],
  );

  const strong = useMemo(
    () => ranked.inScope.filter((item) => (ranked.details.get(item.key)?.score ?? 0) >= 1200),
    [ranked],
  );
  const related = strong.length
    ? ranked.inScope.filter((item) => (ranked.details.get(item.key)?.score ?? 0) < 1200)
    : [];
  const sections: Section[] = useMemo(() => {
    if (!tokens.length)
      return near.items.length
        ? [{ id: 'near', title: 'In legacy order', count: 0, items: near.items, more: false }]
        : [];
    const result: Section[] = [];
    const best = strong.length ? strong : ranked.inScope;
    if (best.length)
      result.push({
        id: 'scope',
        title: product ? `${productLabel(product)} + shared` : 'All products',
        count: best.length,
        items: best.slice(0, limit),
        more: best.length > limit,
      });
    if (showRelated && related.length)
      result.push({
        id: 'related',
        title: 'More keyword matches',
        count: related.length,
        items: related.slice(0, limit),
        more: related.length > limit,
      });
    return result;
  }, [tokens, near, ranked, product, limit, strong, related, showRelated]);

  const flat = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const initialActive = useMemo(() => {
    let index = tokens.length ? -1 : flat.findIndex((item) => item.key === props.currentKey);
    if (index === -1 && !tokens.length) index = flat.findIndex((item) => item.key === near.next);
    return index === -1 ? 0 : index;
  }, [flat, props.currentKey, tokens.length, near.next]);
  useEffect(() => setActive(initialActive), [initialActive, deferred, product]);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // Enter pressed before results caught up with typing picks once they do.
  const pendingPick = useRef(false);
  useEffect(() => {
    if (!pendingPick.current || deferred !== query) return;
    pendingPick.current = false;
    if (flat[initialActive]?.loaded) props.onPick(flat[initialActive]!.key);
  });

  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.target as HTMLElement).closest('button') && event.key !== 'Escape') return;
    if (event.key === 'ArrowDown')
      setActive((value) => Math.max(0, Math.min(flat.length - 1, value + 1)));
    else if (event.key === 'ArrowUp') setActive((value) => Math.max(0, value - 1));
    else if (event.key === 'Enter' && deferred !== query) pendingPick.current = true;
    else if (event.key === 'Enter' && flat[active]?.loaded) props.onPick(flat[active]!.key);
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
          <span className="eyebrow">Product stream</span>
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
                  onSelect: () => props.onScope(item.id),
                })),
              {
                id: 'all',
                label: 'All products',
                checked: props.scope === 'all',
                separatorBefore: true,
                onSelect: () => props.onScope('all'),
              },
            ]}
            trigger={() => (
              <>
                <span className="scope__label">
                  {props.scope === null
                    ? 'Choose product'
                    : product
                      ? `${productLabel(product)} + shared`
                      : 'All products'}
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
        {props.scope === null && (
          <div className="prompt">
            <p className="prompt__title">Which product is this frame?</p>
            <p className="prompt__text">
              Search and suggestions show only this product and shared copy. Change the product
              stream above any time.
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
              <button
                type="button"
                className="chip chip--ghost"
                onClick={() => props.onScope('all')}
              >
                All products
              </button>
            </div>
          </div>
        )}

        {!tokens.length && !sections.length && props.scope !== null && (
          <p className="empty">Type to search copy, keys, IDs or screen context.</p>
        )}
        {props.scope !== null && tokens.length > 0 && ranked.total === 0 && (
          <div className="empty">
            <p>
              No string matches “{deferred}”
              {product ? ` in ${productLabel(product)} or shared copy` : ''}.
            </p>
            <p className="empty__hint">If this copy is new, go back and flag the layer (F).</p>
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
                  aria-disabled={!item.loaded}
                  onClick={() => item.loaded && props.onPick(item.key)}
                >
                  <div className="result__header">
                    <span className="result__product">
                      {productLabel(item.product)} · {item.fields.role || 'text'}
                    </span>
                    <span className="result__badges">
                      {tokens.length > 0 && i === 0 && strong.length > 0 && (
                        <span className="tag tag--suggested">Top match</span>
                      )}
                      {isCurrent && <span className="tag tag--picked">Current</span>}
                      {isNext && <span className="tag tag--suggested">Next</span>}
                      {!isCurrent && props.used.has(item.key) && (
                        <span className="tag">On page</span>
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
                    <Highlight text={item.name} tokens={tokens} />
                  </span>
                  {tokens.length > 0 && (
                    <span className="result__hints">
                      {ranked.details.get(item.key)?.reasons.slice(0, 3).join(' · ')}
                      {(ranked.details.get(item.key)?.duplicates ?? 0) > 1 &&
                        ` · ${ranked.details.get(item.key)!.duplicates} identical copies`}
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
        {tokens.length > 0 && related.length > 0 && !showRelated && (
          <button type="button" className="search__more" onClick={() => setShowRelated(true)}>
            Show {related.length} more keyword matches
          </button>
        )}
      </div>

      <footer className="search__foot">
        {activeItem ? (
          <span className="search__selection">
            <span className="eyebrow">Selected string</span>
            <span className="search__key mono" title={activeItem.copyId || activeItem.name}>
              {activeItem.copyId || activeItem.name}
            </span>
          </span>
        ) : (
          <span />
        )}
        <button
          type="button"
          className="button button--primary"
          disabled={!activeItem?.loaded}
          onClick={() => activeItem?.loaded && props.onPick(activeItem.key)}
        >
          Choose string <kbd>↵</kbd>
        </button>
      </footer>
    </section>
  );
}
