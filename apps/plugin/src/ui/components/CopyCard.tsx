import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { SheetValue } from '@ux-copy-sync/contracts';

export function CopyCard({
  replacement,
  disabled,
  onMove,
  onExclude,
  onRestore,
  variant = 'active',
  canMoveUp = true,
  canMoveDown = true,
  dragOverlay = false,
}: {
  replacement: SheetValue;
  disabled: boolean;
  onMove: (delta: -1 | 1) => void;
  onExclude?: () => void;
  onRestore?: () => void;
  variant?: 'active' | 'excluded';
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  dragOverlay?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const draggable = useDraggable({ id: replacement.id, disabled: disabled || dragOverlay });
  const long = replacement.value.split(/\r\n?|\n/).length > 4 || replacement.value.length > 240;
  const className = [
    'copy-card',
    variant === 'excluded' ? 'is-excluded' : '',
    draggable.isDragging ? 'is-dragging' : '',
    dragOverlay ? 'drag-overlay-card' : '',
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
      <button
        className="drag-handle"
        ref={dragOverlay ? undefined : draggable.setActivatorNodeRef}
        {...(dragOverlay ? {} : draggable.attributes)}
        {...(dragOverlay ? {} : draggable.listeners)}
        disabled={disabled || dragOverlay}
        aria-label={
          variant === 'excluded'
            ? `Drag excluded ${replacement.cell} copy to restore it into a Figma row`
            : `Drag ${replacement.cell} copy to move it between Figma rows`
        }
        title={variant === 'excluded' ? 'Drag onto a destination to restore' : 'Drag to reorder'}
      >
        <span aria-hidden="true">⠿</span>
      </button>
      <div className="copy-content">
        <div className={`copy-value ${expanded ? 'expanded' : ''}`} title={replacement.value}>
          {replacement.value}
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
            {!dragOverlay && variant === 'active' && onExclude && (
              <button
                className="text-button candidate-action"
                onClick={onExclude}
                disabled={disabled}
                aria-label={`Exclude ${replacement.cell} from this apply`}
                title="Exclude from this apply"
              >
                Exclude
              </button>
            )}
            {!dragOverlay && variant === 'excluded' && onRestore && (
              <button
                className="text-button candidate-action"
                onClick={onRestore}
                disabled={disabled}
                aria-label={`Restore excluded ${replacement.cell}`}
                title="Restore excluded copy"
              >
                Restore
              </button>
            )}
            {!dragOverlay && variant === 'active' && (
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
          </span>
        </div>
      </div>
    </div>
  );
}
