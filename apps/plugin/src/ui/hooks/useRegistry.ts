import type { BindingResult, Catalog } from '@string-binder/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UiBridge } from '../bridge';
import { EMPTY_CATALOG, message } from '../shared';
import { request } from '../workflow-client';
import type { Registry } from '../writer/Writer';

/**
 * Keeps the saved-copy catalog fresh: polls every 30 s (with jitter, backing off
 * while offline). Each poll also brings this file's local copy values up to date.
 */
export function useRegistry(bridge: UiBridge): Registry & { setCatalog: (c: Catalog) => void } {
  const [catalog, setCatalogState] = useState<Catalog>(EMPTY_CATALOG);
  // Re-indexing tens of thousands of records is costly, so an unchanged catalog keeps its identity.
  const setCatalog = useCallback(
    (next: Catalog) => setCatalogState((current) => (sameCatalog(current, next) ? current : next)),
    [],
  );
  const [status, setStatus] = useState('Connecting…');
  const [issue, setIssue] = useState('');
  const [connected, setConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const running = useRef<Promise<void> | null>(null);
  const failures = useRef(0);

  const run = useCallback(
    async (force: boolean) => {
      setRefreshing(true);
      try {
        // The catalog itself arrives as `registry:catalog`, only when it changed.
        const result = await request<{ result: BindingResult }>(bridge, 'refresh', { force });
        failures.current = 0;
        setConnected(true);
        setStatus(
          `Up to date · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        );
        const kept = result.result.conflicts.length;
        setIssue(
          kept
            ? `${kept} string${kept === 1 ? ' was' : 's were'} edited by hand in this file and kept that wording.`
            : '',
        );
      } catch (e) {
        failures.current += 1;
        setConnected(false);
        setStatus(message(e));
        try {
          setCatalog(await request<Catalog>(bridge, 'catalog', { cached: true }));
        } catch {
          /* Binding existing library strings still works offline. */
        }
      } finally {
        setRefreshing(false);
      }
    },
    [bridge, setCatalog],
  );
  /** Joins a refresh already running instead of skipping, so callers see fresh data. */
  const refresh = useCallback(
    (force = false) => {
      running.current ??= run(force).finally(() => {
        running.current = null;
      });
      return running.current;
    },
    [run],
  );

  useEffect(
    () =>
      bridge.subscribe((event) => {
        if (event.type === 'registry:catalog') setCatalog(event.catalog);
      }),
    [bridge, setCatalog],
  );
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await refresh();
      if (!cancelled)
        timer = setTimeout(
          () => void tick(),
          Math.min(30000 * 2 ** Math.min(failures.current, 4), 300000) +
            Math.floor(Math.random() * 4000),
        );
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refresh]);

  return { catalog, setCatalog, connected, status, issue, refreshing, refresh };
}

function sameCatalog(a: Catalog, b: Catalog): boolean {
  return (
    a === b ||
    (a.seq === b.seq &&
      a.records.length === b.records.length &&
      a.mappings.length === b.mappings.length &&
      a.products.length === b.products.length)
  );
}
