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
  throw new Error('Production plugin manifest must target Figma API version 1.0.0.');
const devDomains = manifest.networkAccess?.devAllowedDomains ?? [];
if (devDomains.length > 0 || JSON.stringify(manifest).match(/localhost|127\.0\.0\.1/u))
  throw new Error('Production plugin manifest contains a development network flag or domain.');
const bundle = await readFile('apps/plugin/dist/code.js', 'utf8');
if (bundle.includes('http://localhost') || bundle.includes('127.0.0.1'))
  throw new Error('Production controller bundle contains a local backend URL.');

console.log('Plugin controller sandbox contract passed.');
