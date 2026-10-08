import { useEffect, useSyncExternalStore } from 'react';
import type { UiBridge } from './bridge';

/** Long-running work, from the UI and from the plugin controller, shown in the activity bar. */
export type Activity = { key: string; label: string; done?: number; total?: number };

let tasks = new Map<string, Activity>();
let snapshot: Activity[] = [];
const listeners = new Set<() => void>();

/** Starts, updates or (with a null label) ends the task `key`. */
export function setActivity(key: string, label: string | null, done?: number, total?: number) {
  const next = new Map(tasks);
  if (label) next.set(key, { key, label, ...(total ? { done: done ?? 0, total } : {}) });
  else if (!next.delete(key)) return;
  tasks = next;
  snapshot = [...next.values()];
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Every task in progress, oldest first. */
export function useActivity(bridge: UiBridge): Activity[] {
  useEffect(
    () =>
      bridge.subscribe((event) => {
        if (event.type === 'activity') setActivity(event.key, event.label, event.done, event.total);
      }),
    [bridge],
  );
  return useSyncExternalStore(subscribe, () => snapshot);
}
