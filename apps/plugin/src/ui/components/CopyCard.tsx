import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { SheetValue } from '@ux-copy-sync/contracts';
import { InlineDiff } from './InlineDiff';

export function CopyCard({
  replacement,
  disabled,
  onMove,
  canMoveUp = true,
  canMoveDown = true,
  dragOverlay = false,
  onExclude,
  onRestore,
  originalText,
}: {
  replacement: SheetValue;
  disabled: boolean;
  onMove: (delta: -1 | 1) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  dragOverlay?: boolean;
  onExclude?: () => void;
  onRestore?: () => void;
  originalText?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const draggable = useDraggable({
    id: replacement.id,
    disabled: disabled || dragOverlay || Boolean(onRestore),
  });
  const long = replacement.value.split(/\r\n?|\n/).length > 4 || replacement.value.length > 240;
  const className = [
    'copy-card',
    draggable.isDragging ? 'is-dragging' : '',
    dragOverlay ? 'drag-overlay-card' : '',
    onRestore ? 'excluded-copy' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={dragOverlay ? undefined : draggable.setNodeRef}
      className={className}
      data-testid={`copy-card-${replacement.id}`}
      data-replacement-id={replacement.id}
    >
      {!onRestore && (
        <button
          className="drag-handle"
          ref={dragOverlay ? undefined : draggable.setActivatorNodeRef}
          {...(dragOverlay ? {} : draggable.attributes)}
          {...(dragOverlay ? {} : draggable.listeners)}
          disabled={disabled || dragOverlay}
          aria-label={`Drag ${replacement.cell} copy to move it between Figma rows`}
          title="Drag to move between rows"
        >
          <span aria-hidden="true">⠿</span>
        </button>
      )}
      <div className="copy-content">
        <div className={`copy-value ${expanded ? 'expanded' : ''}`} title={replacement.value}>
          {originalText === undefined ? (
            replacement.value
          ) : (
            <InlineDiff current={originalText} next={replacement.value} side="next" />
          )}
        </div>
        <div className="copy-meta">
          <span className="copy-cell">{replacement.cell}</span>
          <span className="copy-actions">
            {long && (
              <button
                className="text-button"
                onClick={() => setExpanded((current) => !current)}
                aria-label={`${expanded ? 'Show less' : 'Show more'} for ${replacement.cell}`}
              >
                {expanded ? 'Less' : 'More'}
              </button>
            )}
            {!dragOverlay && (
              <span className="move-actions">
                <button
                  className="icon-button"
                  onClick={() => onMove(-1)}
                  disabled={disabled || !canMoveUp}
                  aria-label={`Move ${replacement.cell} copy up`}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  className="icon-button"
                  onClick={() => onMove(1)}
                  disabled={disabled || !canMoveDown}
                  aria-label={`Move ${replacement.cell} copy down`}
                  title="Move down"
                >
                  ↓
                </button>
              </span>
            )}
            {onExclude && !dragOverlay && (
              <button
                className="text-button exclude-button"
                onClick={onExclude}
                disabled={disabled}
                aria-label={`Exclude ${replacement.cell} from active Sheet values`}
              >
                Exclude
              </button>
            )}
            {onRestore && !dragOverlay && (
              <button
                className="text-button restore-button"
                onClick={onRestore}
                disabled={disabled}
                aria-label={`Restore ${replacement.cell} to active Sheet values`}
              >
                Restore
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
