import type { ResolvedRow, RowState } from '../frame-rows';
import type { StringEntry } from '../string-index';

const SOURCE_LABEL: Record<ResolvedRow['source'], string> = {
  existing: 'Bound',
  picked: 'Picked',
  sequence: 'Next in order',
  none: '',
};

function variableLeaf(name: string): string {
  return name.slice(name.lastIndexOf('/') + 1);
}

export function LayerRow(props: {
  row: ResolvedRow;
  entry: StringEntry | undefined;
  onFocus: () => void;
  onChoose: () => void;
  onChange: (change: (state: RowState) => RowState) => void;
}) {
  const { row, entry, onFocus, onChoose, onChange } = props;
  const { layer, state, key, source } = row;
  const included = state.status === 'include';
  const changed = source !== 'existing' && !!layer.boundKey && key !== layer.boundKey;
  const name = entry?.name ?? (key === layer.boundKey ? layer.boundName : null) ?? key ?? '';

  return (
    <li className={`row row--${state.status}`}>
      <div className="row__head">
        <input
          type="checkbox"
          className="row__include"
          checked={included}
          aria-label={included ? `Skip “${layer.name}”` : `Include “${layer.name}”`}
          title={included ? 'Skip this layer' : 'Include this layer'}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              status: event.target.checked ? 'include' : 'skip',
            }))
          }
        />
        <button type="button" className="row__layer" onClick={onFocus} title="Show on canvas">
          <span className="row__text">{layer.characters.replace(/\s+/gu, ' ')}</span>
          <span className="row__name">
            {layer.inInstance ? '◇ ' : ''}
            {layer.name}
          </span>
        </button>
        <button
          type="button"
          className={`icon-button ${state.status === 'flag' ? 'is-on' : ''}`}
          aria-pressed={state.status === 'flag'}
          title={state.status === 'flag' ? 'Remove “needs new string”' : 'Flag: needs a new string'}
          onClick={() =>
            onChange((current) => ({
              ...current,
              status: current.status === 'flag' ? 'include' : 'flag',
            }))
          }
        >
          ⚑
        </button>
      </div>

      {state.status === 'skip' && (
        <p className="row__note">
          Skipped{layer.autoSkipReason && !layer.stored ? ` · ${layer.autoSkipReason}` : ''}
        </p>
      )}
      {state.status === 'flag' && <p className="row__note row__note--flag">Needs a new string</p>}

      {included && (
        <div className="row__assign">
          <button
            type="button"
            className={`assign ${key ? '' : 'assign--empty'}`}
            onClick={onChoose}
          >
            {key ? (
              <>
                <span className="assign__en">
                  {entry?.loaded ? entry.en || '—' : 'Loading value…'}
                </span>
                {entry?.loaded && entry.id && <span className="assign__id">{entry.id}</span>}
                <span className="assign__name" title={name}>
                  {variableLeaf(name)}
                </span>
              </>
            ) : (
              <span className="assign__placeholder">Choose string…</span>
            )}
          </button>
          <div className="row__meta">
            {source !== 'none' && (
              <span className={`badge badge--${changed ? 'changed' : source}`}>
                {changed ? 'Replaces binding' : SOURCE_LABEL[source]}
              </span>
            )}
            {source === 'sequence' && (
              <span className="nudge">
                <button
                  type="button"
                  className="icon-button"
                  title="Use the previous string (this row and below)"
                  aria-label="Previous string"
                  onClick={() => onChange((current) => ({ ...current, shift: current.shift - 1 }))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title="Use the next string (this row and below)"
                  aria-label="Next string"
                  onClick={() => onChange((current) => ({ ...current, shift: current.shift + 1 }))}
                >
                  ↓
                </button>
              </span>
            )}
            {layer.boundKey && !state.unbind && (
              <button
                type="button"
                className="text-button"
                onClick={() => onChange((current) => ({ ...current, pick: null, unbind: true }))}
              >
                Unbind
              </button>
            )}
            {state.unbind && (
              <button
                type="button"
                className="text-button"
                onClick={() => onChange((current) => ({ ...current, unbind: false }))}
              >
                Undo unbind
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
