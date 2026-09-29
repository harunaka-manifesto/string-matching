import { build } from 'esbuild';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build as viteBuild } from 'vite';

const root = resolve(new URL('.', import.meta.url).pathname);
const dist = resolve(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await viteBuild({ configFile: resolve(root, 'vite.config.ts'), mode: 'production' });
await build({
  entryPoints: [resolve(root, 'src/main/index.ts')],
  outfile: resolve(dist, 'code.js'),
  bundle: true,
  format: 'iife',
  platform: 'neutral',
  target: 'es2020',
  sourcemap: false,
});
await copyFile(resolve(root, 'dist/ui-build/src/ui/index.html'), resolve(dist, 'ui.html'));
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.base.json'), 'utf8'));
await writeFile(resolve(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Plugin ready. Import: ${resolve(dist, 'manifest.json')}`);
