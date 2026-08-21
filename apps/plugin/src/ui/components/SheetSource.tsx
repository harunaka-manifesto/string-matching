import type { ParsedSheetCell } from '@ux-copy-sync/contracts';

export function SheetSource({
  value,
  parsed,
  disabled,
  error,
  onChange,
  onFetch,
}: {
  value: string;
  parsed: ParsedSheetCell | null;
  disabled: boolean;
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
        />
        <button className="primary" onClick={onFetch} disabled={disabled || !parsed}>
          Fetch copy
        </button>
      </div>
      <div className="source-hint">
        {parsed
          ? `${parsed.startCell} will become the first copy candidate.`
          : 'Paste a link to one Google Sheets starting cell.'}
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
