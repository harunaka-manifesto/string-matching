import { normalizeForSearch, searchVariables, type SequenceSource } from '@string-binder/domain';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { StringEntry } from '../string-index';

const RESULT_LIMIT = 200;

type Section = { title: string; items: StringEntry[] };

/** Strings around `key` in its legacy order, so the likely neighbour is one click away. */
function neighbours(
  key: string | null,
  sequences: SequenceSource,
  entries: ReadonlyMap<string, StringEntry>,
): StringEntry[] {
  const position = key ? sequences.positions.get(key)?.[0] : undefined;
  if (!position) return [];
  const keys = sequences.sequences.get(position.sequence) ?? [];
  return keys
    .slice(Math.max(0, position.index - 3), position.index + 10)
    .map((item) => entries.get(item))
    .filter((item): item is StringEntry => !!item);
}

function Highlight({ text, tokens }: { text: string; tokens: readonly string[] }) {
  if (!tokens.length || !text) return <>{text}</>;
  const lower = normalizeForSearch(text);
  const marks = new Array<boolean>(text.length).fill(false);
  for (const token of tokens) {
    let index = lower.indexOf(token);
    while (index !== -1 && token) {
      for (let i = index; i < index + token.length && i < marks.length; i += 1) marks[i] = true;
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
  layerText: string;
  currentKey: string | null;
  anchorHint: string | null;
  list: readonly StringEntry[];
  entries: ReadonlyMap<string, StringEntry>;
  collections: readonly string[];
  sequences: SequenceSource;
  context: readonly string[];
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);

  const tokens = useMemo(
    () => normalizeForSearch(deferred).split(/\s+/u).filter(Boolean),
    [deferred],
  );
  const { sections, total } = useMemo(() => {
    if (!tokens.length) {
      const near = neighbours(props.currentKey ?? props.anchorHint, props.sequences, props.entries);
      return {
        sections: near.length ? [{ title: 'In legacy order', items: near }] : [],
        total: near.length,
      };
    }
    const groups = searchVariables(props.list, deferred, {
      haystack: (item) => item.haystack,
      context: props.context,
      collectionOrder: props.collections,
    });
    const result: Section[] = [];
    let count = 0;
    let shown = 0;
    for (const group of groups) {
      count += group.items.length;
      if (shown >= RESULT_LIMIT) continue;
      const items = group.items.slice(0, RESULT_LIMIT - shown);
      shown += items.length;
      result.push({
        title: group.group ? `${group.collection} › ${group.group}` : group.collection,
        items,
      });
    }
    return { sections: result, total: count };
  }, [
    tokens,
    deferred,
    props.list,
    props.context,
    props.collections,
    props.currentKey,
    props.anchorHint,
    props.sequences,
    props.entries,
  ]);

  const flat = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  useEffect(() => {
    const current = flat.findIndex((item) => item.key === props.currentKey);
    setActive(current === -1 ? 0 : current);
  }, [flat, props.currentKey]);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((value) => Math.min(flat.length - 1, value + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((value) => Math.max(0, value - 1));
    } else if (event.key === 'Enter' && flat[active]) {
      event.preventDefault();
      props.onPick(flat[active]!.key);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      props.onClose();
    }
  };

  let index = -1;
  return (
    <section className="search" aria-label="Choose a string">
      <header className="search__head">
        <button type="button" className="text-button" onClick={props.onClose}>
          ← Back
        </button>
        <span className="search__layer" title={props.layerText}>
          {props.layerText}
        </span>
      </header>
      <input
        ref={input}
        className="search__input"
        type="search"
        placeholder="Search name, EN or ID value"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded="true"
        aria-controls="search-results"
        aria-activedescendant={flat[active] ? `result-${active}` : undefined}
      />
      <div className="search__results" id="search-results" role="listbox" ref={listRef}>
        {!tokens.length && !sections.length && (
          <p className="empty">Type to search every string by name, EN or ID value.</p>
        )}
        {tokens.length > 0 && total === 0 && (
          <p className="empty">
            No strings match “{deferred}”. Flag the layer if it needs a new string.
          </p>
        )}
        {sections.map((section) => (
          <div key={section.title} className="search__group">
            <h3>{section.title}</h3>
            {section.items.map((item) => {
              index += 1;
              const i = index;
              return (
                <div
                  key={`${section.title}-${item.key}-${i}`}
                  id={`result-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  className={`result ${i === active ? 'is-active' : ''} ${item.key === props.currentKey ? 'is-current' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => props.onPick(item.key)}
                >
                  <span className="result__en">
                    <Highlight
                      text={item.loaded ? item.en || '—' : 'Loading value…'}
                      tokens={tokens}
                    />
                  </span>
                  {item.loaded && item.id && (
                    <span className="result__id">
                      <Highlight text={item.id} tokens={tokens} />
                    </span>
                  )}
                  <span className="result__name">
                    <Highlight text={item.name} tokens={tokens} />
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        {total > RESULT_LIMIT && (
          <p className="empty">
            Showing {RESULT_LIMIT} of {total.toLocaleString()} matches. Keep typing to narrow down.
          </p>
        )}
      </div>
    </section>
  );
}
