import type {
  LayerInfo,
  LibraryListingItem,
  PluginToUiMessage,
  SelectionInfo,
} from '@string-binder/contracts';
import { nonCopyReason } from '@string-binder/domain';
import { ORDER_INDEX_GZIP_BASE64 } from '../generated/order-index';
import type { UiBridge } from './bridge';
import { base64ToBytes, gunzipText } from './codec';

/** Dev-only stand-in for the Figma controller (`pnpm dev:ui`). */
export function mockBridge(): UiBridge {
  const listeners = new Set<(message: PluginToUiMessage) => void>();
  const emit = (message: PluginToUiMessage) =>
    setTimeout(() => listeners.forEach((listener) => listener(message)), 30);

  const layers: LayerInfo[] = [
    ['Title', 'Lorem ipsum dolor'],
    ['Subtitle', 'Lorem ipsum dolor sit amet consectetur'],
    ['Amount', 'Rp10.000'],
    ['Label', 'Lorem ipsum'],
    ['Body', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.'],
    ['Date', '12 Agu 2026'],
    ['Caption', 'Lorem ipsum dolor sit'],
    ['Button label', 'Lorem'],
  ].map(([name, characters], i) => ({
    id: `1:${i + 1}`,
    name: name!,
    characters: characters!,
    inInstance: name === 'Button label',
    boundKey: null,
    boundName: null,
    stored: null,
    autoSkipReason: nonCopyReason({ characters: characters!, layerName: name!, ancestorNames: [] }),
  }));
  const selection: SelectionInfo = {
    frameId: '1:0',
    frameName: 'Investment – Landing page',
    contextNames: ['Investment – Landing page', 'Investment', 'Flows'],
    layers,
  };

  let listing: LibraryListingItem[] = [];
  const humanize = (name: string) =>
    name
      .slice(name.lastIndexOf('/') + 1)
      .replace(/^gopay_[a-z]+_/u, '')
      .replace(/_/gu, ' ');

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async send(message) {
      switch (message.type) {
        case 'ui:ready':
          emit({ type: 'index:cached', bytes: null });
          emit({ type: 'selection', selection });
          return;
        case 'index:sync': {
          const tabs = JSON.parse(await gunzipText(base64ToBytes(ORDER_INDEX_GZIP_BASE64))) as {
            tabs: Record<string, string[]>;
          };
          const names = [...new Set(tabs.tabs.INVESTMENT?.slice(0, 400) ?? [])];
          listing = [...names].sort().map((name, order) => ({
            key: `key-${order}`,
            name,
            collection: '# Legacy 5: Investment',
            order,
          }));
          emit({ type: 'index:listing', listing, toImport: listing.length });
          const values = listing.map((item) => ({
            key: item.key,
            en: humanize(item.name),
            id: `ID: ${humanize(item.name)}`,
            description: '',
          }));
          emit({ type: 'index:values', values, done: values.length, total: values.length });
          emit({ type: 'index:synced', failed: 0 });
          return;
        }
        case 'apply':
          emit({
            type: 'apply:done',
            summary: {
              boundInFrame: message.decisions.filter((item) => item.action === 'bind').length,
              boundAcrossPage: 12,
              framesTouched: 3,
              skipsCopied: 4,
              conflicts: [
                { id: '9:1', name: 'Title', frameName: 'Investment – Landing page Copy' },
              ],
              failures: [],
              propagated: [
                { id: '9:2', name: 'Subtitle', frameName: 'Investment – Landing page Copy' },
              ],
            },
          });
          return;
        case 'flags:select':
          emit({ type: 'flags:selected', count: 0 });
          return;
        default:
          return;
      }
    },
  };
}
