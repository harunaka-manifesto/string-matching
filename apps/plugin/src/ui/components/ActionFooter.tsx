export function ActionFooter({
  phase,
  changed,
  excluded,
  appliedCount,
  disabled,
  onApply,
  onNewPreview,
}: {
  phase: string;
  changed: number;
  excluded: number;
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
            : changed || excluded
              ? `${changed ? `${changed} change${changed === 1 ? '' : 's'}` : 'No changes'}${excluded ? ` · ${excluded} excluded` : ''}`
              : 'Everything in this review is already synced.'}
      </span>
      <button className="primary" onClick={onApply} disabled={disabled || phase !== 'review'}>
        {phase === 'applying' ? 'Applying…' : changed ? `Apply ${changed}` : 'No changes'}
      </button>
    </footer>
  );
}
