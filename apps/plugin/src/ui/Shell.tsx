import { useRef, useState } from 'react';
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

export function Shell({ bridge }: { bridge: UiBridge }) {
  const registry = useRegistry(bridge);
  const [mode, setMode] = useState<'writer' | 'library'>('writer');
  return (
    <div className="shell">
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
          <LibrarySync bridge={bridge} onCatalog={registry.setCatalog} />
        </div>
      )}
      <ResizeGrip bridge={bridge} />
    </div>
  );
}
