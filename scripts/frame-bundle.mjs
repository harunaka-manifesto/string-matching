import { readFile, writeFile } from 'node:fs/promises';
import { assembleChunks, combineBundles } from '../apps/backend/dist/assemble.mjs';
const paths = process.argv.slice(2);
const outIndex = paths.indexOf('--out');
const output = outIndex < 0 ? null : paths.splice(outIndex, 2)[1];
if (!paths.length)
  throw new Error(
    'Supply files containing chunk arrays or complete version-1 bundles; build:backend first',
  );
const bundles = await Promise.all(
  paths.map(async (path) => {
    const value = JSON.parse(await readFile(path, 'utf8'));
    return Array.isArray(value) ? assembleChunks(value) : value;
  }),
);
const result = combineBundles(bundles);
const json = JSON.stringify(result, null, 2) + '\n';
if (output) await writeFile(output, json);
else process.stdout.write(json);
if (!result.ready) process.exitCode = 1;
