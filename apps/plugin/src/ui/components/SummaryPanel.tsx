import type { ApplySummary, CopyRecord, LayerRef } from '@string-binder/contracts';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

/** Clean runs close by themselves after this long, unless the pointer is on the sheet. */
const AUTO_CLOSE_MS = 5000;

function LayerList(props: {
  title: string;
  tone?: 'warning' | 'danger';
  open?: boolean;
  layers: readonly (LayerRef & { reason?: string })[];
  onSelect: (ids: string[]) => void;
}) {
  if (!props.layers.length) return null;
  return (
    <details className={`sheet__list ${props.tone ? `tone--${props.tone}` : ''}`} open={props.open}>
      <summary>
        <Icon name="chevron" className="sheet__chevron" />
        <span className="sheet__list-title">{props.title}</span>
        <span className="count">{props.layers.length.toLocaleString()}</span>
        <button
          type="button"
          className="link-button"
          onClick={(event) => {
            event.preventDefault();
            props.onSelect(props.layers.map((layer) => layer.id));
          }}
        >
          Select
        </button>
      </summary>
      <ul>
        {props.layers.slice(0, 50).map((layer) => (
          <li key={layer.id}>
            <button type="button" onClick={() => props.onSelect([layer.id])}>
              <span className="sheet__frame">{layer.frameName}</span>
              <span className="sheet__layer">{layer.name}</span>
              {layer.reason && <span className="sheet__reason">{layer.reason}</span>}
            </button>
          </li>
        ))}
        {props.layers.length > 50 && (
          <li className="sheet__overflow">and {props.layers.length - 50} more</li>
        )}
      </ul>
    </details>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="stat">
      <strong>{value.toLocaleString()}</strong>
      <span>{label}</span>
    </div>
  );
}

export function SummaryPanel(props: {
  summary: ApplySummary;
  frameName: string;
  /** Copy saved to the registry in this run. */
  saved?: readonly CopyRecord[];
  onSelect: (ids: string[]) => void;
  onClose: () => void;
}) {
  const { summary } = props;
  const clean = !summary.conflicts.length && !summary.failures.length;
  const [paused, setPaused] = useState(false);
  const done = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    done.current?.focus();
  }, []);
  useEffect(() => {
    if (!clean || paused) return;
    const timer = setTimeout(props.onClose, AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [clean, paused, props.onClose]);

  return (
    <div className="scrim" onClick={props.onClose}>
      <section
        className={`sheet ${clean && !paused ? 'is-counting' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        style={{ '--auto-close': `${AUTO_CLOSE_MS}ms` } as React.CSSProperties}
        onClick={(event) => event.stopPropagation()}
        onPointerEnter={() => setPaused(true)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') props.onClose();
          else if (event.key === 'Tab') setPaused(true);
        }}
      >
        <header className="sheet__head">
          <span className={`sheet__badge ${clean ? '' : 'sheet__badge--warning'}`}>
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path d="m6 12.5 4 4 8-9" pathLength={1} />
            </svg>
          </span>
          <div>
            <h2 id="sheet-title">
              {!clean
                ? 'Applied, with exceptions'
                : props.saved?.length
                  ? 'Copy saved and applied'
                  : 'Strings applied'}
            </h2>
            <p className="sheet__sub" title={props.frameName}>
              {props.frameName}
            </p>
          </div>
        </header>

        <div className="stats">
          <Stat value={summary.boundInFrame} label="bound in frame" />
          <Stat value={summary.boundAcrossPage} label="bound on page" />
          <Stat value={summary.skipsCopied} label="skips copied" />
          <Stat value={summary.framesTouched} label="other frames" />
        </div>

        {!!props.saved?.length && (
          <div className="saved">
            <span className="eyebrow">Saved to the registry</span>
            <ul>
              {props.saved.map((record) => (
                <li key={record.copyId}>
                  <span className="mono">{record.platformKey}</span>
                  <span className="saved__value">{record.en}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="sheet__lists">
          <LayerList
            title="Kept a different string"
            tone="warning"
            open
            layers={summary.conflicts}
            onSelect={props.onSelect}
          />
          <LayerList
            title="Could not update"
            tone="danger"
            open
            layers={summary.failures}
            onSelect={props.onSelect}
          />
          <LayerList
            title="Bound on this page"
            layers={summary.propagated}
            onSelect={props.onSelect}
          />
        </div>

        <footer className="sheet__foot">
          <span className="hint">
            <kbd>⌘</kbd>
            <kbd>Z</kbd> in Figma undoes all of it
          </span>
          <button
            type="button"
            className="button button--primary"
            ref={done}
            onClick={props.onClose}
          >
            <span className="button__progress" aria-hidden="true" />
            Done
          </button>
        </footer>
      </section>
    </div>
  );
}
