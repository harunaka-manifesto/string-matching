import { build } from 'esbuild';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build as viteBuild } from 'vite';
import { backendOriginFor, validateBuiltManifest } from './build-utils.mjs';

const root = resolve(new URL('.', import.meta.url).pathname);
const dist = resolve(root, 'dist');
const mode = process.env.PLUGIN_BUILD_MODE === 'development' ? 'development' : 'production';
const backendBaseUrl =
  process.env.BACKEND_BASE_URL ??
  (mode === 'development' ? 'http://localhost:8787' : 'https://ux-copy-sync.example.com');
const backendOrigin = backendOriginFor(backendBaseUrl);
if (mode === 'development' && !backendOrigin.startsWith('http://localhost'))
  throw new Error('Development plugin builds must use an http://localhost backend URL.');
if (mode === 'production' && process.env.ENABLE_PUBLIC_SHEET_TEST_MODE === 'true')
  throw new Error('Production plugin builds cannot enable public Sheet test mode.');
process.env.BACKEND_BASE_URL = backendBaseUrl;
process.env.ENABLE_PUBLIC_SHEET_TEST_MODE = mode === 'development' ? 'true' : 'false';
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
    __BACKEND_BASE_URL__: JSON.stringify(backendBaseUrl),
    __PLUGIN_VERSION__: JSON.stringify(process.env.PLUGIN_VERSION ?? '2.2.0'),
    __ENABLE_PUBLIC_SHEET_TEST_MODE__: JSON.stringify(mode === 'development'),
  },
});
await copyFile(resolve(root, 'dist/ui-build/src/ui/index.html'), resolve(dist, 'ui.html'));
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.base.json'), 'utf8'));
const networkAccess =
  mode === 'development'
    ? {
        ...manifest.networkAccess,
        allowedDomains: ['none'],
        devAllowedDomains: [backendOrigin],
      }
    : {
        ...manifest.networkAccess,
        allowedDomains: [backendOrigin],
        devAllowedDomains: [],
      };
await writeFile(
  resolve(dist, 'manifest.json'),
  JSON.stringify(
    {
      ...manifest,
      main: 'code.js',
      ui: 'ui.html',
      networkAccess,
    },
    null,
    2,
  ) + '\n',
);
await validateBuiltManifest(resolve(dist, 'manifest.json'), { mode, backendOrigin });
console.log(`Plugin built in ${dist} (${mode})`);
console.log(`Public Sheet test mode: ${mode === 'development' ? 'enabled' : 'disabled'}`);
console.log(`Plugin ready. Import: ${resolve(dist, 'manifest.json')}`);
