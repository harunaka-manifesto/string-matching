export function ActionFooter({
  phase,
  changed,
  appliedCount,
  disabled,
  onApply,
  onNewPreview,
}: {
  phase: string;
  changed: number;
  appliedCount: number;
  disabled: boolean;
  onApply: () => void;
  onNewPreview: () => void;
}) {
  if (phase === 'applied')
    return (
      <footer className="footer">
        <span className="footer-status success">
          Updated {appliedCount} layer{appliedCount === 1 ? '' : 's'}.
        </span>
        <button className="secondary" onClick={onNewPreview}>
          Build new preview
        </button>
      </footer>
    );
  return (
    <footer className="footer">
      <span className="footer-status">
        {phase === 'fetching'
          ? 'Fetching Sheet copy…'
          : phase === 'applying'
            ? 'Applying changes…'
            : changed
              ? `${changed} layer${changed === 1 ? '' : 's'} will change`
              : 'Everything in this review is already synced.'}
      </span>
      <button className="primary" onClick={onApply} disabled={disabled || phase !== 'review'}>
        {phase === 'applying' ? 'Applying…' : `Apply ${changed ? `${changed} changes` : 'changes'}`}
      </button>
    </footer>
  );
}
