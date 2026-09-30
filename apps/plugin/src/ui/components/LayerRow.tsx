import type { CSSProperties } from 'react';
import type { ResolvedRow, RowState } from '../frame-rows';
import type { StringEntry } from '../string-index';
import { Icon, type IconName } from './Icon';

/** What the row will do on apply, which drives its icon, tag and colour. */
export type RowKind =
  'bound' | 'picked' | 'suggested' | 'replace' | 'unbind' | 'empty' | 'flag' | 'skip';

export function rowKind(row: ResolvedRow): RowKind {
  const { layer, state, key, source } = row;
  if (state.status === 'skip') return 'skip';
  if (state.status === 'flag') return 'flag';
  if (!key) return layer.boundKey && state.unbind ? 'unbind' : 'empty';
  if (layer.boundKey && key !== layer.boundKey) return 'replace';
  if (source === 'existing') return 'bound';
  return source === 'sequence' ? 'suggested' : 'picked';
}

const LEAD: Partial<Record<RowKind, IconName>> = {
  bound: 'check',
  suggested: 'sparkle',
  replace: 'swap',
  unbind: 'unlink',
  flag: 'flag',
  skip: 'skip',
};

const TAG: Partial<Record<RowKind, string>> = {
  suggested: 'Suggested',
  replace: 'Replaces',
  unbind: 'Unbinds',
  flag: 'Flagged',
};

const PLACEHOLDER = /\b(lorem|ipsum|dolor|amet|consectetur|adipiscing)\b/iu;

export function isPlaceholder(text: string): boolean {
  return !text.trim() || PLACEHOLDER.test(text);
}

function Value({ entry }: { entry: StringEntry | undefined }) {
  if (!entry?.loaded) return <span className="shimmer">Loading string…</span>;
  return <>{entry.en || entry.id || '—'}</>;
}

function Kbd({ children }: { children: string }) {
  return <kbd>{children}</kbd>;
}

export function LayerRow(props: {
  row: ResolvedRow;
  entry: StringEntry | undefined;
  /** String the layer is bound to now, when apply would change or remove it. */
  previous: StringEntry | undefined;
  active: boolean;
  /** Position in a prefill run; staggers the value animation. */
  cascade: number;
  onActivate: () => void;
  onChoose: () => void;
  onReveal: () => void;
  onChange: (change: (state: RowState) => RowState) => void;
}) {
  const { row, entry, previous, active, onChange } = props;
  const { layer, state, key } = row;
  const kind = rowKind(row);
  const canvas = layer.characters.replace(/\s+/gu, ' ').trim();
  const quiet = isPlaceholder(canvas);
  const lead = LEAD[kind];
  const toggle = (status: 'skip' | 'flag') =>
    onChange((current) => ({
      ...current,
      status: current.status === status ? 'include' : status,
    }));

  let value;
  switch (kind) {
    case 'skip':
      value = (
        <span className="row__muted">
          Skipped{layer.autoSkipReason && !layer.stored ? ` · ${layer.autoSkipReason}` : ''}
        </span>
      );
      break;
    case 'flag':
      value = <span className="row__flag">Needs a new string</span>;
      break;
    case 'empty':
      value = <span className="row__muted">Choose a string</span>;
      break;
    case 'unbind':
      value = (
        <s className="row__muted">
          <Value entry={previous} />
        </s>
      );
      break;
    default:
      value = (
        <span className="row__en" key={key}>
          <Value entry={entry} />
        </span>
      );
  }

  return (
    <li
      className={`row row--${kind} ${active ? 'is-active' : ''}`}
      id={`row-${layer.id}`}
      style={{ '--cascade': props.cascade } as CSSProperties}
    >
      <button
        type="button"
        className="row__main"
        aria-expanded={active}
        onClick={() => {
          if (active || kind === 'empty') props.onChoose();
          else props.onActivate();
        }}
        onDoubleClick={props.onChoose}
      >
        <span className={`row__lead lead--${kind}`} aria-hidden="true">
          {lead ? <Icon name={lead} /> : <span className="lead__dot" />}
        </span>
        <span className="row__body">
          <span className={`row__canvas ${quiet ? 'is-placeholder' : ''}`}>
            {canvas || 'Empty text'}
            {quiet && <span className="row__layer-name"> · {layer.name}</span>}
          </span>
          <span className="row__value">{value}</span>
        </span>
        {TAG[kind] && <span className={`tag tag--${kind}`}>{TAG[kind]}</span>}
      </button>

      <div className="row__detail" aria-hidden={!active}>
        <div className="row__detail-inner">
          {(kind === 'replace' || kind === 'unbind') && previous && (
            <div className="diff">
              <div className="diff__side">
                <span className="diff__label">Now</span>
                <s className="diff__old">
                  <Value entry={previous} />
                </s>
              </div>
              <Icon name="arrow" className="diff__arrow" />
              <div className="diff__side">
                <span className="diff__label">After apply</span>
                <span className="diff__new">
                  {kind === 'unbind' ? 'No string' : <Value entry={entry} />}
                </span>
              </div>
            </div>
          )}

          {entry && kind !== 'skip' && kind !== 'flag' && kind !== 'unbind' && (
            <dl className="facts">
              {entry.loaded && entry.id && (
                <>
                  <dt>ID</dt>
                  <dd>{entry.id}</dd>
                </>
              )}
              <dt>Screen</dt>
              <dd>{entry.path || '—'}</dd>
              <dt>Key</dt>
              <dd className="mono" title={entry.name}>
                {entry.name}
              </dd>
            </dl>
          )}

          <div className="row__actions">
            {active && (
              <>
                {kind !== 'skip' && (
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={props.onChoose}
                  >
                    {key ? 'Change string' : 'Choose string'} <Kbd>↵</Kbd>
                  </button>
                )}
                {kind === 'suggested' && (
                  <span className="segmented" role="group" aria-label="Shift suggestion">
                    <button
                      type="button"
                      className="icon-button"
                      title="Earlier string in order, this row and below  ["
                      aria-label="Earlier string"
                      onClick={() =>
                        onChange((current) => ({ ...current, shift: current.shift - 1 }))
                      }
                    >
                      <Icon name="up" />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      title="Later string in order, this row and below  ]"
                      aria-label="Later string"
                      onClick={() =>
                        onChange((current) => ({ ...current, shift: current.shift + 1 }))
                      }
                    >
                      <Icon name="down" />
                    </button>
                  </span>
                )}
                <span className="spacer" />
                {layer.boundKey && state.status === 'include' && (
                  <button
                    type="button"
                    className="icon-button"
                    title={state.unbind || kind === 'unbind' ? 'Keep binding  U' : 'Unbind  U'}
                    aria-label={state.unbind ? 'Keep binding' : 'Unbind'}
                    aria-pressed={state.unbind}
                    onClick={() =>
                      onChange((current) =>
                        current.unbind
                          ? { ...current, unbind: false }
                          : { ...current, pick: null, unbind: true },
                      )
                    }
                  >
                    <Icon name={state.unbind ? 'undo' : 'unlink'} />
                  </button>
                )}
                <button
                  type="button"
                  className={`icon-button ${state.status === 'flag' ? 'is-on is-on--warning' : ''}`}
                  title={state.status === 'flag' ? 'Remove flag  F' : 'Flag: needs a new string  F'}
                  aria-label="Needs a new string"
                  aria-pressed={state.status === 'flag'}
                  onClick={() => toggle('flag')}
                >
                  <Icon name="flag" />
                </button>
                <button
                  type="button"
                  className={`icon-button ${state.status === 'skip' ? 'is-on' : ''}`}
                  title={state.status === 'skip' ? 'Include this layer  S' : 'Skip: not copy  S'}
                  aria-label="Skip layer"
                  aria-pressed={state.status === 'skip'}
                  onClick={() => toggle('skip')}
                >
                  <Icon name="skip" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title="Zoom to layer"
                  aria-label="Zoom to layer"
                  onClick={props.onReveal}
                >
                  <Icon name="target" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
