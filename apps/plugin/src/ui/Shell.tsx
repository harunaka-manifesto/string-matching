import { useRef, useState } from 'react';
import { useActivity } from './activity';
import type { UiBridge } from './bridge';
import { Icon } from './components/Icon';
import { useRegistry } from './hooks/useRegistry';
import { LibrarySync } from './library/LibrarySync';
import { Writer } from './writer/Writer';

/** Corner handle that resizes the plugin window and remembers the size. */
function ResizeGrip({ bridge }: { bridge: UiBridge }) {
  const start = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const frame = useRef(0);
  const send = (event: PointerEvent | React.PointerEvent, persist = false) => {
    if (!start.current) return;
    const width = start.current.width + event.clientX - start.current.x;
    const height = start.current.height + event.clientY - start.current.y;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() =>
      bridge.send({ type: 'window:resize', width, height, persist }),
    );
  };
  return (
    <div
      className="resize-grip"
      role="separator"
      aria-label="Resize plugin window"
      title="Drag to resize"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = {
          x: event.clientX,
          y: event.clientY,
          width: window.innerWidth,
          height: window.innerHeight,
        };
      }}
      onPointerMove={(event) => send(event)}
      onPointerUp={(event) => {
        send(event, true);
        start.current = null;
      }}
    >
      <Icon name="grip" />
    </div>
  );
}

/** What the plugin is busy with right now, with progress when it is countable. */
function ActivityBar({ bridge }: { bridge: UiBridge }) {
  const tasks = useActivity(bridge);
  const task = tasks.find((t) => t.total) ?? tasks[0];
  if (!task) return null;
  const more = tasks.length - 1;
  return (
    <div className="activity" role="status" aria-live="polite">
      <span className="activity__spinner" aria-hidden="true" />
      <span className="activity__label">
        {task.label}…{more > 0 ? ` (+${more} more)` : ''}
      </span>
      {task.total ? (
        <span className="activity__count">
          {Math.min(task.done ?? 0, task.total).toLocaleString()} / {task.total.toLocaleString()}
        </span>
      ) : null}
      {task.total ? (
        <div className="progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${Math.min(1, (task.done ?? 0) / task.total)})` }} />
        </div>
      ) : null}
    </div>
  );
}

export function Shell({ bridge }: { bridge: UiBridge }) {
  const registry = useRegistry(bridge);
  const [mode, setMode] = useState<'writer' | 'library'>('writer');
  return (
    <div className="shell">
      <ActivityBar bridge={bridge} />
      {/* Kept mounted so the writer's frame, search and drafts survive a trip to Library sync. */}
      <div className="shell__pane" hidden={mode !== 'writer'}>
        <Writer
          bridge={bridge}
          registry={registry}
          active={mode === 'writer'}
          onLibrary={() => setMode('library')}
        />
      </div>
      {mode === 'library' && (
        <div className="shell__pane shell__pane--library">
          <header className="library-head">
            <button
              type="button"
              className="icon-button"
              aria-label="Back to text layers"
              onClick={() => setMode('writer')}
            >
              <Icon name="back" />
            </button>
            <h1>Library sync</h1>
            <span className="eyebrow">For library maintainers</span>
          </header>
          <LibrarySync bridge={bridge} />
        </div>
      )}
      <ResizeGrip bridge={bridge} />
    </div>
  );
}
