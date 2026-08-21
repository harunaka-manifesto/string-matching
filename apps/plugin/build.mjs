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
  define: {
    __BACKEND_BASE_URL__: JSON.stringify(process.env.BACKEND_BASE_URL ?? 'http://127.0.0.1:8787'),
    __PLUGIN_VERSION__: JSON.stringify(process.env.PLUGIN_VERSION ?? '2.2.0'),
    __ENABLE_PUBLIC_SHEET_TEST_MODE__: JSON.stringify(
      process.env.ENABLE_PUBLIC_SHEET_TEST_MODE === 'true',
    ),
  },
});
await copyFile(resolve(root, 'dist/ui-build/src/ui/index.html'), resolve(dist, 'ui.html'));
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const backendOrigin = new URL(process.env.BACKEND_BASE_URL ?? 'https://ux-copy-sync.example.com')
  .origin;
await writeFile(
  resolve(dist, 'manifest.json'),
  JSON.stringify(
    {
      ...manifest,
      main: 'code.js',
      ui: 'ui.html',
      networkAccess: { ...manifest.networkAccess, allowedDomains: [backendOrigin] },
    },
    null,
    2,
  ) + '\n',
);
console.log(`Plugin built in ${dist}`);
