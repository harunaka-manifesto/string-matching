import { build } from 'esbuild';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build as viteBuild } from 'vite';

const root = resolve(new URL('.', import.meta.url).pathname);
// A registry URL without the team token builds a plugin that fails every request at runtime.
if (process.env.COPY_REGISTRY_URL && !process.env.COPY_TEAM_TOKEN)
  throw new Error(
    'COPY_REGISTRY_URL is set but COPY_TEAM_TOKEN is missing; load .env.plugin.local',
  );
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
    REGISTRY_URL: JSON.stringify(process.env.COPY_REGISTRY_URL ?? ''),
    REGISTRY_TOKEN: JSON.stringify(process.env.COPY_TEAM_TOKEN ?? ''),
  },
});
await copyFile(resolve(root, 'dist/ui-build/src/ui/index.html'), resolve(dist, 'ui.html'));
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.base.json'), 'utf8'));
if (process.env.COPY_REGISTRY_URL) {
  const url = new URL(process.env.COPY_REGISTRY_URL);
  const plain = !url.search && !url.hash && !url.username && !url.password;
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (local && plain && process.env.COPY_ALLOW_LOCAL_REGISTRY === '1') {
    // Figma honours devAllowedDomains only for development plugins, never a published one.
    manifest.networkAccess.devAllowedDomains = [url.origin];
  } else if (
    url.protocol !== 'https:' ||
    !/^[a-z0-9-]+\.supabase\.co$/u.test(url.hostname) ||
    url.pathname !== '/functions/v1/copy-registry' ||
    !plain
  )
    throw new Error(
      'COPY_REGISTRY_URL must be your HTTPS Supabase function URL (or a localhost URL with COPY_ALLOW_LOCAL_REGISTRY=1 for development)',
    );
  else manifest.networkAccess.allowedDomains = [url.origin];
}
await writeFile(resolve(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Plugin ready. Import: ${resolve(dist, 'manifest.json')}`);
