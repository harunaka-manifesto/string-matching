import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { adminRpc } from './registry-admin.mjs';
const args = process.argv.slice(2),
  restore = args.includes('--restore'),
  apply = args.includes('--apply');
const key = Buffer.from(process.env.COPY_BACKUP_KEY ?? '', 'base64');
if (key.length !== 32)
  throw new Error('Set a private base64 COPY_BACKUP_KEY containing exactly 32 random bytes');
const file =
  args.find((a) => !a.startsWith('--')) ??
  `registry-${new Date().toISOString().replace(/[:.]/g, '-')}.backup.enc`;
if (restore) {
  const data = JSON.parse(await readFile(file, 'utf8'));
  if (data.version !== 1) throw new Error('Unsupported encrypted backup');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(data.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(data.tag, 'base64'));
  const raw = gunzipSync(
    Buffer.concat([decipher.update(Buffer.from(data.payload, 'base64')), decipher.final()]),
  );
  if (createHash('sha256').update(raw).digest('hex') !== data.hash)
    throw new Error('Backup checksum failed');
  const snapshot = JSON.parse(raw);
  console.log(
    JSON.stringify({
      mode: apply ? 'restore' : 'verified-dry-run',
      records: snapshot.tables.copies.length,
      revisions: snapshot.tables.copy_revisions.length,
    }),
  );
  if (apply) console.log(await adminRpc('copy_registry_restore', { snapshot }));
} else {
  const raw = Buffer.from(JSON.stringify(await adminRpc('copy_registry_backup')));
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  const payload = Buffer.concat([cipher.update(gzipSync(raw)), cipher.final()]);
  await writeFile(
    file,
    JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      hash: createHash('sha256').update(raw).digest('hex'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      payload: payload.toString('base64'),
    }),
    { mode: 0o600, flag: 'wx' },
  );
  console.log(`Encrypted backup written: ${file}`);
}
