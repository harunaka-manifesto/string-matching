import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type Catalog,
  type AuthoringDraft,
  type CopyRecord,
  type DraftRow,
  type LocalCopy,
  type BindingTarget,
  type BindingResult,
  type MutationBatch,
  type MutationResult,
  type SelectionInfo,
  type WorkflowAction,
} from '@string-binder/contracts';
import {
  bilingualErrors,
  canvasFingerprint,
  initialRow,
  libraryDiff,
  operationOf,
  proposedKey,
  newIdentity,
  canonical,
  localFingerprint,
  canvasLocale,
} from '@string-binder/domain';
import type { UiBridge } from './bridge';
import { App } from './App';
import { ClientError, request } from './workflow-client';

const identity = () => newIdentity(Date.now(), crypto.getRandomValues(new Uint8Array(10)));
const roles = [
  'title',
  'subtitle',
  'description',
  'cta',
  'link',
  'label',
  'value',
  'placeholder',
  'helper',
  'error',
  'toast',
  'tooltip',
  'banner',
  'badge',
  'tab',
  'option',
  'disclaimer',
  'caption',
  'pushtitle',
  'pushbody',
  'sms',
  'emailsubject',
  'emailbody',
  'a11y',
  'text',
];
const empty: Catalog = { seq: 0, records: [], products: [], mappings: [] };
type Bound = { copyId: string; remote: boolean; manual: boolean; revision?: number };
type Scan = {
  selection: SelectionInfo;
  bindings: Record<string, string>;
  variables?: Record<
    string,
    { en: string; id: string; baseline?: CopyRecord; manual?: boolean; remote?: boolean }
  >;
};
type Preview = {
  targets: BindingTarget[];
  conflicts: { nodeId: string; frameName: string }[];
  usages?: Record<string, number>;
};
type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
const boundOf = (scan: Scan): Record<string, Bound> =>
  Object.fromEntries(
    Object.entries(scan.bindings).map(([layerId, copyId]) => [
      layerId,
      {
        copyId,
        remote: !!scan.variables?.[layerId]?.remote,
        manual: !!scan.variables?.[layerId]?.manual,
        revision: scan.variables?.[layerId]?.baseline?.revision,
      },
    ]),
  );
/** Working-file status of one row; deliberately never a single ambiguous "Synced". */
function rowStatus(
  row: DraftRow,
  draft: AuthoringDraft,
  bound: Bound | undefined,
  catalog: Catalog,
): [string, Tone] | null {
  const saved = draft.pending?.result?.records.some((r) => r.copyId === row.copyId);
  if (saved && row.action !== 'keep') return ['Saved, not applied', 'warning'];
  if (row.action !== 'keep') return ['Draft', 'brand'];
  if (!bound) return null;
  if (bound.manual) return ['Conflict', 'danger'];
  const latest = catalog.records.find((r) => r.copyId === bound.copyId);
  if (latest && bound.revision && latest.revision > bound.revision)
    return ['Update pending', 'warning'];
  return bound.remote ? ['Using published library', 'success'] : ['Bound locally', 'neutral'];
}
const ACTION_LABELS: Record<DraftRow['action'], string> = {
  keep: 'Keep',
  create: 'Create new',
  reuse: 'Reuse existing',
  edit: 'Edit existing',
  variant: 'Create variant',
};
function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  return <span className={`badge badge--${tone}`}>{label}</span>;
}
function Stepper({ current }: { current: number }) {
  return (
    <ol className="stepper" aria-label="Progress">
      {['Select', 'Edit', 'Review', 'Results'].map((label, i) => (
        <li
          key={label}
          className={i < current ? 'is-done' : ''}
          aria-current={i === current ? 'step' : undefined}
        >
          {label}
        </li>
      ))}
    </ol>
  );
}
function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
export function Studio({ bridge }: { bridge: UiBridge }) {
  const [mode, setMode] = useState<'home' | 'apply' | 'create' | 'library'>('home');
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [catalog, setCatalog] = useState<Catalog>(empty);
  const [status, setStatus] = useState('Connecting…');
  const [issue, setIssue] = useState('');
  const [connected, setConnected] = useState(false);
  const checking = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const failures = useRef(0);
  const refresh = async (force = false) => {
    if (checking.current) return;
    checking.current = true;
    setRefreshing(true);
    try {
      const result = await request<{ catalog: Catalog; result: BindingResult }>(bridge, 'refresh', {
        force,
      });
      setCatalog(result.catalog);
      failures.current = 0;
      setConnected(true);
      setStatus(`Updated ${new Date().toLocaleTimeString()}`);
      setIssue(
        result.result.conflicts.length
          ? 'Manual variable changes need review in Create new copies.'
          : result.result.failures.map((f) => f.reason).join('; '),
      );
    } catch (e) {
      failures.current++;
      setConnected(false);
      setStatus(message(e));
      try {
        setCatalog(await request<Catalog>(bridge, 'catalog', { cached: true }));
      } catch {
        /* Figma-only apply remains available. */
      }
    } finally {
      checking.current = false;
      setRefreshing(false);
    }
  };
  useEffect(
    () =>
      bridge.subscribe((e) => {
        if (e.type === 'selection') setSelection(e.selection);
        if (e.type === 'registry:catalog') setCatalog(e.catalog);
      }),
    [bridge],
  );
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await refresh();
      if (!cancelled)
        timer = setTimeout(
          () => void tick(),
          Math.min(30000 * 2 ** Math.min(failures.current, 4), 300000) +
            Math.floor(Math.random() * 4000),
        );
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bridge]);
  useEffect(() => {
    void request(bridge, 'window', { wide: mode === 'create' || mode === 'library' }).catch(
      () => {},
    );
  }, [bridge, mode]);
  return (
    <div className="studio">
      <nav className="studio-nav sb">
        <button className="studio-brand" onClick={() => setMode('home')}>
          String Binder
        </button>
        <div className="studio-tabs">
          <button aria-pressed={mode === 'apply'} onClick={() => setMode('apply')}>
            Apply existing
          </button>
          <button aria-pressed={mode === 'create'} onClick={() => setMode('create')}>
            Create new
          </button>
        </div>
        <button
          className="sb-quiet"
          aria-pressed={mode === 'library'}
          title="For library maintainers"
          onClick={() => setMode('library')}
        >
          Library sync
        </button>
      </nav>
      <div className={`studio-status sb ${connected ? '' : 'is-offline'}`} role="status">
        <i className="studio-dot" />
        <span>{connected ? status : `Offline · ${status}`}</span>
        <button className="sb-quiet" onClick={() => void refresh(true)} disabled={refreshing}>
          {connected ? 'Refresh' : 'Retry'}
        </button>
      </div>
      {issue && <p className="studio-warning sb">{issue}</p>}
      {mode === 'home' && (
        <main className="studio-home sb">
          <div>
            <h1>Work with copy</h1>
            <p className="sb-muted">Choose a journey, then select a frame in Figma.</p>
          </div>
          <button className="journey" onClick={() => setMode('apply')}>
            <strong>Apply existing copies</strong>
            <span>Find saved copy and bind it to your frame.</span>
          </button>
          <button className="journey" onClick={() => setMode('create')}>
            <strong>Create new copies</strong>
            <span>Review canvas text, add EN/ID, and save new keys.</span>
          </button>
        </main>
      )}
      <div style={{ display: mode === 'apply' ? 'contents' : 'none' }}>
        <App bridge={bridge} active={mode === 'apply'} />
      </div>
      {mode === 'create' && (
        <Authoring
          bridge={bridge}
          selection={selection}
          catalog={catalog}
          connected={connected}
          refresh={() => refresh()}
        />
      )}
      {mode === 'library' && <Library bridge={bridge} onCatalog={setCatalog} />}
    </div>
  );
}
function Authoring({
  bridge,
  selection,
  catalog,
  connected,
  refresh,
}: {
  bridge: UiBridge;
  selection: SelectionInfo | null;
  catalog: Catalog;
  connected: boolean;
  refresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<AuthoringDraft | null>(null);
  const [step, setStep] = useState<'edit' | 'review' | 'results'>('edit');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [bound, setBound] = useState<Record<string, Bound>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<BindingResult | null>(null);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [reuseQueries, setReuseQueries] = useState<Record<string, string>>({});
  const device = useRef<string>(crypto.randomUUID());
  useEffect(() => {
    void request<string>(bridge, 'device', { proposed: device.current })
      .then((id) => (device.current = id))
      .catch(() => {});
  }, [bridge]);
  const currentFrame = useRef(selection?.frameId);
  currentFrame.current = selection?.frameId;
  const latest = useRef(draft);
  latest.current = draft;
  const catRef = useRef(catalog);
  catRef.current = catalog;
  const persist = async (d: AuthoringDraft) => {
    await request(bridge, 'draft:save', { draft: d });
  };
  useEffect(() => {
    let cancelled = false;
    setDraft(null);
    setStep('edit');
    setPreview(null);
    setError('');
    setConflicts([]);
    setResult(null);
    setBound({});
    if (!selection) return;
    void (async () => {
      const restored = await request<AuthoringDraft | null>(bridge, 'draft:get', {
        frameId: selection.frameId,
      });
      const scan = await request<Scan>(bridge, 'scan', { frameId: selection.frameId });
      if (cancelled) return;
      setBound(boundOf(scan));
      const cat = catRef.current;
      const guess =
        cat.products.find((p) =>
          scan.selection.contextNames.join(' ').toLowerCase().includes(p.displayName.toLowerCase()),
        )?.id ?? '';
      const rows = scan.selection.layers.map((layer) => {
        const saved = restored?.rows.find((r) => r.layerId === layer.id);
        if (saved) return saved;
        const baseline =
          scan.variables?.[layer.id]?.baseline ??
          cat.records.find((r) => r.copyId === scan.bindings[layer.id]);
        const row = initialRow(layer, 'id', guess, selection.frameName, identity(), baseline);
        const actual = scan.variables?.[layer.id];
        if (actual) {
          row.en = actual.en;
          row.id = actual.id;
          if (actual.en !== actual.id && layer.characters === actual.en) row.locale = 'en';
        }
        return row;
      });
      const next = {
        frameId: selection.frameId,
        frameName: selection.frameName,
        locale: restored?.locale ?? 'id',
        rows,
        pending: restored?.pending,
      } satisfies AuthoringDraft;
      setDraft(next);
      if (next.pending?.result) setStep('results');
    })().catch((e) => !cancelled && setError(message(e)));
    return () => {
      cancelled = true;
      const current = latest.current;
      if (current && current.frameId === selection?.frameId) void persist(current).catch(() => {});
    };
  }, [bridge, selection?.frameId]);
  useEffect(() => {
    if (!draft) return;
    const timer = setTimeout(() => void persist(draft).catch((e) => setError(message(e))), 180);
    return () => {
      clearTimeout(timer);
    };
  }, [draft]);
  useEffect(
    () => () => {
      if (latest.current) void persist(latest.current).catch(() => {});
    },
    [bridge],
  );
  const change = (id: string, update: Partial<DraftRow>) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((r) => (r.layerId === id ? { ...r, ...update } : r)),
          }
        : current,
    );
    setPreview(null);
    setStep('edit');
  };
  const prepare = async () => {
    if (!draft) return;
    setBusy('Checking the frame…');
    setError('');
    try {
      await refresh();
      const selected = draft.rows.filter((r) => r.action !== 'keep');
      if (!selected.length) throw new Error('Select at least one row');
      for (const r of selected) {
        if ((r.action === 'edit' || r.action === 'variant' || r.action === 'reuse') && !r.baseline)
          throw new Error('Choose an existing identity first');
        if (r.action !== 'reuse') {
          const errors = bilingualErrors(r.en, r.id);
          if (errors.length) throw new Error(errors.join('; '));
          proposedKey(r, catRef.current.products);
        }
      }
      const byCopy = new Map<string, string>();
      for (const r of selected) {
        const op = operationOf(r)!;
        if (byCopy.has(op.copyId) && byCopy.get(op.copyId) !== canonical(op))
          throw new Error('Rows editing one identity must agree');
        byCopy.set(op.copyId, canonical(op));
      }
      const next = await request<Preview>(bridge, 'preflight', {
        frameId: draft.frameId,
        rows: selected,
      });
      if (currentFrame.current !== draft.frameId) return;
      if (canonical(latest.current?.rows) !== canonical(draft.rows))
        throw new Error('Draft changed during preflight; review again');
      setPreview(next);
      setStep('review');
      await persist(draft);
    } catch (e) {
      if (currentFrame.current === draft.frameId) setError(message(e));
    } finally {
      setBusy('');
    }
  };
  const applySaved = async (d: AuthoringDraft, committed: MutationResult) => {
    setBusy('Applying saved copy…');
    const outcome = await request<BindingResult>(bridge, 'deliver', {
      records: d.pending!.deliveryRecords ?? committed.records,
      targets: d.pending!.targets,
      globalIds: d.rows.filter((r) => r.action === 'edit' || r.restoreLocal).map((r) => r.copyId),
      restoreIds: d.rows.filter((r) => r.restoreLocal).map((r) => r.copyId),
    });
    const active = currentFrame.current === d.frameId;
    if (active) {
      setResult(outcome);
      setStep('results');
    }
    if (!outcome.failures.length && !outcome.conflicts.length) {
      const scan = await request<Scan>(bridge, 'scan', { frameId: d.frameId });
      if (active) setBound(boundOf(scan));
      const done = {
        ...d,
        pending: undefined,
        rows: d.rows.map((r) => {
          const saved = (d.pending?.deliveryRecords ?? committed.records).find(
            (c) => c.copyId === r.copyId,
          );
          const layer = scan.selection.layers.find((l) => l.id === r.layerId);
          return saved && outcome.applied.includes(r.layerId)
            ? {
                ...r,
                action: 'keep' as const,
                baseline: saved,
                en: saved.en,
                id: saved.id,
                canvasFingerprint: layer ? canvasFingerprint(layer) : r.canvasFingerprint,
              }
            : saved
              ? {
                  ...r,
                  action: 'keep' as const,
                  copyId: scan.bindings?.[r.layerId] ?? identity(),
                  baseline:
                    scan.variables?.[r.layerId]?.baseline ??
                    catRef.current.records.find((c) => c.copyId === scan.bindings?.[r.layerId]),
                  en: scan.variables?.[r.layerId]?.en ?? r.en,
                  id: scan.variables?.[r.layerId]?.id ?? r.id,
                  canvasFingerprint: layer ? canvasFingerprint(layer) : r.canvasFingerprint,
                }
              : r;
        }),
      };
      if (active) setDraft(done);
      await persist(done);
    } else {
      if (active) setDraft(d);
      await persist(d);
    }
    await refresh();
  };
  const submit = async () => {
    const original = latest.current;
    if (!original || !preview) return;
    setBusy('Saving copy…');
    setError('');
    setConflicts([]);
    try {
      const operations = [
        ...new Map(
          original.rows
            .map(operationOf)
            .filter((op): op is NonNullable<typeof op> => !!op)
            .map((op) => [op.copyId, op]),
        ).values(),
      ];
      const batch: MutationBatch = {
        requestId: crypto.randomUUID(),
        operations,
        attribution: { deviceId: device.current },
      };
      let d: AuthoringDraft = { ...original, pending: { batch, targets: preview.targets } };
      setDraft(d);
      await persist(d);
      const committed = await request<MutationResult>(bridge, 'submit', { batch });
      d = { ...d, pending: { ...d.pending!, result: committed } };
      if (currentFrame.current === d.frameId) setDraft(d);
      await persist(d);
      await applySaved(d, committed);
    } catch (e) {
      if (currentFrame.current !== original.frameId) return;
      setError(message(e));
      if (e instanceof ClientError && e.code === 'REVISION_CONFLICT')
        setConflicts(e.details?.conflicts ?? []);
      else if (
        e instanceof ClientError &&
        e.details?.error &&
        !latest.current?.pending?.result &&
        ['VALIDATION', 'DUPLICATE_COPY_ID', 'REQUEST_REUSED'].includes(e.code)
      ) {
        setDraft((d) => (d ? { ...d, pending: undefined } : d));
        setStep('edit');
      }
    } finally {
      setBusy('');
    }
  };
  const resume = async () => {
    const d = latest.current;
    if (!d?.pending) return;
    setBusy('Recovering saved request…');
    setError('');
    try {
      const committed =
        d.pending.result ??
        (await request<MutationResult | null>(bridge, 'request', {
          requestId: d.pending.batch.requestId,
        })) ??
        (await request<MutationResult>(bridge, 'submit', { batch: d.pending.batch }));
      const updated = { ...d, pending: { ...d.pending, result: committed } };
      await persist(updated);
      if (currentFrame.current === updated.frameId) setDraft(updated);
      await applySaved(updated, committed);
    } catch (e) {
      if (currentFrame.current !== d.frameId) return;
      setError(message(e));
      if (e instanceof ClientError && e.code === 'REVISION_CONFLICT')
        setConflicts(e.details?.conflicts ?? []);
      else if (
        e instanceof ClientError &&
        e.details?.error &&
        !latest.current?.pending?.result &&
        ['VALIDATION', 'DUPLICATE_COPY_ID', 'REQUEST_REUSED'].includes(e.code)
      ) {
        setDraft((d) => (d ? { ...d, pending: undefined } : d));
        setStep('edit');
      }
    } finally {
      setBusy('');
    }
  };
  const reconcile = async (useLatest = false) => {
    const d = latest.current;
    if (!d?.pending?.result) return;
    setBusy('Rescanning remaining bindings…');
    setError('');
    try {
      const refreshed = useLatest ? await request<Catalog>(bridge, 'catalog') : null;
      const deliveryRecords = refreshed
        ? d.pending.result.records.map((r) => {
            const current = refreshed.records.find((c) => c.copyId === r.copyId);
            if (!current) throw new Error('Saved identity is missing from the registry');
            return current;
          })
        : d.pending.deliveryRecords;
      const scan = await request<{ selection: SelectionInfo }>(bridge, 'scan', {
        frameId: d.frameId,
      });
      const rows = d.rows.map((r) => {
        const layer = scan.selection.layers.find((l) => l.id === r.layerId);
        const record = deliveryRecords?.find((c) => c.copyId === r.copyId);
        const updated = record
          ? {
              ...r,
              en: record.en,
              id: record.id,
              product: record.product,
              context: record.context,
              baseline: record,
            }
          : r;
        return layer
          ? { ...updated, canvasFingerprint: canvasFingerprint(layer) }
          : { ...updated, action: 'keep' as const };
      });
      const next = await request<Preview>(bridge, 'preflight', {
        frameId: d.frameId,
        rows: rows.filter((r) => r.action !== 'keep'),
      });
      const updated = {
        ...d,
        rows,
        pending: { ...d.pending, targets: next.targets, deliveryRecords },
      };
      await persist(updated);
      if (currentFrame.current === d.frameId) {
        setDraft(updated);
        setPreview(next);
        setStep('review');
      }
    } catch (e) {
      if (currentFrame.current === d.frameId) setError(message(e));
    } finally {
      setBusy('');
    }
  };
  if (!selection)
    return (
      <main className="studio-body sb">
        <h1>Create new copies</h1>
        <p>Select a frame, component, or instance in Figma.</p>
      </main>
    );
  if (!draft) return <p className="studio-body sb">Reading frame… {error}</p>;
  const selected = draft.rows.filter((r) => r.action !== 'keep');
  const unbasedProducts = [...new Set(draft.rows.filter((r) => !r.baseline).map((r) => r.product))];
  const newRowsProduct = unbasedProducts.length === 1 ? unbasedProducts[0]! : '';
  return (
    <main className="studio-body sb">
      <div className="sb-line">
        <span>
          <h1>{draft.frameName}</h1>
        </span>
        <Stepper
          current={step === 'results' ? 3 : step === 'review' ? 2 : selected.length ? 1 : 0}
        />
      </div>
      {error && (
        <p role="alert" className="studio-warning">
          {error}
        </p>
      )}
      {busy && <p role="status">{busy}</p>}
      {draft.pending && (
        <div className="studio-warning">
          An operation is pending. Recover it before submitting another batch.
          <button disabled={!!busy || !connected} onClick={() => void resume()}>
            Recover / retry saved operation
          </button>
          {draft.pending.result && (
            <>
              <button disabled={!!busy} onClick={() => void reconcile()}>
                Review remaining bindings on the current canvas
              </button>
              <button disabled={!!busy || !connected} onClick={() => void reconcile(true)}>
                Review latest saved revisions
              </button>
            </>
          )}
        </div>
      )}
      {conflicts.map((c) => (
        <section className="copy-card" key={c.copyId}>
          <strong>Copy changed: {c.actualRecord?.platformKey ?? c.copyId}</strong>
          <p>Latest EN: {c.actualRecord?.en}</p>
          <p>Latest ID: {c.actualRecord?.id}</p>
          <button
            onClick={() => {
              setDraft((d) =>
                d
                  ? {
                      ...d,
                      pending: undefined,
                      rows: d.rows.map((r) =>
                        r.copyId === c.copyId
                          ? {
                              ...r,
                              baseline: c.actualRecord,
                              en: c.actualRecord.en,
                              id: c.actualRecord.id,
                              action: 'keep',
                            }
                          : r,
                      ),
                    }
                  : d,
              );
              setConflicts((cs) => cs.filter((x) => x !== c));
            }}
          >
            Use latest
          </button>
          <button
            onClick={() => {
              setDraft((d) =>
                d
                  ? {
                      ...d,
                      pending: undefined,
                      rows: d.rows.map((r) =>
                        r.copyId === c.copyId ? { ...r, baseline: c.actualRecord } : r,
                      ),
                    }
                  : d,
              );
              setConflicts((cs) => cs.filter((x) => x !== c));
              setStep('edit');
            }}
          >
            Revise my edit against latest
          </button>
          <button
            onClick={() => {
              setDraft((d) =>
                d
                  ? {
                      ...d,
                      pending: undefined,
                      rows: d.rows.map((r) =>
                        r.copyId === c.copyId
                          ? {
                              ...r,
                              baseline: c.actualRecord,
                              copyId: identity(),
                              action: 'variant',
                            }
                          : r,
                      ),
                    }
                  : d,
              );
              setConflicts((cs) => cs.filter((x) => x !== c));
              setStep('edit');
            }}
          >
            Create variant
          </button>
        </section>
      ))}
      {step === 'edit' && (
        <>
          <div className="studio-controls">
            <label>
              Canvas language{' '}
              <select
                value={draft.locale}
                disabled={!!draft.pending || !!busy}
                onChange={(e) => {
                  const locale = e.target.value as 'en' | 'id';
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          locale,
                          rows: d.rows.map((r) => {
                            if (r.baseline) return r;
                            const l = selection.layers.find((l) => l.id === r.layerId);
                            return canvasLocale(r, locale, l?.characters ?? r[r.locale]);
                          }),
                        }
                      : d,
                  );
                }}
              >
                <option value="id">ID</option>
                <option value="en">EN</option>
              </select>
            </label>
            <button
              disabled={!!draft.pending || !!busy}
              onClick={() =>
                setDraft((d) =>
                  d
                    ? {
                        ...d,
                        rows: d.rows.map((r) => {
                          const l = selection.layers.find((l) => l.id === r.layerId);
                          return l && !l.boundKey && !l.autoSkipReason && l.stored !== 'skip'
                            ? { ...r, action: 'create' }
                            : r;
                        }),
                      }
                    : d,
                )
              }
            >
              Select eligible unbound rows
            </button>
            <label>
              Product for new rows{' '}
              <select
                value={newRowsProduct}
                disabled={!!draft.pending || !!busy}
                onChange={(e) =>
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          rows: d.rows.map((r) =>
                            r.baseline ? r : { ...r, product: e.target.value },
                          ),
                        }
                      : d,
                  )
                }
              >
                <option value="">{unbasedProducts.length > 1 ? 'Mixed' : 'Choose…'}</option>
                {catalog.products
                  .filter((p) => p.id !== 'shared')
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {draft.rows.map((r) => {
            const layer = selection.layers.find((l) => l.id === r.layerId);
            const duplicates = catalog.records
              .filter(
                (c) =>
                  (c.product === r.product || c.product === 'shared') &&
                  c.status === 'active' &&
                  c.en === r.en &&
                  c.id === r.id,
              )
              .slice(0, 5);
            const status = rowStatus(r, draft, bound[r.layerId], catalog);
            return (
              <section
                className={`copy-card ${r.action === 'keep' ? '' : 'is-selected'}`}
                key={r.layerId}
              >
                <div className="copy-head">
                  <button
                    className="copy-title"
                    title="Show on canvas"
                    onClick={() =>
                      bridge.send({ type: 'layer:focus', layerId: r.layerId, zoom: true })
                    }
                  >
                    {layer?.name ?? r.layerId}
                  </button>
                  {status && <Badge label={status[0]} tone={status[1]} />}
                </div>
                <p className="canvas-copy">{layer?.characters}</p>
                {r.baseline && r.action === 'keep' && (
                  <small className="mono">{r.baseline.platformKey}</small>
                )}
                {layer?.autoSkipReason && (
                  <small>Looks like non-copy: {layer.autoSkipReason}</small>
                )}
                {r.baseline &&
                  (r.en !== r.baseline.en || r.id !== r.baseline.id) &&
                  r.action === 'keep' && (
                    <aside className="studio-warning">
                      Local wording differs from this saved revision. Review an edit or variant, or
                      restore the saved wording.
                      <button
                        disabled={!!draft.pending || !!busy}
                        onClick={() =>
                          change(r.layerId, {
                            action: 'reuse',
                            en: r.baseline!.en,
                            id: r.baseline!.id,
                            restoreLocal: true,
                          })
                        }
                      >
                        Restore saved values for this identity
                      </button>
                    </aside>
                  )}
                {r.restoreLocal && (
                  <p className="studio-warning">
                    Restoring updates every known usage of this local variable.
                  </p>
                )}
                {layer && canvasFingerprint(layer) !== r.canvasFingerprint && (
                  <p className="studio-warning">
                    Canvas changed.
                    <button
                      disabled={!!draft.pending || !!busy}
                      onClick={() =>
                        change(r.layerId, {
                          canvasFingerprint: canvasFingerprint(layer),
                          [r.locale]: layer.characters,
                        })
                      }
                    >
                      Refresh source and keep translation
                    </button>
                  </p>
                )}
                <select
                  aria-label={`Action for ${layer?.name}`}
                  value={r.action}
                  disabled={!!draft.pending || !!busy}
                  onChange={(e) => {
                    const action = e.target.value as DraftRow['action'];
                    change(r.layerId, {
                      action,
                      copyId:
                        action === 'variant' || (action === 'create' && !!r.baseline)
                          ? identity()
                          : r.baseline && ['edit', 'reuse', 'keep'].includes(action)
                            ? r.baseline.copyId
                            : r.action === 'edit' || r.action === 'reuse'
                              ? identity()
                              : r.copyId,
                    });
                  }}
                >
                  <option value="keep">Keep as is</option>
                  <option value="create">Create new</option>
                  <option value="reuse">Reuse existing</option>
                  {r.baseline && (
                    <>
                      <option value="edit">Edit existing globally</option>
                      <option value="variant">Create variant</option>
                    </>
                  )}
                </select>
                {r.action !== 'keep' && (
                  <>
                    <label>
                      Canvas language{' '}
                      <select
                        value={r.locale}
                        disabled={!!draft.pending || !!busy}
                        onChange={(e) => {
                          const locale = e.target.value as 'en' | 'id';
                          change(
                            r.layerId,
                            canvasLocale(r, locale, layer?.characters ?? r[r.locale]),
                          );
                        }}
                      >
                        <option value="en">EN</option>
                        <option value="id">ID</option>
                      </select>
                    </label>
                    {r.action === 'reuse' && (
                      <label>
                        Find saved copy
                        <input
                          value={reuseQueries[r.layerId] ?? ''}
                          onChange={(e) =>
                            setReuseQueries((v) => ({ ...v, [r.layerId]: e.target.value }))
                          }
                          placeholder="Search key, ID or wording"
                        />
                        Saved copy{' '}
                        <select
                          value={r.baseline?.copyId ?? ''}
                          disabled={!!draft.pending || !!busy}
                          onChange={(e) => {
                            const chosen = catalog.records.find(
                              (c) => c.copyId === e.target.value,
                            )!;
                            change(r.layerId, {
                              baseline: chosen,
                              copyId: chosen.copyId,
                              en: chosen.en,
                              id: chosen.id,
                              product: chosen.product,
                              context: chosen.context,
                            });
                          }}
                        >
                          <option value="">Choose…</option>
                          {catalog.records
                            .filter((c) => {
                              const q = (reuseQueries[r.layerId] ?? '').toLowerCase();
                              return (
                                (c.product === r.product || c.product === 'shared') &&
                                c.status === 'active' &&
                                (!q ||
                                  [c.platformKey, c.en, c.id, c.copyId].some((v) =>
                                    v.toLowerCase().includes(q),
                                  ))
                              );
                            })
                            .slice(0, 200)
                            .concat(
                              r.baseline &&
                                !catalog.records
                                  .slice(0, 200)
                                  .some((c) => c.copyId === r.baseline!.copyId)
                                ? [r.baseline]
                                : [],
                            )
                            .filter(
                              (c, i, all) => all.findIndex((x) => x.copyId === c.copyId) === i,
                            )
                            .map((c) => (
                              <option key={c.copyId} value={c.copyId}>
                                {c.platformKey} — {c[r.locale]}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    <div className="bilingual">
                      <label>
                        EN
                        <textarea
                          value={r.en}
                          readOnly={r.action === 'reuse' || !!draft.pending || !!busy}
                          onChange={(e) => change(r.layerId, { en: e.target.value })}
                        />
                      </label>
                      <label>
                        ID
                        <textarea
                          value={r.id}
                          readOnly={r.action === 'reuse' || !!draft.pending || !!busy}
                          onChange={(e) => change(r.layerId, { id: e.target.value })}
                        />
                      </label>
                    </div>
                    {r.action !== 'reuse' && (
                      <>
                        <ContextEditor
                          row={r}
                          catalog={catalog}
                          disabled={!!draft.pending || !!busy}
                          change={(update) => change(r.layerId, update)}
                        />
                        {bilingualErrors(r.en, r.id).map((err, i) => (
                          <small className="studio-warning" key={i}>
                            {err}
                          </small>
                        ))}
                      </>
                    )}
                    <small>
                      Provisional key:{' '}
                      {(() => {
                        try {
                          return proposedKey(r, catalog.products);
                        } catch (e) {
                          return message(e);
                        }
                      })()}
                    </small>
                    {r.action === 'edit' && (
                      <p className="studio-warning">
                        This edits the identity for every usage. Use Create variant for a
                        screen-specific change.
                      </p>
                    )}
                    {duplicates.length > 0 && r.action !== 'reuse' && (
                      <aside>
                        <strong>Same bilingual wording</strong>
                        {duplicates.map((c) => (
                          <p key={c.copyId}>
                            {c.platformKey} · {c.product}
                            <button
                              disabled={!!draft.pending || !!busy}
                              onClick={() =>
                                change(r.layerId, {
                                  action: 'reuse',
                                  baseline: c,
                                  copyId: c.copyId,
                                  en: c.en,
                                  id: c.id,
                                  product: c.product,
                                  context: c.context,
                                })
                              }
                            >
                              Reuse this copy
                            </button>
                          </p>
                        ))}
                        <small>You may keep Create new for a distinct context.</small>
                      </aside>
                    )}
                  </>
                )}
              </section>
            );
          })}
        </>
      )}
      {step === 'review' && (
        <>
          <h2>Review {selected.length} selected rows</h2>
          {selected.map((r) => {
            const committed = (
              draft.pending?.deliveryRecords ?? draft.pending?.result?.records
            )?.find((c) => c.copyId === r.copyId);
            const usages = preview?.usages?.[r.copyId];
            return (
              <section className="copy-card" key={r.layerId}>
                <div className="copy-head">
                  <strong className="mono">
                    {committed?.platformKey ?? proposedKey(r, catalog.products)}
                  </strong>
                  <Badge
                    label={ACTION_LABELS[r.action]}
                    tone={r.action === 'edit' ? 'warning' : 'brand'}
                  />
                </div>
                <p>EN: {r.en}</p>
                <p>ID: {r.id}</p>
                <small>
                  {[
                    catalog.products.find((p) => p.id === r.product)?.displayName,
                    r.context.feature,
                    r.context.screen,
                    r.context.context,
                    r.context.role,
                  ]
                    .filter(Boolean)
                    .join(' › ')}
                  {!committed && r.action !== 'edit' && r.action !== 'reuse'
                    ? ' · key is provisional'
                    : ''}
                </small>
                {(r.action === 'edit' || r.restoreLocal) && (
                  <p className="studio-warning">
                    Changes this identity everywhere it is used.{' '}
                    {usages === undefined
                      ? ''
                      : `${usages} known ${usages === 1 ? 'usage' : 'usages'} in this file. `}
                    Usages in other files are not counted; they catch up when those files are opened
                    with the plugin.
                  </p>
                )}
              </section>
            );
          })}
          <h2>Binding targets · {preview?.targets.length ?? 0}</h2>
          {preview?.targets.map((t) => (
            <p className="sb-line" key={t.nodeId}>
              <span>
                {t.frameName} ·{' '}
                {selection.layers.find((l) => l.id === t.nodeId)?.name ?? `layer ${t.nodeId}`} ·{' '}
                {t.locale.toUpperCase()}
                {t.duplicate ? ' · matching duplicate on this page' : ''}
              </span>
              {draft.pending?.result && (
                <button
                  onClick={() => {
                    setPreview((p) =>
                      p ? { ...p, targets: p.targets.filter((x) => x.nodeId !== t.nodeId) } : p,
                    );
                    setDraft((d) =>
                      d?.pending
                        ? {
                            ...d,
                            pending: {
                              ...d.pending,
                              targets: d.pending.targets.filter((x) => x.nodeId !== t.nodeId),
                            },
                          }
                        : d,
                    );
                  }}
                >
                  Keep this occurrence
                </button>
              )}
            </p>
          ))}
          {preview?.conflicts.map((c) => (
            <p className="studio-warning" key={c.nodeId}>
              Kept: {c.frameName} · layer {c.nodeId} is already bound to different copy.
            </p>
          ))}
          <p className="sb-muted">
            Keys are provisional until the registry allocates them; a concurrent save can add a
            numeric suffix.
          </p>
        </>
      )}
      {step === 'results' && (
        <>
          <h2>
            {draft.pending
              ? 'Saved, with outstanding Figma work'
              : result?.applied.length === 0
                ? 'Copy saved; no bindings applied'
                : 'Copy saved and applied'}
          </h2>
          <section className="copy-card">
            <div className="copy-head">
              <h2>Registry</h2>
              <Badge label="Saved" tone="success" />
            </div>
            {(
              draft.pending?.deliveryRecords ??
              draft.pending?.result?.records ??
              (result
                ? draft.rows.flatMap((r) =>
                    r.baseline && result.applied.includes(r.layerId) ? [r.baseline] : [],
                  )
                : [])
            )
              .filter((r, i, all) => all.findIndex((x) => x.copyId === r.copyId) === i)
              .map((r) => (
                <p className="sb-line" key={r.copyId}>
                  <span className="mono">{r.platformKey}</span>
                  <small>revision {r.revision}</small>
                </p>
              ))}
          </section>
          <section className="copy-card">
            <div className="copy-head">
              <h2>Figma</h2>
              {result && (
                <Badge
                  label={
                    result.failures.length || result.conflicts.length
                      ? 'Not fully applied'
                      : result.applied.length
                        ? 'Bound locally'
                        : 'Nothing bound'
                  }
                  tone={
                    result.failures.length || result.conflicts.length
                      ? 'warning'
                      : result.applied.length
                        ? 'success'
                        : 'neutral'
                  }
                />
              )}
            </div>
            {result ? (
              <p>
                {result.applied.length} occurrences applied · {result.conflicts.length} canvas
                conflicts · {result.failures.length} failures
              </p>
            ) : (
              <p>Saved earlier. Recover the operation above to finish binding.</p>
            )}
            {result?.conflicts.map((id) => (
              <p className="studio-warning" key={id}>
                {selection.layers.find((l) => l.id === id)?.name ?? `Layer ${id}`}: canvas changed
                after review. Review remaining bindings to reconcile.
              </p>
            ))}
            {result?.failures.map((f, i) => (
              <p className="studio-warning" key={i}>
                {selection.layers.find((l) => l.id === f.nodeId)?.name ?? f.nodeId}: {f.reason}
              </p>
            ))}
            {draft.pending && (
              <button disabled={!!busy || !connected} onClick={() => void resume()}>
                Retry Figma operation
              </button>
            )}
          </section>
          <p className="sb-muted">
            Central library synchronization and publication are separate steps.
          </p>
        </>
      )}
      <footer className="studio-footer">
        <span>
          {selected.length} selected · {draft.rows.length - selected.length} kept
        </span>
        {step === 'edit' ? (
          <button
            className="sb-primary"
            disabled={!!busy || !connected || !!draft.pending || !selected.length}
            onClick={() => void prepare()}
          >
            Review
          </button>
        ) : step === 'review' ? (
          <>
            <button disabled={!!busy} onClick={() => setStep('edit')}>
              Back to edit
            </button>
            {draft.pending?.result ? (
              <button
                className="sb-primary"
                disabled={!!busy}
                onClick={() => {
                  setBusy('Applying reviewed saved copy…');
                  void applySaved(draft, draft.pending!.result!)
                    .catch((e) => setError(message(e)))
                    .finally(() => setBusy(''));
                }}
              >
                Apply reviewed saved copy
              </button>
            ) : (
              <button
                className="sb-primary"
                disabled={!!busy || !connected || !!draft.pending}
                onClick={() => void submit()}
              >
                Save and apply
              </button>
            )}
          </>
        ) : (
          <button onClick={() => setStep('edit')} disabled={!!busy || !!draft.pending}>
            Work on this frame
          </button>
        )}
      </footer>
    </main>
  );
}
function ContextEditor({
  row,
  catalog,
  disabled,
  change,
}: {
  row: DraftRow;
  catalog: Catalog;
  disabled: boolean;
  change: (update: Partial<DraftRow>) => void;
}) {
  return (
    <div className="context-fields">
      <label>
        Product
        <select
          value={row.product}
          disabled={disabled || row.action === 'edit'}
          onChange={(e) => change({ product: e.target.value })}
        >
          <option value="">Choose…</option>
          {catalog.products
            .filter((p) => p.id !== 'shared' || row.baseline?.product === 'shared')
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
        </select>
      </label>
      {(['feature', 'screen', 'context', 'note'] as const).map((field) => (
        <label key={field}>
          {field}
          <input
            value={row.context[field]}
            disabled={disabled}
            onChange={(e) => change({ context: { ...row.context, [field]: e.target.value } })}
          />
        </label>
      ))}
      <label>
        Role
        <select
          value={row.context.role}
          disabled={disabled}
          onChange={(e) => change({ context: { ...row.context, role: e.target.value } })}
        >
          {roles.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
      <label>
        Qualifier
        <select
          value={row.context.qualifier ?? ''}
          disabled={disabled}
          onChange={(e) =>
            change({
              context: {
                ...row.context,
                qualifier: e.target.value
                  ? (e.target.value as 'primary' | 'secondary' | 'tertiary')
                  : undefined,
              },
            })
          }
        >
          <option value="">None</option>
          <option value="primary">Primary</option>
          <option value="secondary">Secondary</option>
          <option value="tertiary">Tertiary</option>
        </select>
      </label>
    </div>
  );
}

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
};
/** One sync run must stay well inside the registry's 4 MB request limit. */
const ADOPT_BATCH = 5000;
function Library({ bridge, onCatalog }: { bridge: UiBridge; onCatalog: (cat: Catalog) => void }) {
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
  const [showCurrent, setShowCurrent] = useState(false);
  const [page, setPage] = useState(0);
  const [pending, setPending] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [pendingReview, setPendingReview] = useState<LocalCopy[] | null>(null);
  const owner = useRef(crypto.randomUUID());
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
      const run = await rpc<any>('library:manifest');
      if (run) setResult(run);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy('');
    }
  };
  const rows = useMemo(() => {
    const remoteById = new Map(catalog.records.map((r) => [r.copyId, r]));
    const localIds = new Set(locals.map((l) => l.copyId));
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
      const mapping = catalog.mappings.find(
        (m) => m.libraryId === config.libraryId && m.copyId === row.remote?.copyId,
      );
      const status =
        kind === 'current' && mapping?.publishedRevision !== row.remote?.revision
          ? 'publish'
          : kind;
      return { ...row, kind, status };
    });
  }, [catalog.records, catalog.mappings, locals, config.libraryId]);
  const counts = rows.reduce<Record<string, number>>((all, row) => {
    const label = LIBRARY_STATUS[row.status]![0].split(' · ')[0]!;
    all[label] = (all[label] ?? 0) + 1;
    return all;
  }, {});
  const visible = rows.filter((r) => showCurrent || r.status !== 'current');
  const selected = rows.filter((r) => choices[r.id] && choices[r.id] !== 'defer');
  // First reconciliation of an imported library is thousands of identical rows.
  const adoptable = rows.filter(
    (r) =>
      r.local &&
      r.remote &&
      !r.local.error &&
      (r.kind === 'unbased' || r.kind === 'equal') &&
      r.local.en === r.remote.en &&
      r.local.id === r.remote.id &&
      !choices[r.id],
  );
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
    setBusy('Applying reviewed manifest…');
    try {
      const state = {
        ...pending,
        entries: pending.entries.map((entry: any) => {
          const local =
            pendingReview.find((l) => l.variableId === entry.variableId) ??
            pendingReview.find((l) => l.copyId === entry.copyId);
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
        runId: crypto.randomUUID(),
        owner: owner.current,
        entries,
        pullRecords,
        batch: operations.length
          ? {
              requestId: crypto.randomUUID(),
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
      <h1>Library sync</h1>
      <p>
        Review local changes before Push. Review saved changes before Pull. Publish separately
        through Figma.
      </p>
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
                const key = e.target.value.match(/\/design\/([^/?]+)/)?.[1];
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
          <label className="sb-check">
            <input
              type="checkbox"
              checked={showCurrent}
              onChange={(e) => {
                setShowCurrent(e.target.checked);
                setPage(0);
              }}
            />{' '}
            Show up-to-date
          </label>
          <button
            disabled={!!busy}
            onClick={() =>
              void rpc('library:publish')
                .then(() => {
                  setResult((r: any) => ({ ...r, published: true }));
                  setError('');
                })
                .catch((e) => setError(message(e)))
            }
          >
            Verify publication
          </button>
          <button className="sb-quiet" disabled={!!busy} onClick={() => setConfigured(false)}>
            Change setup
          </button>
        </div>
      )}
      {configured && rows.length > 0 && (
        <div className="badges" aria-label="Library status">
          {Object.entries(LIBRARY_STATUS)
            .map(([, [label, tone]]) => [label.split(' · ')[0]!, tone] as const)
            .filter(([label], i, all) => all.findIndex(([l]) => l === label) === i)
            .filter(([label]) => counts[label])
            .map(([label, tone]) => (
              <Badge key={label} label={`${label} · ${counts[label]}`} tone={tone} />
            ))}
        </div>
      )}
      {configured && !review && adoptable.length > 0 && (
        <div className="studio-warning">
          <span>
            {adoptable.length} variables already match their saved wording exactly and only need a
            baseline.
            {adoptable.length > ADOPT_BATCH
              ? ` Adopt, publish and verify ${ADOPT_BATCH} at a time.`
              : ''}
          </span>
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
            const entry = pending.entries.find((e: any) => e.copyId === r.copyId);
            const local =
              pendingReview.find((l) => l.variableId === entry?.variableId) ??
              pendingReview.find((l) => l.copyId === r.copyId);
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
                const records = originals.map((r: CopyRecord) => {
                  const current = catalog.records.find((c) => c.copyId === r.copyId);
                  if (!current) throw new Error('Registry identity is missing');
                  return current;
                });
                setPending((p: any) => ({
                  ...p,
                  deliveryRecords: records,
                  runId: crypto.randomUUID(),
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
                  {row.status === 'publish' ? ' · publish through Figma, then verify' : ''}
                </small>
                {row.local?.error && <p className="studio-warning">{row.local.error}</p>}
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
                    catalog.records
                      .filter(
                        (c) =>
                          c.en === row.local?.en && c.id === row.local?.id && c.status === 'active',
                      )
                      .slice(0, 5)
                      .map((c) => (
                        <option key={c.copyId} value={`reuse:${c.copyId}`}>
                          Reuse {c.platformKey}
                        </option>
                      ))}
                </select>
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
    </main>
  );
}
