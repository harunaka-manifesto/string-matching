import { readPrivate, writePrivate } from './private-storage';
import type { Catalog } from '@string-binder/contracts';
import { CatalogSchema, MappingSchema } from '@string-binder/contracts';
declare const REGISTRY_URL: string;
declare const REGISTRY_TOKEN: string;
const configuredUrl = typeof REGISTRY_URL === 'string' ? REGISTRY_URL : '';
const configuredToken = typeof REGISTRY_TOKEN === 'string' ? REGISTRY_TOKEN : '';
export class WorkflowError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export type Settings = { publisherToken?: string; libraryId?: string; fileKey?: string };
export const settings = async (): Promise<Settings> =>
  ((await figma.clientStorage.getAsync('registry:settings')) ?? {}) as Settings;
/** Per-install ID the registry rate-limits by; not a credential or a verified identity. */
async function deviceId(): Promise<string> {
  return String((await figma.clientStorage.getAsync('registry:device').catch(() => '')) ?? '');
}
export async function api(action: string, data?: unknown, publisher = false): Promise<unknown> {
  if (!configuredUrl)
    throw new WorkflowError(
      'NOT_CONFIGURED',
      'Registry is not configured. Existing Figma bindings remain available.',
    );
  const token = publisher ? (await settings()).publisherToken : configuredToken;
  if (!token)
    throw new WorkflowError(
      'NOT_CONFIGURED',
      publisher ? 'Enter a publisher credential in Library sync.' : 'Team token is not configured.',
    );
  let response;
  try {
    response = await fetch(`${configuredUrl}/${action}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-copy-token': token,
        'x-copy-device': await deviceId(),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  } catch {
    throw new WorkflowError(
      'UNAVAILABLE',
      'Registry unavailable. Your draft and request ID are preserved.',
    );
  }
  let body;
  try {
    body = await response.json();
  } catch {
    // Gateways answer outages with non-JSON pages; never report those as a definite rejection.
    throw new WorkflowError(
      'UNAVAILABLE',
      'Registry unavailable. Your draft and request ID are preserved.',
    );
  }
  if (!response.ok)
    throw new WorkflowError(
      body?.error ?? 'UNAVAILABLE',
      body?.message ?? 'Registry request failed',
      body,
    );
  return body;
}
const catalogKey = `registry:catalog:${configuredUrl}`;
let cached: Catalog | null = null;
let inFlight: Promise<Catalog> | null = null;
/** Overlapping callers share one fetch, so delta pages are never applied twice at once. */
export function catalog(force = false): Promise<Catalog> {
  if (inFlight) return inFlight;
  if (!force && cached) return Promise.resolve(cached);
  inFlight = loadCatalog(force).finally(() => {
    inFlight = null;
  });
  return inFlight;
}
async function loadCatalog(force: boolean): Promise<Catalog> {
  if (!cached) cached = (await readPrivate<Catalog>(catalogKey).catch(() => undefined)) ?? null;
  if (force || !cached) {
    let changed = false;
    if (!cached) {
      cached = CatalogSchema.parse(await api('catalog'));
      changed = true;
    } else {
      let more = true;
      while (more) {
        const delta = (await api(`changes?after=${cached.seq}`)) as {
          seq: number;
          events: { type: string; record: unknown }[];
          more: boolean;
        };
        if (delta.events.length) changed = true;
        const records = new Map(cached.records.map((r) => [r.copyId, r]));
        const mappings = new Map(cached.mappings.map((m) => [m.libraryId + ':' + m.copyId, m]));
        for (const event of delta.events) {
          if (event.type === 'copy') {
            const r = CatalogSchema.shape.records.element.parse(event.record);
            records.set(r.copyId, r);
          }
          if (event.type === 'mapping') {
            const m = MappingSchema.parse(event.record);
            mappings.set(m.libraryId + ':' + m.copyId, m);
          }
        }
        cached.records = [...records.values()];
        cached.mappings = [...mappings.values()];
        cached.seq = delta.seq;
        more = delta.more;
      }
    }
    if (changed) await writePrivate(catalogKey, cached, false);
  }
  return cached;
}
export async function latestCatalog(): Promise<Catalog> {
  cached = CatalogSchema.parse(await api('catalog'));
  await writePrivate(catalogKey, cached, false);
  return cached;
}
