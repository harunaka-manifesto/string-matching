import type { SheetSource } from '@ux-copy-sync/contracts';

export function ReviewContextBar({
  targetCount,
  source,
  sourceRowCount,
  onChange,
  editing,
}: {
  targetCount: number;
  source: SheetSource;
  sourceRowCount: number;
  onChange: () => void;
  editing: boolean;
}) {
  return (
    <section className="review-context" aria-label="Review source">
      <div className="review-context-copy">
        <div>
          <span className="context-label">Source</span> · {targetCount} target
          {targetCount === 1 ? '' : 's'}
        </div>
        <div className="metadata">
          {source.sheetTitle} · {source.startCell} · {sourceRowCount} row
          {sourceRowCount === 1 ? '' : 's'}
        </div>
      </div>
      <button
        className="text-button context-change"
        onClick={onChange}
        aria-expanded={editing}
        title="Change the Sheet source"
      >
        {editing ? 'Close' : 'Change'}
      </button>
    </section>
  );
}
