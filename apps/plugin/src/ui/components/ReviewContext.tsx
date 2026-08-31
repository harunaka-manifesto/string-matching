import { useEffect, useId, useRef } from 'react';
import type { ParsedSheetCell, SheetSource } from '@ux-copy-sync/contracts';
import type { SelectionCardValue } from './SelectionCard';

export type ReviewCounts = {
  changed: number;
  synced: number;
  kept: number;
  unassigned: number;
  excluded: number;
};

export function ReviewContext({
  selection,
  source,
  cellUrl,
  parsed,
  counts,
  sourceDirty,
  editorOpen,
  disabled,
  canFetch,
  loading,
  urlError,
  onChange,
  onChangeSource,
  onFetch,
}: {
  selection: SelectionCardValue;
  source: SheetSource;
  cellUrl: string;
  parsed: ParsedSheetCell | null;
  counts: ReviewCounts;
  sourceDirty: boolean;
  editorOpen: boolean;
  disabled: boolean;
  canFetch: boolean;
  loading: boolean;
  urlError?: string;
  onChange: (value: string) => void;
  onChangeSource: () => void;
  onFetch: () => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editorOpen) inputRef.current?.focus();
  }, [editorOpen]);
  const visibleCounts = (
    [
      ['Change', 'Changes', counts.changed],
      ['Synced', 'Synced', counts.synced],
      ['Kept', 'Kept', counts.kept],
      ['Unassigned', 'Unassigned', counts.unassigned],
      ['Excluded', 'Excluded', counts.excluded],
    ] satisfies Array<[string, string, number]>
  ).filter(([, , count]) => count > 0);
  return (
    <section className="review-context" aria-labelledby="review-context-title">
      <div className="review-context-top">
        <div>
          <div className="context-kicker">REVIEWING</div>
          <h2 id="review-context-title">{selection?.containerName ?? 'Selected design'}</h2>
          <p className="metadata">
            {selection?.containerType ?? 'Frame'} · {selection?.visibleTextCount ?? 0} text layers
          </p>
        </div>
        <button
          className="secondary context-source-button"
          onClick={onChangeSource}
          aria-expanded={editorOpen}
          aria-controls="review-source-editor"
        >
          {editorOpen ? 'Close source' : 'Change source'}
        </button>
      </div>
      <div className="review-context-source">
        <span className="context-source-label">SHEET</span>
        <strong>{source.spreadsheetTitle || 'Google Sheet'}</strong>
        <span>
          {source.sheetTitle} · {source.startCell}
        </span>
      </div>
      <div className="review-counts" aria-label="Review counts">
        {visibleCounts.map(([singular, plural, count]) => (
          <span key={plural}>
            <strong>{count}</strong> {count === 1 ? singular : plural}
          </span>
        ))}
      </div>
      {editorOpen && (
        <div className="review-source-editor" id="review-source-editor">
          <label htmlFor={inputId}>Google Sheets starting cell link</label>
          <div className="source-row">
            <input
              ref={inputRef}
              id={inputId}
              value={cellUrl}
              onChange={(event) => onChange(event.target.value)}
              disabled={disabled}
              aria-invalid={Boolean(urlError)}
            />
            <button
              className="primary"
              onClick={onFetch}
              disabled={disabled || !parsed || !canFetch}
              aria-busy={loading}
            >
              {loading ? 'Refreshing…' : sourceDirty ? 'Fetch new source' : 'Refresh review'}
            </button>
          </div>
          <p className="source-hint">
            {parsed
              ? `${parsed.startCell} will become the first copy candidate.`
              : 'Paste a link to one Google Sheets starting cell.'}
          </p>
          {urlError && (
            <div className="error" role="alert">
              {urlError}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
