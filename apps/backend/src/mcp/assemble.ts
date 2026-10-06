import { FrameBundleSchema, type FrameBundle } from '@string-binder/contracts';
import { recordFingerprint, sha256 } from '@string-binder/domain';
export type ExtractionChunk = {
  schemaVersion: number;
  snapshotHash: string;
  cursor: number;
  nextCursor: number | null;
  totalCharacters: number;
  chunk: string;
};
/** Reject incomplete, reordered, mixed-snapshot or corrupted extraction output. */
export function assembleChunks(chunks: ExtractionChunk[]): FrameBundle {
  if (!chunks.length) throw new Error('No extraction chunks');
  const first = chunks[0]!;
  let cursor = 0,
    text = '';
  for (const [index, part] of chunks.entries()) {
    if (
      part.schemaVersion !== 1 ||
      part.snapshotHash !== first.snapshotHash ||
      part.totalCharacters !== first.totalCharacters ||
      part.cursor !== cursor
    )
      throw new Error('Chunks are out of order or carry different snapshots');
    text += part.chunk;
    cursor += part.chunk.length;
    if (part.nextCursor !== (index === chunks.length - 1 ? null : cursor))
      throw new Error('Extraction is incomplete or cursor is invalid');
  }
  if (cursor !== first.totalCharacters || sha256(text) !== first.snapshotHash)
    throw new Error('Extraction length or SHA-256 does not match');
  return FrameBundleSchema.parse(JSON.parse(text));
}
export function combineBundles(bundles: FrameBundle[]) {
  if (!bundles.length) throw new Error('No frame bundles');
  const copies = new Map<string, FrameBundle['records'][number]>(),
    keys = new Map<string, string>();
  const issues: Record<string, unknown>[] = [];
  const records: FrameBundle['records'] = [];
  const seen = new Set<string>();
  for (const bundle of bundles) {
    FrameBundleSchema.parse(bundle);
    issues.push(...bundle.issues.map((issue) => ({ ...issue, fileLabel: bundle.fileLabel })));
    for (const record of bundle.records) {
      const prior = copies.get(record.copyId);
      if (
        prior &&
        (prior.revision !== record.revision ||
          recordFingerprint(prior) !== recordFingerprint(record))
      )
        issues.push({
          code: 'REVISION_CONFLICT',
          copyId: record.copyId,
          fileLabel: bundle.fileLabel,
          message:
            'Files or pages carry different revisions or bilingual values; synchronize before handoff',
        });
      const owner = keys.get(record.platformKey);
      if (owner && owner !== record.copyId)
        issues.push({
          code: 'KEY_CONFLICT',
          platformKey: record.platformKey,
          message: 'Different identities claim one developer key',
        });
      keys.set(record.platformKey, record.copyId);
      const signature = record.copyId + ':' + record.revision + ':' + recordFingerprint(record);
      if (!seen.has(signature)) {
        records.push(record);
        seen.add(signature);
      }
      if (!prior) copies.set(record.copyId, record);
    }
  }
  return {
    schemaVersion: 1,
    files: bundles.map((b) => ({ fileLabel: b.fileLabel, frames: b.frames })),
    records,
    occurrences: bundles.flatMap((b) =>
      b.occurrences.map((o) => ({ ...o, fileLabel: b.fileLabel })),
    ),
    unmanaged: bundles.flatMap((b) => b.unmanaged.map((o) => ({ ...o, fileLabel: b.fileLabel }))),
    issues,
    ready: bundles.every((b) => b.ready) && issues.length === 0,
  };
}
