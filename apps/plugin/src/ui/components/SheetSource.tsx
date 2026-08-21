import type { ParsedSheetCell } from '@ux-copy-sync/contracts';

export function SheetSource({
  value,
  parsed,
  disabled,
  canFetch,
  loading,
  fetchLabel,
  hasPreview = false,
  error,
  onChange,
  onFetch,
}: {
  value: string;
  parsed: ParsedSheetCell | null;
  disabled: boolean;
  canFetch: boolean;
  loading?: boolean;
  fetchLabel?: string;
  hasPreview?: boolean;
  error?: string;
  onChange: (value: string) => void;
  onFetch: () => void;
}) {
  return (
    <section className="section">
      <div className="section-title">
        <span className="step">2</span>SHEET STARTING CELL
      </div>
      <div className="source-row">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          aria-label="Google Sheets starting cell link"
          placeholder="https://docs.google.com/...#gid=0&range=D18"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !disabled && parsed && canFetch) onFetch();
          }}
        />
        <button
          className="primary"
          onClick={onFetch}
          disabled={disabled || !parsed || !canFetch}
          aria-busy={loading}
        >
          {loading ? 'Fetching…' : (fetchLabel ?? 'Fetch copy')}
        </button>
      </div>
      <div className="source-hint">
        {hasPreview
          ? null
          : parsed
            ? canFetch
              ? `${parsed.startCell} will become the first copy candidate.`
              : 'Select one Frame, Component, or Instance first.'
            : 'Paste a link to one Google Sheets starting cell.'}
      </div>
      {loading && (
        <div className="source-hint" role="status">
          Reading Sheet copy…
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
