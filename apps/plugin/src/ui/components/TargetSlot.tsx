import { useDroppable } from '@dnd-kit/core';
import type { SheetValue } from '@ux-copy-sync/contracts';
import { normalizeLayerName, type PairingTarget } from '@ux-copy-sync/domain';
import { CopyCard } from './CopyCard';

export function TargetSlot({
  index,
  target,
  replacement,
  disabled,
  onToggle,
  onLocate,
  onMove,
}: {
  index: number;
  target: PairingTarget;
  replacement?: SheetValue;
  disabled: boolean;
  onToggle: () => void;
  onLocate: () => void;
  onMove: (id: string, delta: -1 | 1) => void;
}) {
  const droppable = useDroppable({ id: `slot:${target.layerId}`, disabled });
  const alreadySynced = Boolean(
    replacement &&
    target.originalText === replacement.value &&
    target.originalName === normalizeLayerName(replacement.value),
  );
  return (
    <article
      ref={droppable.setNodeRef}
      className={`target-slot ${!target.included ? 'is-skipped' : ''} ${droppable.isOver ? 'is-over' : ''}`}
    >
      <div className="slot-header">
        <span className="slot-number">{String(index + 1).padStart(2, '0')}</span>
        <strong title={target.layerName}>{target.layerName}</strong>
        <button className="locate-button" onClick={onLocate} disabled={disabled}>
          Locate ↗
        </button>
      </div>
      <div className="copy-label">CURRENT</div>
      <div className="current-copy">{target.originalText || <em>(empty text)</em>}</div>
      {target.included ? (
        <>
          <div className="copy-label">
            SHEET {alreadySynced && <span className="sync-status">Already synced</span>}
          </div>
          {replacement ? (
            <CopyCard
              replacement={replacement}
              disabled={disabled}
              onMove={(delta) => onMove(replacement.id, delta)}
            />
          ) : (
            <div className="unassigned-placeholder">
              No Sheet copy assigned
              <br />
              <span>This layer will remain unchanged.</span>
            </div>
          )}
          <button className="skip-button" onClick={onToggle} disabled={disabled}>
            Skip this layer
          </button>
        </>
      ) : (
        <>
          <div className="skipped-copy">Skipped · Figma copy will stay unchanged</div>
          <button className="skip-button" onClick={onToggle} disabled={disabled}>
            Include again
          </button>
        </>
      )}
    </article>
  );
}
