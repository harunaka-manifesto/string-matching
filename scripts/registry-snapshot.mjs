/** Table order for restore: referenced tables before the tables pointing at them. */
export const TABLES = [
  'migration_history',
  'products',
  'copies',
  'key_reservations',
  'copy_revisions',
  'requests',
  'changes',
  'registry_head',
  'libraries',
  'library_mappings',
  'sync_runs',
];
const PAGE = 1000;

/**
 * Reads every table page by page. If the registry moved while reading (its head sequence
 * changed), the pages could mix two states, so the read starts over.
 */
export async function pagedBackup(rpc, { attempts = 5, pageSize = PAGE } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const tables = {};
    let head = null;
    let moved = false;
    for (const table of TABLES) {
      tables[table] = [];
      for (let offset = 0; ; offset += pageSize) {
        const page = await rpc('copy_registry_backup_page', {
          table_name: table,
          page_offset: offset,
          page_size: pageSize,
        });
        head ??= page.head;
        if (page.head !== head) moved = true;
        tables[table].push(...page.rows);
        if (page.rows.length < pageSize) break;
      }
    }
    const end = await rpc('copy_registry_backup_page', {
      table_name: 'registry_head',
      page_offset: 0,
      page_size: 1,
    });
    if (!moved && end.head === head) return { schemaVersion: 1, tables };
  }
  throw new Error('The registry kept changing during the backup; try again in a quieter moment');
}

/** Restores a snapshot into a fresh registry, in pages small enough for one request each. */
export async function pagedRestore(rpc, snapshot, { maxBytes = 2_000_000 } = {}) {
  if (snapshot.schemaVersion !== 1) throw new Error('Unsupported backup schema');
  await rpc('copy_registry_restore_begin');
  for (const table of TABLES) {
    let batch = [];
    let bytes = 0;
    const flush = async () => {
      if (batch.length) await rpc('copy_registry_restore_page', { table_name: table, rows: batch });
      batch = [];
      bytes = 0;
    };
    for (const row of snapshot.tables[table] ?? []) {
      const size = Buffer.byteLength(JSON.stringify(row));
      if (batch.length && bytes + size > maxBytes) await flush();
      batch.push(row);
      bytes += size;
    }
    await flush();
  }
  return rpc('copy_registry_restore_finish');
}
