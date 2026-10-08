import {
  PluginToUiMessageSchema,
  type PluginToUiMessage,
  type UiToPluginMessage,
} from '@string-binder/contracts';

export type UiBridge = {
  send: (message: UiToPluginMessage) => void;
  subscribe: (listener: (message: PluginToUiMessage) => void) => () => void;
};

/**
 * Bulk payloads (whole catalog, every library string) come from our own plugin
 * code, which already validated them. Deep-parsing them again in the iframe
 * cost hundreds of milliseconds per message, so only their type is checked.
 */
const TRUSTED = new Set<PluginToUiMessage['type']>([
  'catalog:cached',
  'index:listing',
  'index:values',
  'index:local',
  'workflow:result',
]);

export function productionBridge(): UiBridge {
  const listeners = new Set<(message: PluginToUiMessage) => void>();
  // One window listener parses each message once and fans it out.
  window.addEventListener('message', (event: MessageEvent) => {
    const raw = event.data?.pluginMessage;
    if (!raw || typeof raw.type !== 'string' || !listeners.size) return;
    let message: PluginToUiMessage;
    if (TRUSTED.has(raw.type)) message = raw as PluginToUiMessage;
    else {
      const parsed = PluginToUiMessageSchema.safeParse(raw);
      if (!parsed.success) return;
      message = parsed.data;
    }
    for (const listener of [...listeners]) listener(message);
  });
  return {
    send: (message) => parent.postMessage({ pluginMessage: message }, '*'),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
