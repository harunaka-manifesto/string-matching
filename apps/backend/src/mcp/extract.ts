import { sha256, recordFingerprint, describeRecord, isCopyId } from '@string-binder/domain';
import type { CopyRecord } from '@string-binder/contracts';
export type ExtractionOptions = {
  frameIds: string[];
  cursor?: number;
  expectedHash?: string;
  fileLabel?: string;
  pageId?: string;
};
/** Read-only Figma API script. A bounded JSON-string chunk also handles huge individual values. */
export async function extractFrames(figma: any, options: ExtractionOptions) {
  if (!options.frameIds.length) throw new Error('At least one frame is required');
  const records = new Map<string, CopyRecord>();
  const occurrences: any[] = [];
  const unmanaged: any[] = [];
  const issues: any[] = [];
  const frames: any[] = [];
  const variableCache = new Map<string, any>();
  const collectionCache = new Map<string, any>();
  const variable = async (id: string) => {
    if (!variableCache.has(id))
      variableCache.set(id, await figma.variables.getVariableByIdAsync(id));
    return variableCache.get(id);
  };
  const collection = async (id: string) => {
    if (!collectionCache.has(id))
      collectionCache.set(id, await figma.variables.getVariableCollectionByIdAsync(id));
    return collectionCache.get(id);
  };
  async function value(v: any, locale: 'en' | 'id', seen = new Set<string>()): Promise<string> {
    if (seen.has(v.id)) throw new Error('Alias cycle');
    seen.add(v.id);
    const c = await collection(v.variableCollectionId);
    const mode = c?.modes.find((m: any) => m.name.toLowerCase() === locale);
    if (!mode) throw new Error(`Missing ${locale.toUpperCase()} mode`);
    const x = v.valuesByMode[mode.modeId];
    if (typeof x === 'string') return x;
    if (x?.type === 'VARIABLE_ALIAS') {
      const target = await variable(x.id);
      if (!target) throw new Error('Missing alias target');
      return value(target, locale, seen);
    }
    throw new Error('Missing string mode value');
  }
  const readShared = (n: any, key: string) => n.getSharedPluginData?.('copy', key) ?? '';
  const parse = (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  const sceneChecks: { frame: any; before: string }[] = [];
  const scene = (frame: any) => {
    const entries: any[] = [];
    const walk = (n: any) => {
      entries.push([
        n.id,
        n.name,
        n.visible,
        n.type,
        n.type === 'TEXT' ? n.characters : null,
        n.type === 'TEXT' ? n.boundVariables?.characters : null,
        n.type === 'TEXT' ? n.resolvedVariableModes : null,
      ]);
      if ('children' in n) for (const child of n.children) walk(child);
    };
    walk(frame);
    return sha256(JSON.stringify(entries));
  };
  const examined: { node: any; v: any; before: string }[] = [];
  let selectedPage: string | undefined;
  if (options.pageId) {
    const page = await figma.getNodeByIdAsync(options.pageId);
    if (!page || page.type !== 'PAGE') throw new Error('Requested page is unavailable');
    await figma.setCurrentPageAsync(page);
    selectedPage = page.id;
  }
  for (const frameId of options.frameIds) {
    const frame = await figma.getNodeByIdAsync(frameId);
    if (!frame || !['FRAME', 'COMPONENT', 'INSTANCE', 'COMPONENT_SET'].includes(frame.type))
      throw new Error(`Frame ${frameId} cannot be read`);
    let page = frame.parent;
    while (page && page.type !== 'PAGE') page = page.parent;
    if (page) {
      if (selectedPage && selectedPage !== page.id)
        throw new Error('Extract one page per call; combine complete bundles afterward');
      if (!selectedPage) {
        await figma.setCurrentPageAsync(page);
        selectedPage = page.id;
      }
    }
    frames.push({ id: frame.id, name: frame.name });
    sceneChecks.push({ frame, before: scene(frame) });
    const texts: any[] = [];
    const walk = (n: any, visible: boolean) => {
      visible = visible && n.visible !== false;
      if (n.type === 'TEXT' && visible) texts.push(n);
      if ('children' in n) for (const child of n.children) walk(child, visible);
    };
    walk(frame, true);
    for (const n of texts) {
      const occurrence = { frameId, nodeId: n.id, layerName: n.name, displayedText: n.characters };
      const binding = n.boundVariables?.characters;
      const id = Array.isArray(binding) ? binding[0]?.id : binding?.id;
      if (!id) {
        unmanaged.push(occurrence);
        continue;
      }
      try {
        const v = await variable(id);
        if (!v) throw new Error('Bound variable is unavailable');
        const copyId =
          readShared(v, 'id') || v.description?.match(/^cp_[0-7][0-9A-HJKMNP-TV-Z]{25}/)?.[0];
        if (!copyId || !isCopyId(copyId)) throw new Error('Unknown Copy ID');
        const metadata = parse(readShared(v, 'record'));
        const snapshot = parse(readShared(n, 'snapshot'));
        const base = metadata ?? snapshot;
        if (
          !base ||
          base.copyId !== copyId ||
          !Number.isInteger(base.revision) ||
          base.revision < 1 ||
          typeof base.platformKey !== 'string' ||
          typeof base.en !== 'string' ||
          typeof base.id !== 'string'
        )
          throw new Error('Missing committed revision metadata; sync this copy first');
        const pair = { en: await value(v, 'en'), id: await value(v, 'id') };
        const record = { ...base, ...pair } as CopyRecord;
        const descriptionMeta = parse(
          v.description
            ?.split('\n')
            .find((l: string) => l.startsWith('Copy-Meta: '))
            ?.slice(11) ?? '',
        );
        if (record.en !== base.en || record.id !== base.id)
          throw new Error('Unpushed wording or stale metadata');
        if (metadata) {
          const generated = describeRecord(record).split('\n');
          const lines = v.description?.split('\n') ?? [];
          if (
            lines[1] !== generated[1] ||
            (lines.find((l: string) => l.startsWith('Note: ')) ?? '') !==
              (generated.find((l) => l.startsWith('Note: ')) ?? '')
          )
            throw new Error('Unpushed context or stale metadata');
        }

        if (
          descriptionMeta &&
          (descriptionMeta.revision !== record.revision ||
            descriptionMeta.hash !== recordFingerprint(record))
        )
          throw new Error('Revision fingerprint mismatch');
        if (v.name.slice(v.name.lastIndexOf('/') + 1) !== record.platformKey)
          throw new Error('Frozen key differs from the variable name');
        if (
          metadata &&
          snapshot &&
          (snapshot.copyId !== copyId ||
            snapshot.revision !== base.revision ||
            recordFingerprint(snapshot) !== recordFingerprint(record))
        )
          throw new Error('Occurrence revision snapshot needs refresh');
        const c = await collection(v.variableCollectionId);
        const mode = c?.modes.find((m: any) => m.modeId === n.resolvedVariableModes?.[c.id]);
        const locale = mode?.name.toLowerCase();
        if (locale !== 'en' && locale !== 'id')
          throw new Error('Displayed language mode is unknown');
        if (n.characters !== record[locale as 'en' | 'id'])
          throw new Error('Displayed text differs from the bound language');
        const key = copyId + ':' + record.revision;
        const existing = records.get(key);
        if (existing && recordFingerprint(existing) !== recordFingerprint(record))
          throw new Error('One identity/revision has inconsistent bilingual values');
        records.set(key, record);
        occurrences.push({
          ...occurrence,
          copyId,
          platformKey: record.platformKey,
          revision: record.revision,
          locale,
          variableKey: v.key,
        });
        examined.push({
          node: n,
          v,
          before: sha256(
            JSON.stringify([
              n.characters,
              n.name,
              n.boundVariables?.characters,
              n.resolvedVariableModes,
              v.name,
              v.description,
              pair.en,
              pair.id,
              readShared(v, 'record'),
              readShared(n, 'snapshot'),
            ]),
          ),
        });
      } catch (e) {
        issues.push({
          ...occurrence,
          code: 'INCONSISTENT_COPY',
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }
  const revisionGroups = new Map<string, Set<number>>();
  for (const r of records.values()) {
    const group = revisionGroups.get(r.copyId) ?? new Set();
    group.add(r.revision);
    revisionGroups.set(r.copyId, group);
  }
  for (const [copyId, revisions] of revisionGroups)
    if (revisions.size > 1)
      issues.push({
        code: 'REVISION_CONFLICT',
        copyId,
        revisions: [...revisions],
        message: 'Frames carry different saved revisions; synchronize before handoff',
      });
  // Detect writes during a single extraction as well as between consecutive chunks.
  variableCache.clear();
  collectionCache.clear();
  for (const x of examined) {
    const v = await variable(x.v.id);
    if (!v) throw new Error('Frame changed during extraction; restart');
    const now = sha256(
      JSON.stringify([
        x.node.characters,
        x.node.name,
        x.node.boundVariables?.characters,
        x.node.resolvedVariableModes,
        v.name,
        v.description,
        await value(v, 'en'),
        await value(v, 'id'),
        readShared(v, 'record'),
        readShared(x.node, 'snapshot'),
      ]),
    );
    if (now !== x.before) throw new Error('Frame changed during extraction; restart');
  }
  for (const check of sceneChecks)
    if (scene(check.frame) !== check.before)
      throw new Error('Frame changed during extraction; restart');
  const bundle = {
    schemaVersion: 1,
    fileLabel: options.fileLabel ?? '',
    frames,
    records: [...records.values()].sort((a, b) =>
      (a.copyId + ':' + a.revision).localeCompare(b.copyId + ':' + b.revision),
    ),
    occurrences,
    unmanaged,
    issues,
    ready: issues.length === 0,
  };
  const serialized = JSON.stringify(bundle);
  const snapshotHash = sha256(serialized);
  if (options.expectedHash && options.expectedHash !== snapshotHash)
    throw new Error('Snapshot changed between chunks; discard chunks and restart');
  const cursor = options.cursor ?? 0;
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > serialized.length)
    throw new Error('Invalid extraction cursor');
  // 3,000 UTF-16 code units keeps the escaped response comfortably below 20KB.
  let end = Math.min(cursor + 3000, serialized.length);
  if (
    end < serialized.length &&
    serialized.charCodeAt(end - 1) >= 0xd800 &&
    serialized.charCodeAt(end - 1) <= 0xdbff
  )
    end--;
  return {
    schemaVersion: 1,
    snapshotHash,
    cursor,
    nextCursor: end < serialized.length ? end : null,
    totalCharacters: serialized.length,
    chunk: serialized.slice(cursor, end),
  };
}
