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
    <section className="section">
      <div className="section-title">
        <span className="step">1</span>SELECTED DESIGN
      </div>
      <div className="card selection-card">
        {selection ? (
          <>
            <div className="selection-name">
              {selection.containerName}
              <span className="selection-count">{selection.visibleTextCount} copy layers</span>
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
