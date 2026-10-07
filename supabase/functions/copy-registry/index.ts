// Generated handler is bundled by pnpm build:backend; database keys never ship to Figma.
// @ts-ignore Generated deployment artifact.
import { DatabaseError, registryHandler } from './handler.js';
/** SHA-256 hex hashes from an env var. Anything else is almost always a raw token pasted by mistake. */
function hashes(name: string, role: 'writer' | 'publisher') {
  const entries = (Deno.env.get(name) ?? '')
    .split(',')
    .map((hash) => hash.trim().toLowerCase())
    .filter(Boolean);
  const valid = entries.filter((hash) => /^[a-f0-9]{64}$/.test(hash));
  if (valid.length !== entries.length)
    console.error(
      `${name}: ignored ${entries.length - valid.length} entr${entries.length - valid.length === 1 ? 'y' : 'ies'} that ` +
        'are not 64-character SHA-256 hex. Store the hash of the token, not the token itself.',
    );
  if (!valid.length) console.error(`${name}: no valid ${role} credential is configured.`);
  return valid.map((hash) => ({ hash, role }));
}
const tokens = [
  ...hashes('COPY_TEAM_TOKEN_HASHES', 'writer'),
  ...hashes('COPY_PUBLISHER_TOKEN_HASHES', 'publisher'),
];
const secrets = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
const key = secrets.default ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
Deno.serve(
  registryHandler({
    tokens,
    onResult: (event) => console.info(JSON.stringify(event)),
    rpc: async (name, args = {}) => {
      const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: key,
          ...(key?.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify(args),
      });
      if (!response.ok) {
        // PostgREST reports the SQLSTATE; definite failures must not look like outages.
        const body = await response.json().catch(() => null);
        if (body?.code) throw new DatabaseError(String(body.code), String(body.message ?? ''));
        throw new Error('Database operation failed');
      }
      return response.json();
    },
  }),
);
