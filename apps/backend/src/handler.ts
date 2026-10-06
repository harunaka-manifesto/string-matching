import {
  MutationBatchSchema,
  CopyRecordSchema,
  LibraryRequestSchema,
} from '@string-binder/contracts';
import {
  bilingualErrors,
  canonical,
  copyKeyStem,
  isCopyId,
  recordFingerprint,
  sha256,
} from '@string-binder/domain';
export type BackendDependencies = {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  tokens: { hash: string; role: 'writer' | 'publisher' }[];
  onResult?: (event: {
    operation: string;
    status: number;
    elapsedMs: number;
    requestId?: string;
    error?: string;
  }) => void;
};
const statuses: Record<string, number> = {
  VALIDATION: 422,
  REQUEST_REUSED: 409,
  REVISION_CONFLICT: 409,
  DUPLICATE_COPY_ID: 409,
  LEASE: 409,
  DESTINATION: 409,
};
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-copy-token',
};
export function registryHandler(deps: BackendDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const started = Date.now();
    let requestId: string | undefined;
    const operation = request.url.split('?')[0]!.split('/').at(-1) ?? '';
    const respond = (value: unknown, status = 200) => {
      deps.onResult?.({
        operation,
        status,
        elapsedMs: Date.now() - started,
        requestId,
        error:
          value && typeof value === 'object' && 'error' in value ? String(value.error) : undefined,
      });
      return Response.json(value, {
        status,
        headers: { ...cors, ...(status === 429 ? { 'Retry-After': '60' } : {}) },
      });
    };
    const hash = sha256(request.headers.get('x-copy-token') ?? '');
    const credential = deps.tokens.find(
      (t) =>
        t.hash.length === hash.length &&
        [...hash].reduce((n, c, i) => n | (c.charCodeAt(0) ^ t.hash.charCodeAt(i)), 0) === 0,
    );
    if (!credential)
      return respond(
        { error: 'UNAUTHORIZED', message: 'Team access token is missing or revoked' },
        401,
      );
    try {
      if (!(await deps.rpc('copy_registry_rate', { credential: hash, allowed: 180 })))
        return respond({ error: 'RATE_LIMIT', message: 'Too many requests; retry shortly' }, 429);
      const url = new URL(request.url);
      const action = url.pathname.split('/').at(-1);
      if (
        (['submit', 'library'].includes(action ?? '') && request.method !== 'POST') ||
        (['catalog', 'changes', 'request', 'revision'].includes(action ?? '') &&
          request.method !== 'GET')
      )
        return respond({ error: 'METHOD', message: 'Use the documented request method' }, 405);
      let args: any = {};
      if (request.method !== 'GET') {
        const bytes = await request.arrayBuffer();
        if (bytes.byteLength > 4 * 1024 * 1024)
          return respond(
            { error: 'VALIDATION', message: 'Review a smaller batch; request exceeds 4MB' },
            413,
          );
        try {
          args = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          return respond({ error: 'VALIDATION', message: 'Invalid JSON request' }, 422);
        }
      }
      let result: unknown;
      switch (action) {
        case 'catalog':
          result = await deps.rpc('copy_registry_catalog');
          break;
        case 'changes': {
          const after = Number(url.searchParams.get('after') ?? 0);
          if (!Number.isSafeInteger(after) || after < 0)
            return respond({ error: 'VALIDATION', message: 'Invalid change cursor' }, 422);
          result = await deps.rpc('copy_registry_changes', { after_seq: after });
          break;
        }
        case 'request':
          result = await deps.rpc('copy_registry_request', {
            request_id: url.searchParams.get('id'),
          });
          break;
        case 'revision':
          result = await deps.rpc('copy_registry_revision', {
            copy_id: url.searchParams.get('id'),
            revision: Number(url.searchParams.get('revision')),
          });
          break;
        case 'submit': {
          const batch = MutationBatchSchema.parse(args);
          requestId = batch.requestId;
          const products = (await deps.rpc('copy_registry_products')) as {
            id: string;
            keyToken: string;
          }[];
          const operations = batch.operations.map((op) => {
            if (!isCopyId(op.copyId)) throw new Error('Invalid Copy ID');
            if (op.action === 'reuse') return op;
            const errors = bilingualErrors(op.en, op.id);
            if (errors.length) throw new Error(errors.join('; '));
            if (op.action === 'edit') return op;
            const p = products.find((p) => p.id === op.product);
            if (!p) throw new Error('Choose a configured product');
            return { ...op, stem: copyKeyStem({ product: p.keyToken, ...op.context }) };
          });
          result = await deps.rpc('copy_registry_submit', {
            batch: { ...batch, operations },
            payload_hash: sha256(canonical(batch)),
          });
          break;
        }
        case 'library': {
          if (credential.role !== 'publisher')
            return respond({ error: 'FORBIDDEN', message: 'Publisher credential required' }, 403);
          const parsed = LibraryRequestSchema.parse(args);
          if (parsed.operation === 'start') {
            const saved = (await deps.rpc('copy_registry_manifest', {
              manifest: parsed.args.manifest,
            })) as unknown[];
            const byId = new Map(
              saved.map((value) => {
                const r = CopyRecordSchema.parse(value);
                return [r.copyId + ':' + r.revision, r];
              }),
            );
            for (const entry of parsed.args.manifest) {
              const r = byId.get(entry.copyId + ':' + entry.revision);
              if (!r) throw new Error('Manifest revision is missing');
              if (entry.fingerprint !== recordFingerprint(r))
                throw new Error('Manifest fingerprint does not match saved revision');
            }
          }
          result = await deps.rpc('copy_registry_library', parsed);
          break;
        }
        default:
          return respond({ error: 'NOT_FOUND' }, 404);
      }
      if (result && typeof result === 'object' && 'error' in result)
        return respond(result, statuses[String(result.error)] ?? 422);
      return respond(result);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'ZodError' ||
          /Invalid|Choose|Shorten|EN|ID|placeholder|Manifest/u.test(error.message))
      )
        return respond({ error: 'VALIDATION', message: error.message }, 422);
      return respond(
        {
          error: 'UNAVAILABLE',
          message: 'Registry operation unavailable; keep the request ID and retry',
        },
        503,
      );
    }
  };
}
