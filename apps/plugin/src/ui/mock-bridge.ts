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

  const params = new URLSearchParams(location.search);
  const frameName = params.get('frame') ?? 'Investment – Landing page';
  let listing: LibraryListingItem[] = [];
  const humanize = (name: string) =>
    name
      .slice(name.lastIndexOf('/') + 1)
      .replace(/^gopay_[a-z]+_/u, '')
      .replace(/_/gu, ' ');
  // Values shared by many products, to exercise product ranking.
  const extras: [string, string, string][] = [
    ['investment/gopay_investment_onboarding_gotit_cta', 'Got it', 'Oke, paham'],
    ['transfer/gopay_transfer_success_gotit_cta', 'Got it', 'Oke'],
    ['savings/gopay_savings_termdeposit_gotit_cta', 'Got it', 'Oke'],
    ['shared/gopay_shared_cta_gotit', 'Got it', 'Oke'],
    ['shared/gopay_shared_cta_continue', 'Continue', 'Lanjut'],
    ['transfer/gopay_transfer_confirm_continue_cta', 'Continue', 'Lanjut'],
  ];
  const values = new Map(extras.map(([name, en, id]) => [name, { en, id }]));

  const layers: LayerInfo[] = [
    ['Title', 'Lorem ipsum dolor'],
    ['Subtitle', 'Lorem ipsum dolor sit amet consectetur'],
    ['Amount', 'Rp10.000'],
    ['Label', 'Lorem ipsum'],
    ['Body', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.'],
    ['Date', '12 Agu 2026'],
    ['Caption', 'Start investing from Rp10.000'],
    ['Button label', 'Got it'],
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
  const selection = (): SelectionInfo => ({
    frameId: '1:0',
    frameName,
    contextNames: [frameName, 'Flows'],
    layers,
  });

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async send(message) {
      switch (message.type) {
        case 'ui:ready':
          emit({ type: 'index:cached', bytes: null });
          emit({ type: 'selection', selection: selection() });
          return;
        case 'index:sync': {
          const tabs = JSON.parse(await gunzipText(base64ToBytes(ORDER_INDEX_GZIP_BASE64))) as {
            tabs: Record<string, string[]>;
          };
          const all = Object.values(tabs.tabs).flat();
          const names = [
            ...new Set([
              ...(tabs.tabs.INVESTMENT?.slice(0, 400) ?? []),
              ...(tabs.tabs.TRANSFER?.slice(0, 200) ?? []),
              ...all.filter((name) => name.startsWith('shared/')).slice(0, 60),
              ...extras.map(([name]) => name),
            ]),
          ];
          listing = [...names].sort().map((name, order) => ({
            key: `key-${order}`,
            name,
            collection: '# Legacy 5',
            order,
          }));
          emit({ type: 'index:listing', listing, toImport: listing.length });
          const loaded = listing.map((item) => ({
            key: item.key,
            en: values.get(item.name)?.en ?? humanize(item.name),
            id: values.get(item.name)?.id ?? `ID: ${humanize(item.name)}`,
            description: '',
          }));
          // Arrive in batches like the real import, so progress UI shows.
          for (let start = 0; start < loaded.length; start += 150)
            emit({
              type: 'index:values',
              values: loaded.slice(start, start + 150),
              done: Math.min(start + 150, loaded.length),
              total: loaded.length,
            });
          emit({ type: 'index:synced', failed: 0 });
          // The Caption layer starts bound, so "Replaces" and "Unbinds" can be tried.
          const caption = listing.find(
            (item) => item.name === 'investment/gopay_investment_onboarding_gotit_cta',
          );
          if (caption && !layers[6]!.boundKey && !params.has('fresh')) {
            layers[6] = { ...layers[6]!, boundKey: caption.key, boundName: caption.name };
            emit({ type: 'selection', selection: selection() });
          }
          emit({ type: 'usage', keys: listing.slice(0, 40).map((item) => item.key) });
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
