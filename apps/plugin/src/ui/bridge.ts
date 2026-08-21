import {
  PluginToUiMessageSchema,
  type PluginToUiMessage,
  type UiToPluginMessage,
} from '@ux-copy-sync/contracts';

export type UiBridge = {
  send: (message: UiToPluginMessage) => void;
  subscribe: (listener: (message: PluginToUiMessage) => void) => () => void;
};

export function productionBridge(): UiBridge {
  return {
    send: (message) => parent.postMessage({ pluginMessage: message }, '*'),
    subscribe: (listener) => {
      const handler = (event: MessageEvent) => {
        const parsed = PluginToUiMessageSchema.safeParse(event.data?.pluginMessage);
        if (parsed.success) listener(parsed.data);
      };
      window.addEventListener('message', handler);
      return () => window.removeEventListener('message', handler);
    },
  };
}
