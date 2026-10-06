import { build } from 'esbuild';
await build({
  entryPoints: ['apps/backend/src/handler.ts'],
  outfile: 'supabase/functions/copy-registry/handler.js',
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
});

await build({
  entryPoints: ['apps/backend/src/mcp/extract.ts'],
  outfile: 'apps/backend/dist/extract.js',
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
});
await build({
  entryPoints: ['apps/backend/src/mcp/assemble.ts'],
  outfile: 'apps/backend/dist/assemble.mjs',
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
});
