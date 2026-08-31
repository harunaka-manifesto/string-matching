export function ActionFooter({
  phase,
  changed,
  appliedCount,
  disabled,
  blockedReason,
  onApply,
  onNewPreview,
}: {
  phase: string;
  changed: number;
  appliedCount: number;
  disabled: boolean;
  blockedReason?: string;
  onApply: () => void;
  onNewPreview: () => void;
}) {
  if (phase === 'applied')
    return (
      <footer className="footer">
        <span className="footer-status success" role="status">
          {appliedCount} text layer{appliedCount === 1 ? '' : 's'} updated.
        </span>
        <button className="secondary" onClick={onNewPreview}>
          Review another frame
        </button>
      </footer>
    );

  const status =
    phase === 'fetching'
      ? 'Refreshing review…'
      : phase === 'applying'
        ? `Applying ${changed} change${changed === 1 ? '' : 's'}…`
        : changed
          ? `${changed} change${changed === 1 ? '' : 's'} ready`
          : 'Everything is synced.';

  return (
    <footer className="footer">
      <div className="footer-status">
        <span>{status}</span>
        {blockedReason && <span className="footer-reason">{blockedReason}</span>}
      </div>
      {changed > 0 && (
        <button
          className="primary"
          onClick={onApply}
          disabled={disabled || phase !== 'review'}
          aria-busy={phase === 'applying'}
        >
          {phase === 'applying'
            ? 'Applying…'
            : `Apply ${changed} change${changed === 1 ? '' : 's'}`}
        </button>
      )}
    </footer>
  );
}
