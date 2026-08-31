import { useEffect, useRef } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { SheetValue } from '@ux-copy-sync/contracts';
import { normalizeLayerName, type PairingTarget } from '@ux-copy-sync/domain';
import { CopyCard } from './CopyCard';
import { InlineDiff } from './InlineDiff';

export function TargetSlot({
  index,
  target,
  replacement,
  disabled,
  onToggle,
  onLocate,
  onPreviewEnter,
  onPreviewLeave,
  onPreviewFocus,
  onPreviewBlur,
  isCanvasPreviewed,
  onMove,
  canMoveUp,
  canMoveDown,
  onExclude,
}: {
  index: number;
  target: PairingTarget;
  replacement?: SheetValue;
  disabled: boolean;
  onToggle: () => void;
  onLocate: () => void;
  onPreviewEnter: () => void;
  onPreviewLeave: () => void;
  onPreviewFocus: () => void;
  onPreviewBlur: () => void;
  isCanvasPreviewed: boolean;
  onMove: (id: string, delta: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onExclude: (replacementId: string) => void;
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
      className={`pairing-row ${!target.included ? 'is-skipped' : ''} ${alreadySynced ? 'is-synced' : replacement ? 'is-changed' : ''}`}
      data-testid={`pairing-row-${target.layerId}`}
      data-row-number={rowNumber}
      role="row"
    >
      <div className="row-index" role="rowheader" aria-label={`Row ${index + 1}`}>
        {rowNumber}
      </div>
      <div
        className={`current-preview-region ${isCanvasPreviewed ? 'is-canvas-previewed' : ''}`}
        data-testid={`current-preview-region-${target.layerId}`}
        tabIndex={0}
        role="cell"
        aria-label={`Current copy, row ${index + 1}: ${target.originalText || 'Empty text'}. Focus highlights it on canvas.`}
        onPointerEnter={onPreviewEnter}
        onPointerLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onPreviewLeave();
        }}
        onFocus={onPreviewFocus}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onPreviewBlur();
        }}
      >
        <div className="current-cell">
          <div className="current-copy" title={target.originalText}>
            {!target.originalText ? (
              <em>(empty text)</em>
            ) : replacement ? (
              <InlineDiff current={target.originalText} next={replacement.value} side="current" />
            ) : (
              target.originalText
            )}
          </div>
          {alreadySynced && <span className="sync-status">Synced</span>}
          {!alreadySynced && replacement && <span className="row-state">Changed</span>}
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
                aria-label={`Keep current for row ${index + 1}`}
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
          role="cell"
        >
          {replacement ? (
            <CopyCard
              replacement={replacement}
              disabled={disabled}
              canMoveUp={canMoveUp}
              canMoveDown={canMoveDown}
              onMove={(delta) => onMove(replacement.id, delta)}
              onExclude={() => onExclude(replacement.id)}
              originalText={target.originalText}
            />
          ) : (
            <div className="unassigned-placeholder">
              No Sheet copy assigned
              <span>This destination will remain unchanged.</span>
            </div>
          )}
        </div>
      ) : (
        <div
          className="sheet-destination skipped-destination"
          data-testid={`sheet-destination-${target.layerId}`}
          data-droppable="false"
          aria-disabled="true"
          role="cell"
        >
          <strong>Keep current</strong>
          <span>Sheet copy will not be applied</span>
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
