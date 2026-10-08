import type { BindingResult, Catalog } from '@string-binder/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UiBridge } from '../bridge';
import { EMPTY_CATALOG, message } from '../shared';
import { request } from '../workflow-client';
import { catalogStore } from '../catalog-store';
import type { Registry } from '../writer/Writer';

/**
 * Keeps the saved-copy catalog fresh: polls every 30 s (with jitter, backing off
 * while offline). Each poll pulls registry changes into the UI's catalog, then
 * brings this file's local copy values up to date.
 */
export function useRegistry(bridge: UiBridge): Registry {
  const store = catalogStore(bridge);
  const [catalog, setCatalog] = useState<Catalog>(() => store.get() ?? EMPTY_CATALOG);
  useEffect(() => store.subscribe(setCatalog), [store]);
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
        await store.sync();
        if (!store.online()) throw new Error('Registry unreachable. Showing saved copy.');
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
        // Binding existing library strings still works offline, from the saved catalog.
        failures.current += 1;
        setConnected(false);
        setStatus(message(e));
      } finally {
        setRefreshing(false);
      }
    },
    [bridge, store],
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

  return { catalog, connected, status, issue, refreshing, refresh };
}
