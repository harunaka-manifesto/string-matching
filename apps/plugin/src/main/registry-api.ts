import { strFromU8 } from 'fflate';
import type { Catalog, UiToPluginMessage } from '@string-binder/contracts';
import { post } from './channel';
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
async function send(action: string, data?: unknown, publisher = false) {
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
  try {
    return await fetch(`${configuredUrl}/${action}`, {
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
}
function rejected(ok: boolean, body: any): void {
  if (!ok)
    throw new WorkflowError(
      body?.error ?? 'UNAVAILABLE',
      body?.message ?? 'Registry request failed',
      body,
    );
}
export async function api(action: string, data?: unknown, publisher = false): Promise<unknown> {
  const response = await send(action, data, publisher);
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
  rejected(response.ok, body);
  return body;
}
/**
 * A registry GET as raw bytes. The catalog is about 10 MB of JSON: parsing it
 * here, on Figma's main thread, froze Figma, so the UI parses it instead.
 */
export async function apiBytes(action: string): Promise<Uint8Array> {
  const response = await send(action);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    throw new WorkflowError(
      'UNAVAILABLE',
      'Registry unavailable. Your draft and request ID are preserved.',
    );
  }
  if (!response.ok) {
    let body;
    try {
      body = JSON.parse(strFromU8(bytes));
    } catch {
      /* Non-JSON outage page. */
    }
    rejected(false, body);
  }
  return bytes;
}
/** Where the UI keeps the gzipped catalog. Older builds stored the same format here. */
export const CATALOG_KEY = `registry:catalog:${configuredUrl}`;
export type CatalogSlice = Catalog & { online: boolean };
const waiting = new Map<
  string,
  { resolve: (slice: CatalogSlice) => void; reject: (e: Error) => void }
>();
let queries = 0;
/**
 * Saved records for `copyIds` (plus the records they were merged into), their
 * mappings, and every product. The UI holds the catalog; the controller only
 * ever sees the records it asks for. `fresh` pulls registry changes first;
 * offline, the UI answers from what it has with `online: false`.
 */
export function catalog(copyIds: readonly string[] = [], fresh = false): Promise<CatalogSlice> {
  const queryId = String((queries += 1));
  return new Promise((resolve, reject) => {
    waiting.set(queryId, { resolve, reject });
    post({ type: 'catalog:query', queryId, copyIds: [...new Set(copyIds)], fresh });
  });
}
export function answerCatalog(
  answer: Extract<UiToPluginMessage, { type: 'catalog:answer' }>,
): void {
  const query = waiting.get(answer.queryId);
  if (!query) return;
  waiting.delete(answer.queryId);
  if (answer.error) query.reject(new WorkflowError('UNAVAILABLE', answer.error));
  else
    query.resolve({
      seq: answer.seq,
      records: answer.records,
      mappings: answer.mappings,
      products: answer.products,
      online: answer.online,
    });
}
