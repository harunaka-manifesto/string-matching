import type {
  ApplySummary,
  SelectionInfo,
  ApplyPreview,
  LayerDecision,
} from '@string-binder/contracts';
import {
  filterSequenceSource,
  guessProduct,
  productLabel,
  inProduct,
  SHARED_PRODUCT,
} from '@string-binder/domain';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { request } from './workflow-client';
import type { UiBridge } from './bridge';
import { Icon } from './components/Icon';
import { LayerRow, rowKind, type RowKind } from './components/LayerRow';
import { Menu, type MenuItem } from './components/Menu';
import { SearchPanel, type Scope } from './components/SearchPanel';
import { SummaryPanel } from './components/SummaryPanel';
import { decisionsFor, useFrameRows, type ResolvedRow } from './frame-rows';
import { useStringIndex, type IndexStatus } from './string-index';

type Toast = { id: number; text: string; tone: 'info' | 'error' };

/** Keeps a panel mounted while its closing animation runs. */
function usePresence(open: boolean, ms = 180): boolean {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(timer);
  }, [open, ms]);
  return open || mounted;
}

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return (
    !!element &&
    (element.tagName === 'INPUT' ||
      element.tagName === 'TEXTAREA' ||
      element.isContentEditable ||
      !!element.closest('.menu__panel'))
  );
}

function IndexNotice({ status, onRefresh }: { status: IndexStatus; onRefresh: () => void }) {
  switch (status.phase) {
    case 'starting':
    case 'listing':
      return <p className="notice">Checking the library for new strings…</p>;
    case 'importing':
      return (
        <p className="notice">
          Loading strings {status.done.toLocaleString()} / {status.total.toLocaleString()}
          <span className="notice__hint"> · you can start while this runs</span>
        </p>
      );
    case 'empty':
      return (
        <p className="notice notice--warning">
          No string library is on. In Assets › Libraries, turn on GoPay Strings, then{' '}
          <button type="button" className="link-button" onClick={onRefresh}>
            check again
          </button>
          .
        </p>
      );
    case 'ready':
      return status.failed ? (
        <p className="notice notice--warning">
          {status.failed.toLocaleString()} strings could not load.{' '}
          <button type="button" className="link-button" onClick={onRefresh}>
            Retry
          </button>
        </p>
      ) : null;
  }
}

/** How far each suggested row sits below the string it follows, for the cascade animation. */
function cascadeOf(rows: readonly ResolvedRow[]): number[] {
  let run = 0;
  return rows.map((row) => {
    run = row.source === 'sequence' ? run + 1 : 0;
    return run;
  });
}

export function App({ bridge, active = true }: { bridge: UiBridge; active?: boolean }) {
  const index = useStringIndex(bridge);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [searchFor, setSearchFor] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [review, setReview] = useState<{
    frameId: string;
    decisions: LayerDecision[];
    preview: ApplyPreview;
  } | null>(null);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<{ summary: ApplySummary; frameName: string } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [used, setUsed] = useState<ReadonlySet<string>>(() => new Set());
  const [scopes, setScopes] = useState<ReadonlyMap<string, Exclude<Scope, null>>>(() => new Map());
  const appliedFrame = useRef('');
  const selectedFrame = useRef<string | null>(null);
  selectedFrame.current = selection?.frameId ?? null;

  const say = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    setToast({ id: Date.now(), text, tone });
  }, []);

  useEffect(
    () =>
      bridge.subscribe((event) => {
        switch (event.type) {
          case 'selection':
            setSelection(event.selection);
            setReview(null);
            setSearchFor(null);
            return;
          case 'apply:done':
            setApplying(false);
            setResult({ summary: event.summary, frameName: appliedFrame.current });
            return;
          case 'usage':
            setUsed(new Set(event.keys));
            return;
          case 'flags:selected':
            say(
              event.count
                ? `Selected ${event.count} flagged layer${event.count === 1 ? '' : 's'} on this page.`
                : 'No flagged layers on this page.',
            );
            return;
          case 'error':
            setApplying(false);
            say(event.message, 'error');
            return;
          default:
            return;
        }
      }),
    [bridge, say],
  );
  useEffect(() => {
    bridge.send({ type: 'ui:ready' });
  }, [bridge]);
  useEffect(() => {
    if (!toast || toast.tone === 'error') return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  // Product: the writer's choice for this frame, else a guess from bound strings and names.
  const guess = useMemo(
    () =>
      selection
        ? guessProduct({
            boundNames: selection.layers.flatMap((layer) => {
              const entry = layer.boundKey ? index.entries.get(layer.boundKey) : undefined;
              return entry?.product
                ? [`${entry.product}/${entry.name}`]
                : layer.boundName
                  ? [layer.boundName]
                  : [];
            }),
            contextNames: selection.contextNames,
            vocabulary: index.vocabulary,
          })
        : null,
    [selection, index.vocabulary, index.entries],
  );
  const chosen = selection ? scopes.get(selection.frameId) : undefined;
  const scope: Scope = chosen ?? guess;
  const setScope = (next: Exclude<Scope, null>) => {
    if (!selection) return;
    setScopes((current) => new Map(current).set(selection.frameId, next));
  };

  const sequences = useMemo(() => {
    if (scope === 'all') return index.sequences;
    if (!scope) return filterSequenceSource(index.sequences, () => false);
    return filterSequenceSource(index.sequences, (key) => {
      const item = index.entries.get(key);
      return !!item && inProduct(item, scope);
    });
  }, [scope, index.sequences, index.entries]);

  const frame = useFrameRows(selection, sequences);
  const rows = frame.rows;
  const kinds = useMemo(() => rows.map(rowKind), [rows]);
  const cascade = useMemo(() => cascadeOf(rows), [rows]);

  const counts = useMemo(() => {
    const result: Record<RowKind, number> = {
      bound: 0,
      picked: 0,
      suggested: 0,
      replace: 0,
      unbind: 0,
      empty: 0,
      flag: 0,
      skip: 0,
    };
    for (const kind of kinds) result[kind] += 1;
    return result;
  }, [kinds]);
  const toBind = counts.bound + counts.picked + counts.suggested + counts.replace;

  // Search
  const searchOpen = !!selection && rows.some((row) => row.layer.id === searchFor);
  const searchMounted = usePresence(searchOpen);
  const lastSearch = useRef<string | null>(null);
  if (searchOpen) lastSearch.current = searchFor;
  const searchIndex = rows.findIndex((row) => row.layer.id === lastSearch.current);
  const searchRow = searchIndex === -1 ? null : rows[searchIndex]!;
  const anchorHint = useMemo(() => {
    for (let i = searchIndex - 1; i >= 0; i -= 1) if (rows[i]!.key) return rows[i]!.key;
    return null;
  }, [rows, searchIndex]);

  const resultMounted = usePresence(!!result);
  const lastResult = useRef(result);
  if (result) lastResult.current = result;

  const focusRow = useCallback((layerId: string) => {
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`#row-${CSS.escape(layerId)} .row__main`)?.focus(),
    );
  }, []);

  const openSearch = (layerId: string) => {
    setActiveId(layerId);
    setSearchFor(layerId);
  };
  const closeSearch = () => {
    const id = searchFor;
    setSearchFor(null);
    if (id) focusRow(id);
  };

  const apply = () => {
    if (!selection || applying || !selection.layers.length) return;
    setApplying(true);
    appliedFrame.current = selection.frameName;
    const frameId = selection.frameId;
    const decisions = decisionsFor(rows);
    void request<ApplyPreview>(bridge, 'apply:preview', { frameId, decisions })
      .then((preview) => {
        if (selectedFrame.current === frameId) setReview({ frameId, decisions, preview });
        setApplying(false);
      })
      .catch((e) => {
        setApplying(false);
        say(e instanceof Error ? e.message : String(e), 'error');
      });
  };
  const closeResult = useCallback(() => setResult(null), []);

  // Canvas follows the keyboard, without zooming on every step.
  const revealTimer = useRef<ReturnType<typeof setTimeout>>();
  const activate = useCallback(
    (layerId: string, zoom: boolean) => {
      setActiveId(layerId);
      clearTimeout(revealTimer.current);
      revealTimer.current = setTimeout(
        () => bridge.send({ type: 'layer:focus', layerId, zoom }),
        zoom ? 0 : 140,
      );
    },
    [bridge],
  );

  useEffect(() => {
    if (!activeId) return;
    document
      .getElementById(`row-${activeId}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeId, active]);

  useEffect(() => {
    if (!active || review || searchOpen || result || !rows.length) return;
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key === 'Enter') {
        event.preventDefault();
        apply();
        return;
      }
      if (meta || event.altKey) return;
      const at = rows.findIndex((row) => row.layer.id === activeId);
      const row = at === -1 ? null : rows[at]!;
      const inList = !!(event.target as HTMLElement | null)?.closest?.('.rows');
      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowUp': {
          const next =
            rows[
              Math.max(0, Math.min(rows.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))
            ]!;
          activate(next.layer.id, false);
          if (inList) focusRow(next.layer.id);
          break;
        }
        case 'Enter':
          // A focused button handles Enter itself.
          if ((event.target as HTMLElement).tagName === 'BUTTON' || !row) return;
          openSearch(row.layer.id);
          break;
        case 'Escape':
          if (!activeId) return;
          setActiveId(null);
          break;
        case 's':
        case 'f':
          if (!row) return;
          frame.update(row.layer.id, (current) => {
            const status = event.key === 's' ? 'skip' : 'flag';
            return { ...current, status: current.status === status ? 'include' : status };
          });
          break;
        case 'u':
          if (!row?.layer.boundKey) return;
          frame.update(row.layer.id, (current) =>
            current.unbind
              ? { ...current, unbind: false }
              : { ...current, pick: null, unbind: true },
          );
          break;
        case '[':
        case ']':
          if (row?.source !== 'sequence') return;
          frame.update(row.layer.id, (current) => ({
            ...current,
            shift: current.shift + (event.key === ']' ? 1 : -1),
          }));
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const scopeItems: MenuItem[] = [
    {
      id: 'all',
      label: 'All products',
      checked: scope === 'all',
      onSelect: () => setScope('all'),
    },
    ...index.products
      .filter((product) => product.id !== SHARED_PRODUCT)
      .map((product, i) => ({
        id: product.id,
        label: productLabel(product.id),
        hint: product.count.toLocaleString(),
        checked: scope === product.id,
        separatorBefore: i === 0,
        onSelect: () => setScope(product.id),
      })),
  ];
  const busy =
    index.status.phase === 'starting' ||
    index.status.phase === 'listing' ||
    index.status.phase === 'importing';
  const overflowItems: MenuItem[] = [
    {
      id: 'flags',
      label: 'Select flagged layers on page',
      onSelect: () => bridge.send({ type: 'flags:select' }),
    },
    {
      id: 'reread',
      label: 'Re-read selected frame',
      onSelect: () => bridge.send({ type: 'selection:refresh' }),
    },
    {
      id: 'reset',
      label: 'Discard changes in this frame',
      disabled: !frame.dirty,
      onSelect: frame.reset,
    },
    {
      id: 'refresh',
      label: busy ? 'Loading strings…' : 'Reload strings from library',
      hint: index.list.length ? index.list.length.toLocaleString() : undefined,
      disabled: busy,
      separatorBefore: true,
      onSelect: index.refresh,
    },
  ];
  const progress =
    index.status.phase === 'importing' && index.status.total
      ? index.status.done / index.status.total
      : index.status.phase === 'ready' || index.status.phase === 'empty'
        ? null
        : 0.08;

  return (
    <main className="app">
      <div className="workspace" {...(searchOpen || result ? { inert: '' } : {})}>
        <header className="top">
          <div className="top__row">
            <div className="top__title">
              <span className="eyebrow">{selection ? 'Selected frame' : 'String Binder'}</span>
              <h1 title={selection?.frameName}>{selection?.frameName ?? 'String Binder'}</h1>
            </div>
            {selection && (
              <Menu
                triggerClassName={`scope ${scope === null ? 'scope--unset' : ''}`}
                triggerLabel={
                  chosen
                    ? 'Product for this frame'
                    : guess
                      ? 'Product, guessed from frame and page names. Click to change.'
                      : 'Choose the product this frame belongs to'
                }
                title="Search strings in"
                items={scopeItems}
                align="end"
                trigger={() => (
                  <>
                    {!chosen && guess && <Icon name="sparkle" className="scope__auto" />}
                    <span className="scope__label">
                      {scope === null
                        ? 'Choose product'
                        : scope === 'all'
                          ? 'All products'
                          : productLabel(scope)}
                    </span>
                    <Icon name="chevron" />
                  </>
                )}
              />
            )}
            <Menu
              triggerClassName="icon-button"
              triggerLabel="More actions"
              items={overflowItems}
              align="end"
              trigger={() => <Icon name="more" />}
            />
          </div>
          {progress !== null && (
            <div className="progress" role="progressbar" aria-label="Loading strings">
              <span style={{ transform: `scaleX(${progress})` }} />
            </div>
          )}
        </header>

        <IndexNotice status={index.status} onRefresh={index.refresh} />

        {!selection ? (
          <div className="intro">
            <div className="intro__art" aria-hidden="true">
              <Icon name="frame" />
            </div>
            <h2>Select a frame to bind its copy</h2>
            <ol>
              <li>Select one frame, component or instance on the canvas.</li>
              <li>Choose the first layer’s string. The rest follow the legacy sheet order.</li>
              <li>Fix what’s off, skip non-copy, flag copy that needs a new string.</li>
              <li>Apply. Matching layers on this page get the same strings.</li>
            </ol>
          </div>
        ) : selection.layers.length === 0 ? (
          <div className="intro">
            <h2>No visible text in this frame</h2>
            <p className="intro__text">Select a frame that contains text layers.</p>
          </div>
        ) : (
          <>
            <div className="rows__heading">
              <h2>Review text layers</h2>
              <span>{rows.length} layers · reading order</span>
            </div>
            <ol className="rows" aria-label="Text layers in reading order">
              {rows.map((row, i) => (
                <LayerRow
                  key={row.layer.id}
                  row={row}
                  entry={row.key ? index.entries.get(row.key) : undefined}
                  previous={row.layer.boundKey ? index.entries.get(row.layer.boundKey) : undefined}
                  active={row.layer.id === activeId}
                  cascade={cascade[i]!}
                  onActivate={() => activate(row.layer.id, true)}
                  onChoose={() => openSearch(row.layer.id)}
                  onReveal={() =>
                    bridge.send({ type: 'layer:focus', layerId: row.layer.id, zoom: true })
                  }
                  onChange={(change) => frame.update(row.layer.id, change)}
                />
              ))}
            </ol>
          </>
        )}

        {toast && (
          <div
            className={`toast toast--${toast.tone}`}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            key={toast.id}
          >
            <span>{toast.text}</span>
            <button
              type="button"
              className="icon-button"
              aria-label="Dismiss"
              onClick={() => setToast(null)}
            >
              <Icon name="close" />
            </button>
          </div>
        )}

        {selection && selection.layers.length > 0 && (
          <footer className="footer">
            <div className="tally" aria-live="polite">
              <span>
                <strong>{toBind}</strong> to bind
              </span>
              {counts.replace > 0 && (
                <span className="tally--warning">{counts.replace} replace</span>
              )}
              {counts.unbind > 0 && <span className="tally--danger">{counts.unbind} unbind</span>}
              {counts.empty > 0 && <span>{counts.empty} empty</span>}
              {counts.flag > 0 && <span className="tally--warning">{counts.flag} flagged</span>}
              {counts.skip > 0 && <span className="tally--quiet">{counts.skip} skipped</span>}
            </div>
            <button
              type="button"
              className={`button button--primary ${applying ? 'is-busy' : ''}`}
              disabled={applying}
              onClick={apply}
              title="Apply  ⌘↵"
            >
              {applying ? 'Applying…' : 'Apply to frame & page'}
            </button>
          </footer>
        )}
      </div>
      {searchMounted && selection && searchRow && (
        <div
          className="overlay"
          data-state={searchOpen ? 'open' : 'closed'}
          {...(!searchOpen ? { inert: '' } : {})}
        >
          <SearchPanel
            key={searchRow.layer.id}
            canvasText={searchRow.layer.characters.replace(/\s+/gu, ' ').trim()}
            layerName={searchRow.layer.name}
            contextNames={[
              ...(searchRow.layer.contextNames ?? []),
              ...(selection?.contextNames ?? []),
            ]}
            current={searchRow.key ? index.entries.get(searchRow.key) : undefined}
            currentKey={searchRow.key}
            anchorHint={anchorHint}
            list={index.list}
            entries={index.entries}
            sequences={sequences}
            used={used}
            scope={scope}
            products={index.products}
            onScope={setScope}
            onPick={(key) => {
              frame.pick(searchRow.layer.id, key);
              closeSearch();
            }}
            onClose={closeSearch}
          />
        </div>
      )}

      {review && (
        <div className="overlay overlay--sheet" data-state="open">
          <section className="studio-body apply-review" role="dialog" aria-label="Review Apply">
            <h2>Review Apply</h2>
            <p>
              {review.decisions.filter((d) => d.action === 'bind').length} selected bindings ·{' '}
              {review.preview.targets.length} matching page targets
            </p>
            {review.preview.targets.map((t) => (
              <p key={t.nodeId}>
                {t.frameName} · {t.nodeId}
              </p>
            ))}
            <p>Different existing bindings are kept and reported as conflicts.</p>
            <button onClick={() => setReview(null)}>Back to review</button>
            <button
              disabled={applying}
              onClick={() => {
                setApplying(true);
                bridge.send({ type: 'apply', ...review });
                setReview(null);
              }}
            >
              Confirm Apply
            </button>
          </section>
        </div>
      )}
      {resultMounted && lastResult.current && (
        <div className="overlay overlay--sheet" data-state={result ? 'open' : 'closed'}>
          <SummaryPanel
            summary={lastResult.current.summary}
            frameName={lastResult.current.frameName}
            onSelect={(ids) => bridge.send({ type: 'layers:select', layerIds: ids })}
            onClose={closeResult}
          />
        </div>
      )}
    </main>
  );
}
