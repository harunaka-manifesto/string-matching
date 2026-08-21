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
  onExclude,
  onLocate,
  onPreviewEnter,
  onPreviewLeave,
  onPreviewFocus,
  onPreviewBlur,
  isCanvasPreviewed,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  index: number;
  target: PairingTarget;
  replacement?: SheetValue;
  disabled: boolean;
  onToggle: () => void;
  onExclude: () => void;
  onLocate: () => void;
  onPreviewEnter: () => void;
  onPreviewLeave: () => void;
  onPreviewFocus: () => void;
  onPreviewBlur: () => void;
  isCanvasPreviewed: boolean;
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
  const rowNumber = String(index + 1).padStart(2, '0');

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
      className={`pairing-row ${!target.included ? 'is-skipped' : ''} ${alreadySynced ? 'is-synced' : ''}`}
      data-testid={`pairing-row-${target.layerId}`}
      data-row-number={rowNumber}
    >
      <div
        className={`current-preview-region ${isCanvasPreviewed ? 'is-canvas-previewed' : ''}`}
        data-testid={`current-preview-region-${target.layerId}`}
        tabIndex={0}
        role="group"
        aria-label={`Preview row ${index + 1} current copy on canvas`}
        onPointerEnter={onPreviewEnter}
        onPointerLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onPreviewLeave();
        }}
        onFocus={onPreviewFocus}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onPreviewBlur();
        }}
      >
        <div className="row-index" aria-label={`Row ${index + 1}`}>
          {rowNumber}
        </div>
        <div className="current-cell">
          <div className="current-copy" title={target.originalText}>
            {target.originalText || <em>(empty text)</em>}
          </div>
          {alreadySynced && <span className="sync-status">synced</span>}
          <div className="row-actions">
            <button
              className="locate-button"
              onClick={onLocate}
              disabled={disabled}
              aria-label={`Locate row ${index + 1} in Figma`}
            >
              Locate ↗
            </button>
            {target.included && (
              <button
                ref={toggleRef}
                className="row-action-button"
                onClick={onToggle}
                disabled={disabled}
                aria-label={`Keep row ${index + 1} current`}
              >
                Keep current
              </button>
            )}
          </div>
        </div>
      </div>
      {target.included ? (
        <div
          ref={droppable.setNodeRef}
          className={`sheet-destination ${droppable.isOver ? 'is-over' : ''}`}
          data-testid={`sheet-destination-${target.layerId}`}
          data-droppable="true"
          aria-label={`Sheet destination for row ${index + 1}`}
        >
          {replacement ? (
            <CopyCard
              replacement={replacement}
              disabled={disabled}
              canMoveUp={canMoveUp}
              canMoveDown={canMoveDown}
              onMove={(delta) => onMove(replacement.id, delta)}
              onExclude={onExclude}
            />
          ) : (
            <div className="unassigned-placeholder">
              No copy assigned
              <span>Will stay unchanged</span>
            </div>
          )}
        </div>
      ) : (
        <div
          className="sheet-destination skipped-destination"
          data-testid={`sheet-destination-${target.layerId}`}
          data-droppable="false"
          aria-disabled="true"
        >
          <strong>Kept current</strong>
          <span>Will remain unchanged</span>
          <button
            ref={toggleRef}
            className="row-action-button include-button"
            onClick={onToggle}
            disabled={disabled}
            aria-label={`Include row ${index + 1} again`}
          >
            Include again
          </button>
        </div>
      )}
    </article>
  );
}
