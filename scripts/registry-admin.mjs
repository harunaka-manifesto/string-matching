import { build } from 'esbuild';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export async function models() {
  const outfile = resolve('apps/backend/dist/models.mjs');
  await build({
    entryPoints: ['packages/contracts/src/index.ts'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
  });
  return import(pathToFileURL(outfile).href);
}
export async function adminRpc(name, args = {}) {
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_ADMIN_KEY;
  if (!url || !key)
    throw new Error(
      'Set SUPABASE_URL and SUPABASE_ADMIN_KEY privately; never use the team token for administration',
    );
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    !/^[a-z0-9-]+\.supabase\.co$/u.test(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new Error('Administrator target must be your HTTPS Supabase project');
  const r = await fetch(`${parsed.origin}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: key,
      ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(args),
  });
  if (!r.ok) {
    // PostgREST explains database refusals in JSON; gateways (5xx) answer with a page.
    const detail = await r
      .json()
      .then((body) => (typeof body?.message === 'string' ? `: ${body.message}` : ''))
      .catch(() => '');
    throw new Error(
      `Administrator operation ${name} failed (${r.status})${detail}; inspect the private database logs`,
    );
  }
  return r.json();
}
