/**
 * Prefills variables for text layers from the order strings had in the legacy
 * sheets (one screen per block, rows top-down). Writers pick one layer's string
 * (an anchor); following layers get the next strings in that sequence.
 */

export type SequenceSource = {
  /** Sequence id → variable keys in order. */
  sequences: ReadonlyMap<string, readonly string[]>;
  /** Variable key → every position it occupies. */
  positions: ReadonlyMap<string, readonly SequencePosition[]>;
};

export type SequencePosition = { sequence: string; index: number };

export type PrefillRow = {
  id: string;
  /** Skipped or flagged rows take no slot in the sequence. */
  excluded: boolean;
  /** Existing binding or a writer's pick. Anchors reset the cursor. */
  anchorKey: string | null;
  /** Writer nudge: skip ahead (positive) or back (negative) from this row down. */
  shift: number;
};

export type PrefillResult = {
  key: string;
  source: 'anchor' | 'sequence';
};

export function buildSequenceSource(input: {
  /** Legacy sheet tabs → variable names in row order (may repeat across tabs). */
  orderedNames: Readonly<Record<string, readonly string[]>>;
  /** Library variables with their collection and listing order. */
  variables: readonly {
    key: string;
    name: string;
    collection: string;
    order: number;
    aliases?: readonly string[];
  }[];
}): SequenceSource {
  const keyByName = new Map(input.variables.map((variable) => [variable.name, variable.key]));
  for (const variable of input.variables)
    for (const alias of variable.aliases ?? [])
      if (!keyByName.has(alias)) keyByName.set(alias, variable.key);
  const sequences = new Map<string, string[]>();
  const positions = new Map<string, SequencePosition[]>();
  const add = (sequence: string, keys: string[]) => {
    if (!keys.length) return;
    sequences.set(sequence, keys);
    keys.forEach((key, index) => {
      const list = positions.get(key) ?? [];
      list.push({ sequence, index });
      positions.set(key, list);
    });
  };
  for (const [tab, names] of Object.entries(input.orderedNames)) {
    const keys: string[] = [];
    for (const name of names) {
      const key = keyByName.get(name);
      if (key) keys.push(key);
    }
    add(`sheet:${tab}`, keys);
  }
  // Variables the legacy sheets never had (new product collections) follow library order.
  const byCollection = new Map<string, { key: string; order: number }[]>();
  for (const variable of input.variables) {
    if (positions.has(variable.key)) continue;
    const list = byCollection.get(variable.collection) ?? [];
    list.push(variable);
    byCollection.set(variable.collection, list);
  }
  for (const [collection, list] of byCollection)
    add(
      `library:${collection}`,
      [...list].sort((a, b) => a.order - b.order).map((item) => item.key),
    );
  return { sequences, positions };
}

function anchorPosition(
  source: SequenceSource,
  key: string,
  cursor: SequencePosition | null,
): SequencePosition | null {
  const list = source.positions.get(key);
  if (!list?.length) return null;
  if (cursor) {
    // Shared strings appear in many screens: prefer the occurrence right after the current cursor.
    const next = list
      .filter((item) => item.sequence === cursor.sequence && item.index > cursor.index)
      .sort((a, b) => a.index - b.index)[0];
    if (next) return next;
  }
  return list[0]!;
}

export function prefillSequence(
  rows: readonly PrefillRow[],
  source: SequenceSource,
): Map<string, PrefillResult | null> {
  const result = new Map<string, PrefillResult | null>();
  let cursor: SequencePosition | null = null;
  for (const row of rows) {
    if (row.excluded) {
      result.set(row.id, null);
      continue;
    }
    if (row.anchorKey) {
      result.set(row.id, { key: row.anchorKey, source: 'anchor' });
      const position = anchorPosition(source, row.anchorKey, cursor);
      cursor = position ? { ...position, index: position.index + row.shift } : null;
      continue;
    }
    if (!cursor) {
      result.set(row.id, null);
      continue;
    }
    const index: number = cursor.index + 1 + row.shift;
    const key = source.sequences.get(cursor.sequence)?.[index];
    cursor = { sequence: cursor.sequence, index };
    result.set(row.id, key ? { key, source: 'sequence' } : null);
  }
  return result;
}

/** Keeps only keys `keep` accepts, so prefill never walks into another product's strings. */
export function filterSequenceSource(
  source: SequenceSource,
  keep: (key: string) => boolean,
): SequenceSource {
  const sequences = new Map<string, readonly string[]>();
  const positions = new Map<string, SequencePosition[]>();
  for (const [sequence, keys] of source.sequences) {
    const kept = keys.filter(keep);
    if (!kept.length) continue;
    sequences.set(sequence, kept);
    kept.forEach((key, index) => {
      const list = positions.get(key) ?? [];
      list.push({ sequence, index });
      positions.set(key, list);
    });
  }
  return { sequences, positions };
}
