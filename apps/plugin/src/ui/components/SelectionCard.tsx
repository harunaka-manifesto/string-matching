import type { RootType } from '@ux-copy-sync/contracts';

export type SelectionCardValue = {
  containerId: string;
  containerName: string;
  containerType: string;
  visibleTextCount: number;
} | null;

export function SelectionCard({
  selection,
  valid = true,
  message,
}: {
  selection: SelectionCardValue;
  valid?: boolean;
  message?: string;
}) {
  return (
    <section className="section setup-selection">
      <div className="section-title">SELECTED</div>
      <div className="selection-summary">
        {selection ? (
          <>
            <div className="selection-summary-line">
              <strong>{selection.containerName}</strong>
              <span>Source · {selection.visibleTextCount} text</span>
            </div>
            <div className="metadata">
              {selection.containerType as RootType} · visible text only
            </div>
            {!valid && (
              <div className="error">{message ?? 'Select a smaller design to continue.'}</div>
            )}
          </>
        ) : (
          <span className="muted">
            Select one Frame, Component, or Instance in Figma to continue.
          </span>
        )}
      </div>
    </section>
  );
}
