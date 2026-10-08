import type { PluginToUiMessage } from '@string-binder/contracts';

export function post(message: PluginToUiMessage): void {
  figma.ui.postMessage(message);
}

/**
 * Shows long controller work in the plugin (label and progress) so a busy
 * Figma reads as progress, not a freeze. `label: null` ends it.
 */
export function activity(key: string, label: string | null, done?: number, total?: number): void {
  post({ type: 'activity', key, label, ...(total ? { done: done ?? 0, total } : {}) });
}
