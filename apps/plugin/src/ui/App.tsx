import type { ApplySummary, SelectionInfo } from '@string-binder/contracts';
import { useEffect, useMemo, useState } from 'react';
import type { UiBridge } from './bridge';
import { LayerRow } from './components/LayerRow';
import { SearchPanel } from './components/SearchPanel';
import { SummaryPanel } from './components/SummaryPanel';
import { decisionsFor, useFrameRows } from './frame-rows';
import { useStringIndex, type IndexStatus } from './string-index';

function IndexStatusLine({
  status,
  count,
  onRefresh,
}: {
  status: IndexStatus;
  count: number;
  onRefresh: () => void;
}) {
  let text: string;
  switch (status.phase) {
    case 'starting':
      text = 'Opening saved strings…';
      break;
    case 'listing':
      text = 'Checking libraries for new strings…';
      break;
    case 'importing':
      text = `Loading string values ${status.done.toLocaleString()} / ${status.total.toLocaleString()}`;
      break;
    case 'empty':
      text = 'No string library is enabled. Turn on GoPay Strings in Assets › Libraries.';
      break;
    case 'ready':
      text = `${count.toLocaleString()} strings${status.failed ? ` · ${status.failed} could not load` : ''}`;
      break;
  }
  const busy =
    status.phase === 'starting' || status.phase === 'listing' || status.phase === 'importing';
  return (
    <div className="index-status">
      <span role="status">{text}</span>
      {status.phase === 'importing' && (
        <progress max={status.total} value={status.done} aria-label="String values loaded" />
      )}
      <button
        type="button"
        className="text-button"
        onClick={onRefresh}
        disabled={busy}
        title="Reload all values from the library"
      >
        Refresh
      </button>
    </div>
  );
}

export function App({ bridge }: { bridge: UiBridge }) {
  const index = useStringIndex(bridge);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [searchFor, setSearchFor] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [summary, setSummary] = useState<ApplySummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const frame = useFrameRows(selection, index.sequences);

  useEffect(
    () =>
      bridge.subscribe((event) => {
        switch (event.type) {
          case 'selection':
            setSelection(event.selection);
            setSearchFor(null);
            return;
          case 'apply:done':
            setApplying(false);
            setSummary(event.summary);
            return;
          case 'flags:selected':
            setMessage(
              event.count
                ? `Selected ${event.count} flagged layer${event.count === 1 ? '' : 's'}.`
                : 'No flagged layers on this page.',
            );
            return;
          case 'error':
            setApplying(false);
            setMessage(event.message);
            return;
          default:
            return;
        }
      }),
    [bridge],
  );
  useEffect(() => {
    bridge.send({ type: 'ui:ready' });
  }, [bridge]);

  const counts = useMemo(() => {
    const result = { bind: 0, skip: 0, flag: 0, empty: 0 };
    for (const row of frame.rows) {
      if (row.state.status === 'skip') result.skip += 1;
      else if (row.state.status === 'flag') result.flag += 1;
      else if (row.key) result.bind += 1;
      else result.empty += 1;
    }
    return result;
  }, [frame.rows]);

  const searchRowIndex = frame.rows.findIndex((row) => row.layer.id === searchFor);
  const searchRow = searchRowIndex === -1 ? null : frame.rows[searchRowIndex]!;
  const anchorHint = useMemo(() => {
    for (let i = searchRowIndex - 1; i >= 0; i -= 1)
      if (frame.rows[i]!.key) return frame.rows[i]!.key;
    return null;
  }, [frame.rows, searchRowIndex]);

  const apply = () => {
    if (!selection) return;
    setApplying(true);
    setMessage(null);
    bridge.send({ type: 'apply', frameId: selection.frameId, decisions: decisionsFor(frame.rows) });
  };

  if (summary)
    return (
      <main className="app">
        <SummaryPanel
          summary={summary}
          onSelect={(ids) => bridge.send({ type: 'layers:select', layerIds: ids })}
          onClose={() => setSummary(null)}
        />
      </main>
    );

  if (selection && searchRow)
    return (
      <main className="app">
        <SearchPanel
          layerText={searchRow.layer.characters || searchRow.layer.name}
          currentKey={searchRow.key}
          anchorHint={anchorHint}
          list={index.list}
          entries={index.entries}
          collections={index.collections}
          sequences={index.sequences}
          context={selection.contextNames}
          onPick={(key) => {
            frame.pick(searchRow.layer.id, key);
            setSearchFor(null);
          }}
          onClose={() => setSearchFor(null)}
        />
      </main>
    );

  return (
    <main className="app">
      <header className="top">
        <div className="top__frame">
          {selection ? (
            <>
              <h1 title={selection.frameName}>{selection.frameName}</h1>
              <button
                type="button"
                className="text-button"
                onClick={() => bridge.send({ type: 'selection:refresh' })}
              >
                Use current selection
              </button>
            </>
          ) : (
            <h1>String Binder</h1>
          )}
        </div>
        <IndexStatusLine
          status={index.status}
          count={index.list.length}
          onRefresh={index.refresh}
        />
      </header>

      {message && (
        <p className="message" role="alert">
          {message}
          <button
            type="button"
            className="text-button"
            onClick={() => setMessage(null)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </p>
      )}

      {!selection ? (
        <div className="intro">
          <h2>Select a frame to start</h2>
          <ol>
            <li>Select one frame, component or instance.</li>
            <li>
              Choose the string for the first text layer. The layers below follow the legacy order.
            </li>
            <li>
              Fix any row, skip layers that are not copy, and flag layers that need a new string.
            </li>
            <li>Apply. Matching layers on this page get the same strings.</li>
          </ol>
        </div>
      ) : selection.layers.length === 0 ? (
        <div className="intro">
          <h2>No visible text in “{selection.frameName}”</h2>
        </div>
      ) : (
        <ol className="rows">
          {frame.rows.map((row) => (
            <LayerRow
              key={row.layer.id}
              row={row}
              entry={row.key ? index.entries.get(row.key) : undefined}
              onFocus={() => bridge.send({ type: 'layer:focus', layerId: row.layer.id })}
              onChoose={() => setSearchFor(row.layer.id)}
              onChange={(change) => frame.update(row.layer.id, change)}
            />
          ))}
        </ol>
      )}

      <footer className="footer">
        <span className="footer__counts">
          {selection
            ? [
                `${counts.bind} to bind`,
                counts.skip && `${counts.skip} skipped`,
                counts.flag && `${counts.flag} flagged`,
                counts.empty && `${counts.empty} empty`,
              ]
                .filter(Boolean)
                .join(' · ')
            : ''}
        </span>
        <button
          type="button"
          className="text-button"
          onClick={() => bridge.send({ type: 'flags:select' })}
        >
          Select flagged
        </button>
        {selection && (
          <button type="button" className="text-button" onClick={frame.reset}>
            Reset
          </button>
        )}
        <button
          type="button"
          className="primary"
          disabled={!selection || applying || !selection.layers.length}
          onClick={apply}
        >
          {applying ? 'Applying…' : 'Apply'}
        </button>
      </footer>
    </main>
  );
}
