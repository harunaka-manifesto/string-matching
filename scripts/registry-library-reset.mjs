// Points a registered library at a corrected Figma file. Use after Library sync was first run
// against the wrong file URL. Requires the administrator key; never the team or publisher token.
//   node scripts/registry-library-reset.mjs <library-id> <figma-file-url-or-key>
import { adminRpc } from './registry-admin.mjs';

const [libraryId, target] = process.argv.slice(2);
if (!libraryId || !target) {
  console.error('Usage: pnpm registry:library-reset <library-id> <figma-file-url-or-key>');
  process.exit(1);
}
const fileKey = target.match(/figma\.com\/(?:design|file)\/([A-Za-z0-9]+)/u)?.[1] ?? target;
if (!/^[A-Za-z0-9]{10,64}$/u.test(fileKey)) {
  console.error(`Not a Figma file key or URL: ${target}`);
  process.exit(1);
}
const result = await adminRpc('copy_registry_library_reset', {
  library_id: libraryId,
  file_key: fileKey,
});
if (result?.error) {
  console.error(result.message);
  process.exit(1);
}
console.log(
  `Library ${result.libraryId} now points at ${result.fileKey} (was ${result.previousFileKey}). ` +
    'In that file, open Library sync, choose Change setup with the same URL, then Check changes.',
);
