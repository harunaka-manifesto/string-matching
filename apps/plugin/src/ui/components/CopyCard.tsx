import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { SheetValue } from '@ux-copy-sync/contracts';

export function CopyCard({
  replacement,
  disabled,
  onMove,
  canMoveUp = true,
  canMoveDown = true,
}: {
  replacement: SheetValue;
  disabled: boolean;
  onMove: (delta: -1 | 1) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const sortable = useSortable({ id: replacement.id, disabled });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  const long = replacement.value.split(/\r\n?|\n/).length > 4 || replacement.value.length > 240;
  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={`copy-card ${sortable.isDragging ? 'is-dragging' : ''}`}
    >
      <button
        className="drag-handle"
        ref={sortable.setActivatorNodeRef}
        {...sortable.attributes}
        {...sortable.listeners}
        disabled={disabled}
        aria-label={`Reorder Sheet copy from ${replacement.cell}`}
        title="Drag to reorder"
      >
        ⠿
      </button>
      <div className={`copy-value ${expanded ? 'expanded' : ''}`}>{replacement.value}</div>
      <div className="copy-meta">
        <span>Sheet · {replacement.cell}</span>
        <span className="copy-actions">
          {long && (
            <button
              className="text-button"
              onClick={() => setExpanded((current) => !current)}
              aria-label={`${expanded ? 'Show less' : 'Show more'} for ${replacement.cell}`}
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
          <button
            className="icon-button"
            onClick={() => onMove(-1)}
            disabled={disabled || !canMoveUp}
            aria-label={`Move ${replacement.cell} copy up`}
          >
            ↑
          </button>
          <button
            className="icon-button"
            onClick={() => onMove(1)}
            disabled={disabled || !canMoveDown}
            aria-label={`Move ${replacement.cell} copy down`}
          >
            ↓
          </button>
        </span>
      </div>
    </div>
  );
}
