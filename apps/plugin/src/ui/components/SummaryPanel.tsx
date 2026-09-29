import type { ApplySummary, LayerRef } from '@string-binder/contracts';

function plural(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

function LayerList(props: {
  title: string;
  layers: readonly (LayerRef & { reason?: string })[];
  onSelect: (ids: string[]) => void;
}) {
  if (!props.layers.length) return null;
  return (
    <div className="summary__list">
      <div className="summary__list-head">
        <h3>{props.title}</h3>
        <button
          type="button"
          className="text-button"
          onClick={() => props.onSelect(props.layers.map((layer) => layer.id))}
        >
          Select all
        </button>
      </div>
      <ul>
        {props.layers.slice(0, 50).map((layer) => (
          <li key={layer.id}>
            <button
              type="button"
              className="text-button"
              onClick={() => props.onSelect([layer.id])}
            >
              {layer.frameName} › {layer.name}
            </button>
            {layer.reason && <span className="summary__reason"> · {layer.reason}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SummaryPanel(props: {
  summary: ApplySummary;
  onSelect: (ids: string[]) => void;
  onClose: () => void;
}) {
  const { summary } = props;
  return (
    <section className="summary" aria-live="polite">
      <h2>Applied</h2>
      <ul className="summary__stats">
        <li>
          <strong>{summary.boundInFrame.toLocaleString()}</strong> bound in this frame
        </li>
        <li>
          <strong>{summary.boundAcrossPage.toLocaleString()}</strong> bound in matching layers on
          this page
          {summary.framesTouched ? ` (${plural(summary.framesTouched, 'frame')})` : ''}
        </li>
        <li>
          <strong>{summary.skipsCopied.toLocaleString()}</strong> skips copied to matching layers
        </li>
        <li>
          <strong>{summary.conflicts.length.toLocaleString()}</strong> kept their different binding
        </li>
      </ul>
      <p className="hint">One undo (⌘Z) reverts everything above.</p>
      <LayerList
        title="Kept different binding"
        layers={summary.conflicts}
        onSelect={props.onSelect}
      />
      <LayerList title="Could not update" layers={summary.failures} onSelect={props.onSelect} />
      <LayerList title="Bound on this page" layers={summary.propagated} onSelect={props.onSelect} />
      <div className="footer">
        <button type="button" className="primary" onClick={props.onClose}>
          Done
        </button>
      </div>
    </section>
  );
}
