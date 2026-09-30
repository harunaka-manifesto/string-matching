import {
  normalizeForSearch,
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

const PAGE = 60;

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
  const [limits, setLimits] = useState({ scope: PAGE, other: 12 });
  // Widening to every product is for this search only; the frame keeps its product.
  const [wide, setWide] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const frameProduct = props.scope && props.scope !== 'all' ? props.scope : null;
  const product = wide ? null : frameProduct;

  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => setLimits({ scope: PAGE, other: 12 }), [deferred, product]);

  const tokens = useMemo(() => queryTokens(deferred), [deferred]);
  const near = useMemo(
    () => neighbours(props.currentKey ?? props.anchorHint, props.sequences, props.entries),
    [props.currentKey, props.anchorHint, props.sequences, props.entries],
  );
  const ranked = useMemo(
    () =>
      rankStrings(props.list, deferred, {
        fields: (item) => item.fields,
        scope: product,
        used: props.used,
      }),
    [props.list, deferred, product, props.used],
  );

  const sections: Section[] = useMemo(() => {
    if (!tokens.length)
      return near.items.length
        ? [{ id: 'near', title: 'In legacy order', count: 0, items: near.items, more: false }]
        : [];
    const result: Section[] = [];
    if (ranked.inScope.length)
      result.push({
        id: 'scope',
        title: product ? `${productLabel(product)} + shared` : 'All products',
        count: ranked.inScope.length,
        items: ranked.inScope.slice(0, limits.scope),
        more: ranked.inScope.length > limits.scope,
      });
    if (ranked.other.length)
      result.push({
        id: 'other',
        title: 'Other products',
        count: ranked.other.length,
        items: ranked.other.slice(0, limits.other),
        more: ranked.other.length > limits.other,
      });
    return result;
  }, [tokens, near, ranked, product, limits]);

  const flat = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const initialActive = useMemo(() => {
    let index = flat.findIndex((item) => item.key === props.currentKey);
    if (index === -1 && !tokens.length) index = flat.findIndex((item) => item.key === near.next);
    return index === -1 ? 0 : index;
  }, [flat, props.currentKey, tokens.length, near.next]);
  useEffect(() => setActive(initialActive), [initialActive]);
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
    if (flat[initialActive]) props.onPick(flat[initialActive]!.key);
  });

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') setActive((value) => Math.min(flat.length - 1, value + 1));
    else if (event.key === 'ArrowUp') setActive((value) => Math.max(0, value - 1));
    else if (event.key === 'Enter' && deferred !== query) pendingPick.current = true;
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
    <section className="search" aria-label="Choose a string" onKeyDown={onKeyDown}>
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
        <label className="field">
          <Icon name="search" />
          <input
            ref={input}
            type="text"
            placeholder="Search EN, ID or key"
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
        {frameProduct && (
          <div className="scope-toggle" role="radiogroup" aria-label="Search in">
            <button
              type="button"
              role="radio"
              aria-checked={!wide}
              className={`scope-toggle__item ${!wide ? 'is-on' : ''}`}
              onClick={() => setWide(false)}
            >
              {productLabel(frameProduct)}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={wide}
              className={`scope-toggle__item ${wide ? 'is-on' : ''}`}
              onClick={() => setWide(true)}
            >
              All products
            </button>
          </div>
        )}
      </div>

      <div className="search__results" id="search-results" role="listbox" ref={listRef}>
        {props.scope === null && (
          <div className="prompt">
            <p className="prompt__title">Which product is this frame?</p>
            <p className="prompt__text">
              Strings from it rank first, and suggestions stay inside it. You can change this at the
              top any time.
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
          <p className="empty">Type to search every string by EN, ID or key.</p>
        )}
        {tokens.length > 0 && ranked.total === 0 && (
          <div className="empty">
            <p>No string matches “{deferred}”.</p>
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
                  onClick={() => props.onPick(item.key)}
                >
                  <span className="result__en">
                    {item.loaded ? (
                      <Highlight text={item.en || item.id || '—'} tokens={tokens} />
                    ) : (
                      <span className="shimmer">Loading string…</span>
                    )}
                  </span>
                  {item.loaded && item.id && item.en && (
                    <span className="result__id">
                      <Highlight text={item.id} tokens={tokens} />
                    </span>
                  )}
                  <span className="result__meta">
                    {(section.id === 'other' || item.product === SHARED_PRODUCT || !product) && (
                      <span className="result__product">{productLabel(item.product)}</span>
                    )}
                    <span className="result__path">{item.path}</span>
                  </span>
                  <span className="result__badges">
                    {isCurrent && <span className="tag tag--picked">Current</span>}
                    {isNext && <span className="tag tag--suggested">Next</span>}
                    {!isCurrent && props.used.has(item.key) && <span className="tag">On page</span>}
                  </span>
                </div>
              );
            })}
            {section.more && (
              <button
                type="button"
                className="search__more"
                onClick={() =>
                  setLimits((current) =>
                    section.id === 'other'
                      ? { ...current, other: current.other + PAGE }
                      : { ...current, scope: current.scope + PAGE },
                  )
                }
              >
                Show {Math.min(PAGE, section.count - section.items.length)} more
              </button>
            )}
          </div>
        ))}
      </div>

      <footer className="search__foot">
        {activeItem ? (
          <span className="search__key mono" title={activeItem.name}>
            {activeItem.name}
          </span>
        ) : (
          <span />
        )}
        <span className="keys">
          <kbd>↑</kbd>
          <kbd>↓</kbd> move <kbd>↵</kbd> pick <kbd>esc</kbd> back
        </span>
      </footer>
    </section>
  );
}
