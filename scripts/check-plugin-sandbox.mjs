import { readFile, readdir } from 'node:fs/promises';

const forbidden = [
  /\bRequestInit\b/u,
  /\bHeaders\b/u,
  /\bAbortController\b/u,
  /\bDOMException\b/u,
  /\bURLSearchParams\b/u,
  /\b(?:setTimeout|setInterval)\s*\(/u,
  /\b(?:window|document)\s*\./u,
  /\bnew\s+(?:Request|Response)\s*\(/u,
];

async function filesUnder(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await filesUnder(child)));
    else if (entry.isFile() && child.endsWith('.ts')) files.push(child);
  }
  return files;
}

const paths = [
  ...(await filesUnder('apps/plugin/src/main')),
  ...(await filesUnder('packages/contracts/src')),
  ...(await filesUnder('packages/domain/src')),
  'apps/plugin/dist/code.js',
];
for (const path of paths) {
  let text = '';
  try {
    text = await readFile(path, 'utf8');
  } catch {
    continue;
  }
  const match = forbidden.map((pattern) => text.match(pattern)).find(Boolean);
  if (match) throw new Error(`${path} contains forbidden browser helper ${match[0]}.`);
  if (path.startsWith('packages/contracts/src/') && /\.url\(\)/u.test(text))
    throw new Error(`${path} contains browser-dependent URL validation used by Figma main.`);
}

const manifest = JSON.parse(await readFile('apps/plugin/dist/manifest.json', 'utf8'));
if (manifest.api !== '1.0.0')
  throw new Error('Plugin manifest must target Figma API version 1.0.0.');
if (!manifest.permissions?.includes('teamlibrary'))
  throw new Error('Plugin manifest must request the teamlibrary permission.');
if (JSON.stringify(manifest.networkAccess?.allowedDomains) !== '["none"]')
  throw new Error('Plugin must not request network access.');

console.log('Plugin controller sandbox contract passed.');
