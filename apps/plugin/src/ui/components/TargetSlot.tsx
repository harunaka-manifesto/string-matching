import { useEffect, useRef } from 'react';
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
  canMoveUp,
  canMoveDown,
}: {
  index: number;
  target: PairingTarget;
  replacement?: SheetValue;
  disabled: boolean;
  onToggle: () => void;
  onLocate: () => void;
  onMove: (id: string, delta: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const droppable = useDroppable({
    id: `slot:${target.layerId}`,
    disabled: disabled || !target.included,
  });
  const toggleRef = useRef<HTMLButtonElement>(null);
  const previousIncluded = useRef(target.included);
  useEffect(() => {
    if (previousIncluded.current !== target.included) toggleRef.current?.focus();
    previousIncluded.current = target.included;
  }, [target.included]);
  const alreadySynced = Boolean(
    replacement &&
    target.originalText === replacement.value &&
    target.originalName === normalizeLayerName(replacement.value),
  );
  return (
    <article
      ref={droppable.setNodeRef}
      className={`target-slot ${!target.included ? 'is-skipped' : ''} ${target.included && droppable.isOver ? 'is-over' : ''}`}
    >
      <div className="slot-header">
        <span className="slot-number">{String(index + 1).padStart(2, '0')}</span>
        <strong title={target.layerName}>{target.layerName}</strong>
        <button
          className="locate-button"
          onClick={onLocate}
          disabled={disabled}
          aria-label={`Locate ${target.layerName}`}
        >
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
              canMoveUp={canMoveUp}
              canMoveDown={canMoveDown}
              onMove={(delta) => onMove(replacement.id, delta)}
            />
          ) : (
            <div className="unassigned-placeholder">
              No Sheet copy assigned
              <br />
              <span>This layer will remain unchanged.</span>
            </div>
          )}
          <button
            ref={toggleRef}
            className="skip-button"
            onClick={onToggle}
            disabled={disabled}
            aria-label={`Skip ${target.layerName}`}
          >
            Skip this layer
          </button>
        </>
      ) : (
        <>
          <div className="skipped-copy">Skipped · Figma copy will stay unchanged</div>
          <button
            ref={toggleRef}
            className="skip-button"
            onClick={onToggle}
            disabled={disabled}
            aria-label={`Include ${target.layerName} again`}
          >
            Include again
          </button>
        </>
      )}
    </article>
  );
}
