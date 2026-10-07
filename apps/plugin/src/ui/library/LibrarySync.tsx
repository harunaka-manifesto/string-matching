import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  Catalog,
  CopyRecord,
  DraftRow,
  LocalCopy,
  MutationResult,
  WorkflowAction,
} from '@string-binder/contracts';
import {
  bilingualErrors,
  canonical,
  canvasFingerprint,
  libraryDiff,
  localFingerprint,
  operationOf,
  proposedKey,
} from '@string-binder/domain';
import type { UiBridge } from '../bridge';
import { ClientError, request } from '../workflow-client';
import {
  Badge,
  ContextEditor,
  EMPTY_CATALOG as empty,
  identity,
  message,
  type Tone,
} from '../shared';
import { uuid } from '../uuid';

const LIBRARY_STATUS: Record<string, [string, Tone]> = {
  current: ['Up to date', 'success'],
  local: ['Local changes', 'brand'],
  new: ['Local changes · new variable', 'brand'],
  remote: ['Remote changes', 'warning'],
  missing: ['Remote changes · not in Figma', 'warning'],
  equal: ['Remote changes · same wording', 'warning'],
  conflict: ['Conflict', 'danger'],
  unbased: ['Needs initial reconciliation', 'danger'],
  invalid: ['Invalid', 'danger'],
  publish: ['Needs publish', 'warning'],
  unlinked: ['Not in library sync yet', 'warning'],
};
const ALL = 'All changes';
const PUBLISH = 'Needs publish';
const groupOf = (status: string) => LIBRARY_STATUS[status]![0].split(' · ')[0]!;
/** One sync run must stay well inside the registry's 4 MB request limit. */
const ADOPT_BATCH = 5000;
export function LibrarySync({
  bridge,
  onCatalog,
}: {
  bridge: UiBridge;
  onCatalog: (cat: Catalog) => void;
}) {
  const [config, setConfig] = useState({
    libraryId: 'gopay-strings',
    fileKey: 'azS9vExUzw1IRrrGm3NEfD',
    publisherToken: '',
  });
  const [configured, setConfigured] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [catalog, setCatalog] = useState<Catalog>(empty);
  const [locals, setLocals] = useState<LocalCopy[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, DraftRow>>({});
  const [review, setReview] = useState(false);
  // null follows the data: unpublished copy first, since that is what designers are waiting on.
  const [filter, setFilter] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pending, setPending] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  // The sync round this file started; Verify only has something to check while it is unpublished.
  const [run, setRun] = useState<any>(null);
  const openRun = run && !run.published && run.applied?.length ? run : null;
  const [pendingReview, setPendingReview] = useState<LocalCopy[] | null>(null);
  const owner = useRef(uuid());
  const rpc = <T,>(action: WorkflowAction, data: unknown = {}) => request<T>(bridge, action, data);
  useEffect(() => {
    void rpc<any>('settings:get')
      .then((s) => {
        setConfigured(!!s.hasPublisherToken);
        setHasToken(!!s.hasPublisherToken);
        setConfig((c) => ({
          ...c,
          libraryId: s.libraryId || c.libraryId,
          fileKey: s.fileKey || c.fileKey,
        }));
      })
      .catch((e) => setError(message(e)));
    void rpc('library:pending')
      .then(setPending)
      .catch(() => {});
    void rpc<any>('library:manifest')
      .then(setRun)
      .catch(() => {});
  }, []);
  const check = async () => {
    setBusy('Checking local and saved revisions…');
    setError('');
    setReview(false);
    try {
      const scan = await rpc<{ catalog: Catalog; locals: LocalCopy[] }>('library:scan');
      setCatalog(scan.catalog);
      onCatalog(scan.catalog);
      setLocals(scan.locals);
      setChoices({});
      setEdits({});
      setPage(0);
      setFilter(null);
      const saved = await rpc<any>('library:manifest');
      setRun(saved);
      if (saved) setResult(saved);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy('');
    }
  };
  const rows = useMemo(() => {
    const remoteById = new Map(catalog.records.map((r) => [r.copyId, r]));
    const localIds = new Set(locals.map((l) => l.copyId));
    // Indexed once: a find per row over every mapping froze large libraries.
    const mappingByCopy = new Map<string, Catalog['mappings'][number]>();
    for (const m of catalog.mappings)
      if (m.libraryId === config.libraryId && !mappingByCopy.has(m.copyId))
        mappingByCopy.set(m.copyId, m);
    const appliedIds = new Set<string>((openRun?.applied ?? []).map((m: any) => m.copyId));
    return [
      ...locals.map((local) => ({
        id: local.variableId,
        local,
        remote: remoteById.get(local.copyId ?? ''),
      })),
      ...catalog.records
        .filter((r) => r.status === 'active' && !localIds.has(r.copyId))
        .map((remote) => ({ id: remote.copyId, local: undefined, remote })),
    ].map((row) => {
      const kind = libraryDiff(row.local, row.remote);
      // Synchronized is not delivered: designers only receive it once Figma publishes it.
      const mapping = row.remote ? mappingByCopy.get(row.remote.copyId) : undefined;
      // Waiting for publish only once a sync round in this file wrote it; otherwise it must
      // join a round first (e.g. copy a writer saved straight into this file).
      const synced =
        !!mapping &&
        mapping.syncedRevision === row.remote?.revision &&
        appliedIds.has(row.remote!.copyId);
      const status =
        kind === 'current' && mapping?.publishedRevision !== row.remote?.revision
          ? synced
            ? 'publish'
            : 'unlinked'
          : kind;
      return { ...row, kind, status };
    });
  }, [catalog.records, catalog.mappings, locals, config.libraryId, openRun]);
  // Derived lists are memoized: typing in a row's textarea must not re-walk every row.
  const counts = useMemo(
    () =>
      rows.reduce<Record<string, number>>((all, row) => {
        const label = groupOf(row.status);
        all[label] = (all[label] ?? 0) + 1;
        if (row.status !== 'current') all[ALL] = (all[ALL] ?? 0) + 1;
        return all;
      }, {}),
    [rows],
  );
  const view = filter ?? (counts[PUBLISH] ? PUBLISH : ALL);
  const visible = useMemo(
    () => rows.filter((r) => (view === ALL ? r.status !== 'current' : groupOf(r.status) === view)),
    [rows, view],
  );
  const pick = (next: string) => {
    setFilter(next);
    setPage(0);
  };
  const selected = useMemo(
    () => rows.filter((r) => choices[r.id] && choices[r.id] !== 'defer'),
    [rows, choices],
  );
  // First reconciliation of an imported library is thousands of identical rows.
  const adoptable = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.local &&
          r.remote &&
          !r.local.error &&
          (r.kind === 'unbased' || r.kind === 'equal' || r.status === 'unlinked') &&
          r.local.en === r.remote.en &&
          r.local.id === r.remote.id &&
          !choices[r.id],
      ),
    [rows, choices],
  );
  /** Active records by exact bilingual value, for the per-row Reuse options. */
  const activeByValue = useMemo(() => {
    const groups = new Map<string, CopyRecord[]>();
    for (const c of catalog.records) {
      if (c.status !== 'active') continue;
      const key = `${c.en}\u0000${c.id}`;
      const group = groups.get(key);
      if (group) group.push(c);
      else groups.set(key, [c]);
    }
    return groups;
  }, [catalog.records]);
  /** First match wins, like the `find` calls these maps replace. */
  const reviewIndex = useMemo(() => {
    const reviewById = new Map<string | undefined, LocalCopy>();
    const reviewByCopy = new Map<string | null | undefined, LocalCopy>();
    for (const l of pendingReview ?? []) {
      if (!reviewById.has(l.variableId)) reviewById.set(l.variableId, l);
      if (!reviewByCopy.has(l.copyId)) reviewByCopy.set(l.copyId, l);
    }
    const entryByCopy = new Map<string, any>();
    for (const e of pending?.entries ?? [])
      if (!entryByCopy.has(e.copyId)) entryByCopy.set(e.copyId, e);
    return { reviewById, reviewByCopy, entryByCopy };
  }, [pendingReview, pending]);
  const editFor = (row: (typeof rows)[number]) =>
    edits[row.id] ??
    ({
      layerId: row.id,
      action: row.remote ? 'edit' : 'create',
      locale: 'id',
      copyId: row.remote?.copyId ?? identity(),
      baseline: row.remote,
      canvasFingerprint: '',
      product:
        row.remote?.product ??
        catalog.products.find((p) => row.local?.collection.startsWith(p.displayName))?.id ??
        '',
      context: row.local?.context ??
        row.remote?.context ?? { feature: '', screen: '', context: '', role: 'text', note: '' },
      en: row.local?.en ?? row.remote?.en ?? '',
      id: row.local?.id ?? row.remote?.id ?? '',
    } as DraftRow);
  const choose = (row: (typeof rows)[number], action: string) => {
    setChoices((c) => ({ ...c, [row.id]: action }));
    setEdits((e) => (e[row.id] ? e : { ...e, [row.id]: editFor(row) }));
    setReview(false);
  };
  const finish = async (state: any) => {
    let saved = state.result as MutationResult | undefined;
    if (state.batch && !saved) {
      setBusy('Recovering / saving library push…');
      try {
        saved =
          (await rpc<MutationResult | null>('request', { requestId: state.batch.requestId })) ??
          (await rpc<MutationResult>('submit', { batch: state.batch }));
      } catch (e) {
        if (
          e instanceof ClientError &&
          e.details?.error &&
          ['REVISION_CONFLICT', 'VALIDATION', 'DUPLICATE_COPY_ID', 'REQUEST_REUSED'].includes(
            e.code,
          )
        ) {
          const rejected = { ...state, definiteRejection: true };
          await rpc('library:pending', { value: rejected });
          setPending(rejected);
        }
        throw e;
      }
      state = { ...state, result: saved };
      await rpc('library:pending', { value: state });
      setPending(state);
    }
    const records: CopyRecord[] = state.deliveryRecords ?? [
      ...state.pullRecords,
      ...(saved?.records ?? []),
    ];
    const unique = [...new Map(records.map((r) => [r.copyId, r])).values()];
    setBusy('Applying fixed library manifest…');
    await rpc('library:start', {
      records: unique,
      runId: state.runId,
      owner: state.owner,
      entries: state.entries,
    });
    const applied = await rpc<any>('library:apply', { runId: state.runId });
    setResult({ ...applied, records: unique, runId: state.runId });
    setRun(await rpc<any>('library:manifest'));
    if (!applied.failures.length) {
      await rpc('library:pending', { value: null });
      setPending(null);
      setReview(false);
      setChoices({});
      setEdits({});
    } else {
      setError('Saved, with outstanding Figma work. Resume the same manifest.');
    }
  };
  const reviewRemaining = async () => {
    setBusy('Rescanning saved manifest…');
    setError('');
    try {
      if (pending?.batch && !pending.result) {
        let saved;
        try {
          saved =
            (await rpc<MutationResult | null>('request', { requestId: pending.batch.requestId })) ??
            (await rpc<MutationResult>('submit', { batch: pending.batch }));
        } catch (e) {
          if (
            e instanceof ClientError &&
            e.details?.error &&
            ['REVISION_CONFLICT', 'VALIDATION', 'DUPLICATE_COPY_ID', 'REQUEST_REUSED'].includes(
              e.code,
            )
          ) {
            const rejected = { ...pending, definiteRejection: true };
            await rpc('library:pending', { value: rejected });
            setPending(rejected);
          }
          throw e;
        }
        const recovered = { ...pending, result: saved };
        await rpc('library:pending', { value: recovered });
        setPending(recovered);
      }
      const scan = await rpc<{ catalog: Catalog; locals: LocalCopy[] }>('library:scan');
      setCatalog(scan.catalog);
      setPendingReview(scan.locals);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy('');
    }
  };
  const applyReviewedRemaining = async () => {
    if (!pendingReview || !pending) return;
    const { reviewById, reviewByCopy } = reviewIndex;
    setBusy('Applying reviewed manifest…');
    try {
      const state = {
        ...pending,
        entries: pending.entries.map((entry: any) => {
          const local = reviewById.get(entry.variableId) ?? reviewByCopy.get(entry.copyId);
          if (!local) return entry;
          return {
            ...entry,
            variableId: local.variableId,
            fingerprint: localFingerprint(local),
            overwrite: true,
          };
        }),
      };
      await rpc('library:pending', { value: state });
      setPending(state);
      setPendingReview(null);
      await finish(state);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy('');
    }
  };
  const sync = async () => {
    setBusy('Preparing sync…');
    setError('');
    try {
      const operations = [];
      const pullRecords: CopyRecord[] = [];
      const entries: any[] = [];
      for (const row of selected) {
        const action = choices[row.id];
        let edit = edits[row.id] ?? editFor(row);
        if (action === 'pull' || action === 'adopt') {
          if (!row.remote) throw new Error('Saved identity is missing');
          if (
            action === 'adopt' &&
            row.local &&
            (row.local.en !== row.remote.en || row.local.id !== row.remote.id)
          )
            throw new Error(
              'Adopt requires matching bilingual values; choose Pull to replace local edits',
            );
          pullRecords.push(row.remote);
          entries.push({
            copyId: row.remote.copyId,
            variableId: row.local?.variableId,
            fingerprint: row.local ? localFingerprint(row.local) : undefined,
            overwrite: action === 'pull',
          });
          continue;
        }
        if (row.local?.collection.startsWith('# Legacy') && !row.remote)
          throw new Error('Resolve legacy identity; do not create new entries in Legacy');
        if (action?.startsWith('reuse:')) {
          const r = catalog.records.find((r) => r.copyId === action.slice(6))!;
          operations.push({
            action: 'reuse' as const,
            copyId: r.copyId,
            expectedRevision: r.revision,
          });
          entries.push({
            copyId: r.copyId,
            variableId: row.local?.variableId,
            fingerprint: row.local ? localFingerprint(row.local) : undefined,
            reuse: true,
          });
          continue;
        }
        const errors = bilingualErrors(edit.en, edit.id);
        if (errors.length) throw new Error(errors.join('; '));
        proposedKey(edit, catalog.products);
        const op = operationOf(edit);
        if (op) operations.push(op);
        entries.push({
          copyId: edit.copyId,
          variableId: row.local?.variableId,
          fingerprint: row.local ? localFingerprint(row.local) : undefined,
          overwrite: true,
        });
      }
      const unique = new Map<string, (typeof operations)[number]>();
      for (const op of operations) {
        if (unique.has(op.copyId) && canonical(unique.get(op.copyId)) !== canonical(op))
          throw new Error('Conflicting edits to one identity');
        unique.set(op.copyId, op);
      }
      const state = {
        runId: uuid(),
        owner: owner.current,
        entries,
        pullRecords,
        batch: operations.length
          ? {
              requestId: uuid(),
              operations: [...unique.values()],
              attribution: { deviceId: owner.current },
            }
          : null,
      };
      await rpc('library:pending', { value: state });
      setPending(state);
      await finish(state);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy('');
    }
  };
  return (
    <main className="studio-body sb">
      {!configured && (
        <section className="copy-card">
          <h2>Publisher setup</h2>
          <p className="sb-muted">
            One-time setup on this device. Open the GoPay Strings library file first. The token is
            stored privately and never written into the Figma file.
          </p>
          <label>
            Library ID
            <input
              value={config.libraryId}
              onChange={(e) => setConfig((c) => ({ ...c, libraryId: e.target.value }))}
            />
          </label>
          <label>
            Figma library URL
            <input
              value={`https://www.figma.com/design/${config.fileKey}/GoPay-Strings`}
              onChange={(e) => {
                // Figma shares both /design/<key> and older /file/<key> links.
                const key = e.target.value.match(/\/(?:design|file)\/([^/?]+)/)?.[1];
                if (key) setConfig((c) => ({ ...c, fileKey: key }));
              }}
            />
          </label>
          <label>
            Publisher token
            <input
              type="password"
              placeholder={hasToken ? 'Saved on this device · leave blank to keep' : ''}
              value={config.publisherToken}
              onChange={(e) => setConfig((c) => ({ ...c, publisherToken: e.target.value }))}
            />
          </label>
          <button
            className="sb-primary"
            disabled={!config.publisherToken.trim() && !hasToken}
            onClick={() =>
              void rpc('settings:save', config)
                .then(() => {
                  setConfigured(true);
                  setHasToken(true);
                  setError('');
                  setConfig((c) => ({ ...c, publisherToken: '' }));
                })
                .catch((e) => setError(message(e)))
            }
          >
            Save on this device
          </button>
        </section>
      )}
      {error && (
        <p role="alert" className="studio-warning">
          {error}
        </p>
      )}
      {busy && <p role="status">{busy}</p>}
      {configured && (
        <div className="studio-controls">
          <button disabled={!!busy || !!pending} onClick={() => void check()}>
            Check changes
          </button>
          <button className="sb-quiet" disabled={!!busy} onClick={() => setConfigured(false)}>
            Change setup
          </button>
        </div>
      )}
      {configured && !busy && rows.length === 0 && (
        <p className="sb-muted">Check changes to compare this file's variables with Supabase.</p>
      )}
      {configured && !review && rows.length > 0 && (
        <div className="sync-filters" role="group" aria-label="Show">
          {[ALL, ...new Set(Object.keys(LIBRARY_STATUS).map(groupOf))]
            .filter((label) => counts[label])
            .map((label) => (
              <button
                key={label}
                className="sync-filter"
                aria-pressed={view === label}
                onClick={() => pick(label)}
              >
                {label} · {counts[label]}
              </button>
            ))}
        </div>
      )}
      {configured && !review && openRun && (
        <div className="studio-hint" role="status">
          <strong>
            Next: publish this file in Figma, then verify ({openRun.applied.length}{' '}
            {openRun.applied.length === 1 ? 'string' : 'strings'})
          </strong>
          <ol className="sb-muted">
            <li>Open Assets › Publish in this file and publish the library.</li>
            <li>Come back here and click Verify publication.</li>
          </ol>
          <span className="sb-muted">Designers only receive the strings after this.</span>
          <button
            disabled={!!busy}
            onClick={() => {
              setBusy('Verifying publication…');
              void rpc('library:publish')
                .then(() => {
                  setResult((r: any) => ({ ...r, published: true }));
                  setRun((r: any) => ({ ...r, published: true }));
                  setError('');
                })
                .then(() => check())
                .catch((e) => setError(message(e)))
                .finally(() => setBusy(''));
            }}
          >
            Verify publication
          </button>
        </div>
      )}
      {configured && !review && selected.length > 0 && (
        <p className="studio-hint" role="status">
          <strong>
            Next: click Review changes at the bottom to check the {selected.length} selected{' '}
            {selected.length === 1 ? 'change' : 'changes'}.
          </strong>
        </p>
      )}
      {configured && !review && !openRun && adoptable.length > 0 && (
        <div className="studio-hint" role="status">
          <strong>
            Next: link {adoptable.length} {adoptable.length === 1 ? 'variable' : 'variables'} to
            saved copy
          </strong>
          <ol className="sb-muted">
            <li>
              Click{' '}
              {adoptable.length > ADOPT_BATCH
                ? `Select Adopt for the next ${ADOPT_BATCH}`
                : 'Select Adopt for all'}{' '}
              below. Their wording already matches, so nothing on the canvas changes.
            </li>
            <li>Click Review changes at the bottom, then Confirm Push / Pull.</li>
            <li>
              Publish this file in Figma (Assets › Publish), then click Verify publication here.
            </li>
          </ol>
          {adoptable.length > ADOPT_BATCH && (
            <span className="sb-muted">
              Large libraries go {ADOPT_BATCH} at a time; repeat until this message is gone.
            </span>
          )}
          <button
            disabled={!!busy || !!pending}
            onClick={() =>
              setChoices((c) => ({
                ...c,
                ...Object.fromEntries(adoptable.slice(0, ADOPT_BATCH).map((r) => [r.id, 'adopt'])),
              }))
            }
          >
            {adoptable.length > ADOPT_BATCH
              ? `Select Adopt for the next ${ADOPT_BATCH}`
              : `Select Adopt for all ${adoptable.length}`}
          </button>
        </div>
      )}
      {pending && (
        <section className="studio-warning">
          A library operation is pending.
          <button
            disabled={!!busy}
            onClick={() => {
              setBusy('Resuming…');
              void finish(pending)
                .catch((e) => setError(message(e)))
                .finally(() => setBusy(''));
            }}
          >
            Recover / resume manifest
          </button>
          <button disabled={!!busy} onClick={() => void reviewRemaining()}>
            Review changed outstanding variables
          </button>
          <small>
            If it is a definite revision conflict, check changes again after resolving the saved
            baseline.
          </small>
          {pending.definiteRejection && (
            <button
              disabled={!!busy}
              onClick={() =>
                void rpc('library:pending', { value: null })
                  .then(() => {
                    setPending(null);
                    setReview(false);
                  })
                  .catch((e) => setError(message(e)))
              }
            >
              Resolve rejected batch and check again
            </button>
          )}
        </section>
      )}
      {pendingReview && pending && (
        <section className="copy-card">
          <h2>Review remaining saved manifest</h2>
          <p>
            Confirming applies these saved revisions to the reviewed variables. A newer applied
            revision remains protected.
          </p>
          {(
            pending.deliveryRecords ?? [...pending.pullRecords, ...(pending.result?.records ?? [])]
          ).map((r: CopyRecord) => {
            const entry = reviewIndex.entryByCopy.get(r.copyId);
            const local =
              reviewIndex.reviewById.get(entry?.variableId) ??
              reviewIndex.reviewByCopy.get(r.copyId);
            return (
              <section key={r.copyId}>
                <strong>
                  {r.platformKey} · revision {r.revision}
                </strong>
                <p>
                  Current Figma EN/ID: {local?.en ?? 'Missing'} / {local?.id ?? 'Missing'}
                </p>
                <p>
                  Saved EN/ID: {r.en} / {r.id}
                </p>
              </section>
            );
          })}
          <button disabled={!!busy} onClick={() => setPendingReview(null)}>
            Defer
          </button>
          <button
            disabled={!!busy}
            onClick={() => {
              try {
                const originals = [...pending.pullRecords, ...(pending.result?.records ?? [])];
                const byId = new Map(catalog.records.map((c) => [c.copyId, c]));
                const records = originals.map((r: CopyRecord) => {
                  const current = byId.get(r.copyId);
                  if (!current) throw new Error('Registry identity is missing');
                  return current;
                });
                setPending((p: any) => ({
                  ...p,
                  deliveryRecords: records,
                  runId: uuid(),
                }));
              } catch (e) {
                setError(message(e));
              }
            }}
          >
            Review current Supabase revisions
          </button>
          <button disabled={!!busy} onClick={() => void applyReviewedRemaining()}>
            Apply saved manifest to reviewed variables
          </button>
        </section>
      )}
      {review ? (
        <>
          <h2>Review {selected.length} changes</h2>
          {selected.length > 50 && (
            <p className="sb-muted">Showing the first 50. All {selected.length} are applied.</p>
          )}
          {selected.slice(0, 50).map((row) => {
            const r = edits[row.id] ?? editFor(row);
            return (
              <section className="copy-card" key={row.id}>
                <div className="copy-head">
                  <strong className="mono">{row.remote?.platformKey ?? row.local?.name}</strong>
                  <Badge
                    label={
                      choices[row.id]?.startsWith('reuse:')
                        ? 'Reuse'
                        : ({ pull: 'Pull', adopt: 'Adopt', push: 'Push', combine: 'Combine' }[
                            choices[row.id]!
                          ] ?? choices[row.id]!)
                    }
                    tone="brand"
                  />
                </div>
                <p>EN: {choices[row.id] === 'pull' ? row.remote?.en : r.en}</p>
                <p>ID: {choices[row.id] === 'pull' ? row.remote?.id : r.id}</p>
              </section>
            );
          })}
        </>
      ) : (
        <>
          {visible.slice(page * 50, page * 50 + 50).map((row) => {
            const r = edits[row.id] ?? editFor(row);
            const choice = choices[row.id] ?? 'defer';
            return (
              <section
                className={`copy-card ${choice === 'defer' ? '' : 'is-selected'}`}
                key={row.id}
              >
                <div className="copy-head">
                  <strong className="mono">{row.remote?.platformKey ?? row.local?.name}</strong>
                  <Badge
                    label={LIBRARY_STATUS[row.status]![0]}
                    tone={LIBRARY_STATUS[row.status]![1]}
                  />
                </div>
                <small>
                  {row.local?.collection ??
                    catalog.products.find((p) => p.id === row.remote?.product)?.displayName}
                </small>
                {row.local?.error && <p className="studio-warning">{row.local.error}</p>}
                {row.status === 'publish' && (
                  <div className="three-way">
                    <p>EN: {row.remote?.en}</p>
                    <p>ID: {row.remote?.id}</p>
                  </div>
                )}
                {['conflict', 'unbased'].includes(row.kind) && (
                  <div className="three-way">
                    <p>
                      Base EN/ID: {row.local?.baseline?.en ?? 'Unknown'} /{' '}
                      {row.local?.baseline?.id ?? 'Unknown'}
                    </p>
                    <p>
                      Figma EN/ID: {row.local?.en} / {row.local?.id}
                    </p>
                    <p>
                      Supabase EN/ID: {row.remote?.en} / {row.remote?.id}
                    </p>
                  </div>
                )}
                {row.status !== 'publish' && (
                  <select
                    value={choice}
                    disabled={!!pending || !!row.local?.error}
                    onChange={(e) => choose(row, e.target.value)}
                  >
                    <option value="defer">Defer</option>
                    {row.remote && (
                      <>
                        <option value="pull">
                          {row.kind === 'invalid'
                            ? 'Restore saved key / Pull'
                            : 'Use Supabase / Pull'}
                        </option>
                        {row.kind !== 'invalid' && (
                          <option value="adopt">Adopt matching saved revision</option>
                        )}
                      </>
                    )}
                    {row.local && row.kind !== 'invalid' && (
                      <>
                        <option value="push">Use Figma / Push</option>
                        <option value="combine">Combine and Push</option>
                      </>
                    )}
                    {!row.remote &&
                      row.local &&
                      (activeByValue.get(`${row.local.en}\u0000${row.local.id}`) ?? [])
                        .slice(0, 5)
                        .map((c) => (
                          <option key={c.copyId} value={`reuse:${c.copyId}`}>
                            Reuse {c.platformKey}
                          </option>
                        ))}
                  </select>
                )}
                {(choice === 'push' || choice === 'combine') && (
                  <>
                    <div className="bilingual">
                      <label>
                        EN
                        <textarea
                          value={r.en}
                          onChange={(e) =>
                            setEdits((v) => ({ ...v, [row.id]: { ...r, en: e.target.value } }))
                          }
                        />
                      </label>
                      <label>
                        ID
                        <textarea
                          value={r.id}
                          onChange={(e) =>
                            setEdits((v) => ({ ...v, [row.id]: { ...r, id: e.target.value } }))
                          }
                        />
                      </label>
                    </div>
                    <ContextEditor
                      row={r}
                      catalog={catalog}
                      disabled={!!pending}
                      change={(u) => setEdits((v) => ({ ...v, [row.id]: { ...r, ...u } }))}
                    />
                  </>
                )}
              </section>
            );
          })}
          {visible.length > 50 && (
            <div>
              <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <span>
                {' '}
                {page + 1} / {Math.ceil(visible.length / 50)}{' '}
              </span>
              <button
                disabled={(page + 1) * 50 >= visible.length}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
      {result && (
        <section className="copy-card">
          <h2>
            {result.published ? 'Publication verified' : 'Library draft updated · needs publish'}
          </h2>
          {result.failures?.map((f: any) => (
            <p className="studio-warning" key={f.copyId}>
              {f.copyId}: {f.reason}
            </p>
          ))}
          <p>{result.records?.length ?? 0} records in the saved manifest.</p>
        </section>
      )}
      {(review || selected.length > 0) && (
        <footer className="studio-footer">
          <span>{selected.length} selected</span>
          {review ? (
            <>
              <button disabled={!!busy || !!pending} onClick={() => setReview(false)}>
                Back
              </button>
              <button
                className="sb-primary"
                disabled={!!busy || !!pending}
                onClick={() => void sync()}
              >
                Confirm Push / Pull
              </button>
            </>
          ) : (
            <button
              className="sb-primary"
              disabled={!!busy || !!pending || !selected.length}
              onClick={() => setReview(true)}
            >
              Review changes
            </button>
          )}
        </footer>
      )}
    </main>
  );
}
