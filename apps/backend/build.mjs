import { build } from 'esbuild';

await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  packages: 'bundle',
  external: ['node:*'],
});
console.log('Backend bundle written to dist/server.cjs');
