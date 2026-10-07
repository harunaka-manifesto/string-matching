import type {
  ApplyPreview,
  ApplySummary,
  AuthoringDraft,
  BindingResult,
  Catalog,
  CopyRecord,
  DraftRow,
  LayerDecision,
  Locale,
  MutationBatch,
  MutationResult,
  SelectionInfo,
} from '@string-binder/contracts';
import {
  featureVocabulary,
  filterSequenceSource,
  guessFeature,
  guessProduct,
  inProduct,
  operationOf,
  productLabel,
  SHARED_PRODUCT,
} from '@string-binder/domain';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UiBridge } from '../bridge';
import { Icon } from '../components/Icon';
import { LayerRow, rowKind, type RowKind } from '../components/LayerRow';
import { Menu, type MenuItem } from '../components/Menu';
import { SearchPanel } from '../components/SearchPanel';
import { SummaryPanel } from '../components/SummaryPanel';
import {
  decisionsFor,
  initialRowState,
  resolveRows,
  type ResolvedRow,
  type RowState,
} from '../frame-rows';
import { registryKey } from '../index-merge';
import { message } from '../shared';
import { useStringIndex, type IndexStatus } from '../string-index';
import { ClientError, request } from '../workflow-client';
import { ComposeForm } from './ComposeForm';
import {
  composeCreate,
  composeEdit,
  composeErrors,
  composeVariant,
  conflictingEdits,
  fromDraft,
  rebaseline,
  toDraft,
  type Pending,
} from './model';
import { ReviewSheet, withoutTargets, type CommitPlan, type RevisionConflict } from './ReviewSheet';
import { uuid } from '../uuid';

export type Registry = {
  catalog: Catalog;
  connected: boolean;
  status: string;
  issue: string;
  refreshing: boolean;
  refresh: (force?: boolean) => Promise<void>;
};

type Toast = { id: number; text: string; tone: 'info' | 'error' };
type Result = { summary: ApplySummary; frameName: string; saved: CopyRecord[] };

const EMPTY_SUMMARY: ApplySummary = {
  boundInFrame: 0,
  boundAcrossPage: 0,
  framesTouched: 0,
  skipsCopied: 0,
  conflicts: [],
  failures: [],
  propagated: [],
};

/** Keeps a panel mounted while its closing animation runs. */
function usePresence(open: boolean, ms = 180): boolean {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(timer);
  }, [open, ms]);
  return open || mounted;
}

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return (
    !!element &&
    (element.tagName === 'INPUT' ||
      element.tagName === 'TEXTAREA' ||
      element.tagName === 'SELECT' ||
      element.isContentEditable ||
      !!element.closest('.menu__panel, [role="combobox"], .compose'))
  );
}

function IndexNotice({ status, onRefresh }: { status: IndexStatus; onRefresh: () => void }) {
  switch (status.phase) {
    case 'starting':
    case 'listing':
      return <p className="notice">Checking the library for new strings…</p>;
    case 'importing':
      return (
        <p className="notice">
          Loading strings {status.done.toLocaleString()} / {status.total.toLocaleString()}
          <span className="notice__hint"> · you can start while this runs</span>
        </p>
      );
    case 'empty':
      return (
        <p className="notice notice--warning">
          No string library is on. In Assets › Libraries, turn on GoPay Strings, then{' '}
          <button type="button" className="link-button" onClick={onRefresh}>
            check again
          </button>
          .
        </p>
      );
    case 'ready':
      return status.failed ? (
        <p className="notice notice--warning">
          {status.failed.toLocaleString()} strings could not load.{' '}
          <button type="button" className="link-button" onClick={onRefresh}>
            Retry
          </button>
        </p>
      ) : null;
  }
}

/** How far each suggested row sits below the string it follows, for the cascade animation. */
function cascadeOf(rows: readonly ResolvedRow[]): number[] {
  let run = 0;
  return rows.map((row) => {
    run = row.source === 'sequence' ? run + 1 : 0;
    return run;
  });
}

/** Snapshot of what decides a row's starting state; a change resets that row's choices. */
const layerStamp = (layer: SelectionInfo['layers'][number]) =>
  `${layer.boundKey ?? ''}/${layer.stored ?? ''}`;

export function Writer({
  bridge,
  registry,
  active,
  onLibrary,
}: {
  bridge: UiBridge;
  registry: Registry;
  active: boolean;
  onLibrary: () => void;
}) {
  const index = useStringIndex(bridge);
  const { catalog, connected } = registry;
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [states, setStates] = useState<Map<string, RowState>>(() => new Map());
  const [locale, setLocale] = useState<Locale>('id');
  const [pending, setPending] = useState<Pending | undefined>();
  const [loadedFrame, setLoadedFrame] = useState<string | null>(null);
  const [searchFor, setSearchFor] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [plan, setPlan] = useState<CommitPlan | null>(null);
  const [dropped, setDropped] = useState<ReadonlySet<string>>(() => new Set());
  const [conflicts, setConflicts] = useState<RevisionConflict[]>([]);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [used, setUsed] = useState<ReadonlySet<string>>(() => new Set());
  const [chosenScope, setChosenScope] = useState<Record<string, string>>({});
  const frameRef = useRef<string | null>(null);
  frameRef.current = selection?.frameId ?? null;
  const device = useRef<string>(uuid());

  const say = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    setToast({ id: Date.now(), text, tone });
  }, []);

  useEffect(() => {
    void request<string>(bridge, 'device', { proposed: device.current })
      .then((id) => (device.current = id))
      .catch(() => {});
  }, [bridge]);

  // Canvas edits inside the frame arrive in bursts; re-read once they settle.
  const reread = useRef<ReturnType<typeof setTimeout>>();
  useEffect(
    () =>
      bridge.subscribe((event) => {
        switch (event.type) {
          case 'selection':
            setSelection(event.selection);
            if (event.selection?.frameId !== frameRef.current) {
              setPlan(null);
              setSearchFor(null);
              setConflicts([]);
            }
            return;
          case 'canvas:changed':
            clearTimeout(reread.current);
            reread.current = setTimeout(() => bridge.send({ type: 'frame:reread' }), 400);
            return;
          case 'apply:done':
            return;
          case 'usage':
            setUsed(new Set(event.keys));
            return;
          case 'flags:selected':
            say(
              event.count
                ? `Selected ${event.count} flagged layer${event.count === 1 ? '' : 's'} on this page.`
                : 'No flagged layers on this page.',
            );
            return;
          case 'error':
            setBusy('');
            say(event.message, 'error');
            return;
          default:
            return;
        }
      }),
    [bridge, say],
  );
  useEffect(() => {
    bridge.send({ type: 'ui:ready' });
  }, [bridge]);
  useEffect(() => {
    if (!toast || toast.tone === 'error') return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  // ── Drafts: restore per frame, save shortly after every change and on frame switch ──
  // Last draft of a loaded frame; survives the render where the selection already moved on.
  const draftNow = useRef<AuthoringDraft | null>(null);
  // Memoized: building and serializing the draft on every render made typing lag.
  const currentDraft = useMemo(
    () =>
      selection && loadedFrame === selection.frameId
        ? toDraft({
            frameId: selection.frameId,
            frameName: selection.frameName,
            locale,
            layers: selection.layers,
            states,
            pending,
          })
        : null,
    [selection, loadedFrame, locale, states, pending],
  );
  if (currentDraft) draftNow.current = currentDraft;
  const persist = useCallback(
    (draft: AuthoringDraft | null) =>
      draft
        ? request(bridge, 'draft:save', { draft }).catch((e) => say(message(e), 'error'))
        : Promise.resolve(),
    [bridge, say],
  );
  const frameId = selection?.frameId ?? null;
  useEffect(() => {
    if (!frameId) return;
    let cancelled = false;
    setLoadedFrame(null);
    setStates(new Map());
    setPending(undefined);
    void request<AuthoringDraft | null>(bridge, 'draft:get', { frameId })
      .catch(() => null)
      .then((draft) => {
        if (cancelled) return;
        const layers = latestSelection.current?.layers ?? [];
        setStates(fromDraft(draft, layers));
        setLocale(draft?.locale ?? 'id');
        setPending(draft?.pending);
        setLoadedFrame(frameId);
      });
    return () => {
      cancelled = true;
      if (draftNow.current?.frameId === frameId) void persist(draftNow.current);
    };
  }, [bridge, frameId, persist]);
  const latestSelection = useRef(selection);
  latestSelection.current = selection;
  const serialized = useMemo(
    () => (currentDraft ? JSON.stringify(currentDraft) : ''),
    [currentDraft],
  );
  useEffect(() => {
    if (!serialized) return;
    const timer = setTimeout(() => void persist(draftNow.current), 180);
    return () => clearTimeout(timer);
  }, [serialized, persist]);

  // A re-read of the same frame: layers whose binding or stored state changed start fresh,
  // drafted copy stays, and renames alone no longer count as canvas changes.
  const stamps = useRef(new Map<string, string>());
  useEffect(() => {
    if (!selection) return;
    const previous = stamps.current;
    const next = new Map(selection.layers.map((layer) => [layer.id, layerStamp(layer)]));
    stamps.current = next;
    setStates((current) => {
      let changed = false;
      const updated = new Map(current);
      for (const layer of selection.layers) {
        const state = current.get(layer.id);
        if (!state) continue;
        const moved = previous.has(layer.id) && previous.get(layer.id) !== next.get(layer.id);
        const compose = state.compose ? rebaseline(state.compose, layer) : null;
        if (moved && !compose) {
          updated.delete(layer.id);
          changed = true;
        } else if (compose !== (state.compose ?? null)) {
          updated.set(layer.id, { ...state, compose });
          changed = true;
        }
      }
      return changed ? updated : current;
    });
  }, [selection]);

  // ── Product scope: one per page, guessed once, writer's choice wins ──
  const page = selection?.page;
  const stored = page?.scope ?? null;
  const guess = useMemo(() => {
    if (!selection || stored) return null;
    const boundNames = [...selection.layers.map((layer) => layer.boundKey), ...used].flatMap(
      (key) => {
        const entry = key ? index.entries.get(key) : undefined;
        return entry?.product ? [`${entry.product}/x`] : [];
      },
    );
    return guessProduct({
      boundNames,
      contextNames: selection.contextNames,
      vocabulary: index.vocabulary,
    });
  }, [selection, stored, used, index.entries, index.vocabulary]);
  const scope = (page && chosenScope[page.id]) ?? stored?.product ?? guess ?? null;
  const guessed = useRef(new Set<string>());
  useEffect(() => {
    if (!page || stored || !guess || guessed.current.has(page.id)) return;
    if (index.status.phase !== 'ready' && index.status.phase !== 'importing') return;
    guessed.current.add(page.id);
    void request(bridge, 'scope:set', { pageId: page.id, product: guess, confirmed: false }).catch(
      () => {},
    );
  }, [bridge, page, stored, guess, index.status.phase]);
  const setScope = (product: string) => {
    if (!page) return;
    setChosenScope((current) => ({ ...current, [page.id]: product }));
    void request(bridge, 'scope:set', { pageId: page.id, product, confirmed: true }).catch((e) =>
      say(message(e), 'error'),
    );
  };
  // New copy drafted before the page had a product takes it as soon as it has one.
  useEffect(() => {
    if (!scope) return;
    setStates((current) => {
      let changed = false;
      const next = new Map(current);
      for (const [layerId, state] of current)
        if (state.compose?.action === 'create' && !state.compose.product) {
          next.set(layerId, { ...state, compose: { ...state.compose, product: scope } });
          changed = true;
        }
      return changed ? next : current;
    });
  }, [scope, states]);
  const feature = useMemo(() => {
    if (!scope || !selection) return null;
    return guessFeature(selection.contextNames, featureVocabulary(index.list, scope));
  }, [scope, selection, index.list]);

  const sequences = useMemo(() => {
    if (!scope) return filterSequenceSource(index.sequences, () => false);
    return filterSequenceSource(index.sequences, (key) => {
      const item = index.entries.get(key);
      return !!item && inProduct(item, scope);
    });
  }, [scope, index.sequences, index.entries]);

  // ── Rows ──
  const same = useCallback(
    (a: string, b: string) =>
      a === b || (!!index.entries.get(a) && index.entries.get(a) === index.entries.get(b)),
    [index.entries],
  );
  const rows = useMemo(
    () => (selection ? resolveRows(selection.layers, states, sequences) : []),
    [selection, states, sequences],
  );
  const kinds = useMemo(() => rows.map((row) => rowKind(row, same)), [rows, same]);
  const cascade = useMemo(() => cascadeOf(rows), [rows]);
  const usedCanonical = useMemo(
    () => new Set([...used].map((key) => index.entries.get(key)?.key ?? key)),
    [used, index.entries],
  );
  const counts = useMemo(() => {
    const result = Object.fromEntries(
      (
        [
          'bound',
          'picked',
          'suggested',
          'replace',
          'unbind',
          'empty',
          'flag',
          'skip',
          'create',
          'edit',
          'variant',
        ] as RowKind[]
      ).map((kind) => [kind, 0]),
    ) as Record<RowKind, number>;
    for (const kind of kinds) result[kind] += 1;
    return result;
  }, [kinds]);
  const drafted = counts.create + counts.edit + counts.variant;
  const changes = counts.picked + counts.suggested + counts.replace + counts.unbind + drafted;

  const update = useCallback((layerId: string, change: (state: RowState) => RowState) => {
    setStates((current) => {
      const layer = latestSelection.current?.layers.find((item) => item.id === layerId);
      if (!layer) return current;
      const next = new Map(current);
      next.set(layerId, change(current.get(layerId) ?? initialRowState(layer)));
      return next;
    });
  }, []);
  /** Picking restarts the sequence here, so nudges further down no longer apply. */
  const pick = useCallback((layerId: string, key: string) => {
    setStates((current) => {
      const layers = latestSelection.current?.layers ?? [];
      const next = new Map(current);
      const at = layers.findIndex((layer) => layer.id === layerId);
      for (let i = at; i >= 0 && i < layers.length; i += 1) {
        const layer = layers[i]!;
        const state = next.get(layer.id) ?? initialRowState(layer);
        if (i === at) {
          next.set(layer.id, {
            ...state,
            status: 'include',
            pick: key,
            unbind: false,
            shift: 0,
            compose: null,
          });
          continue;
        }
        if (state.pick ?? (state.unbind ? null : layer.boundKey)) break;
        if (state.shift) next.set(layer.id, { ...state, shift: 0 });
      }
      return next;
    });
  }, []);
  const setCompose = (layerId: string, compose: DraftRow | null) =>
    update(layerId, (state) => ({ ...state, status: 'include', compose }));
  const changeCompose = (layerId: string, patch: Partial<DraftRow>) =>
    update(layerId, (state) =>
      state.compose ? { ...state, compose: { ...state.compose, ...patch } } : state,
    );
  const recordOf = (key: string | null) => (key ? index.entries.get(key)?.record : undefined);
  const startCreate = (layerId: string) => {
    const layer = selection?.layers.find((item) => item.id === layerId);
    if (!layer || !selection) return;
    setCompose(
      layerId,
      composeCreate(layer, locale, scope ?? '', selection.frameName, feature ?? ''),
    );
    setActiveId(layerId);
    setSearchFor(null);
  };
  const startEdit = (layerId: string, variant: boolean) => {
    const layer = selection?.layers.find((item) => item.id === layerId);
    const record = recordOf(layer?.boundKey ?? null);
    if (!layer || !record) return;
    const fresh = catalog.records.find((r) => r.copyId === record.copyId) ?? record;
    setCompose(
      layerId,
      variant ? composeVariant(layer, fresh, locale) : composeEdit(layer, fresh, locale),
    );
    setActiveId(layerId);
  };
  const discardFrame = () => {
    setStates(new Map());
    setConflicts([]);
  };

  // ── Search ──
  const searchOpen = !!selection && rows.some((row) => row.layer.id === searchFor);
  const searchMounted = usePresence(searchOpen);
  const lastSearch = useRef<string | null>(null);
  if (searchOpen) lastSearch.current = searchFor;
  const searchIndex = rows.findIndex((row) => row.layer.id === lastSearch.current);
  const searchRow = searchIndex === -1 ? null : rows[searchIndex]!;
  // Stable while the row and frame stay put, so search does not re-rank on unrelated renders.
  const searchContextNames = useMemo(
    () => [...(searchRow?.layer.contextNames ?? []), ...(selection?.contextNames ?? [])],
    [searchRow?.layer.contextNames, selection?.contextNames],
  );
  /** Active records by exact bilingual value; duplicate hints look up instead of scanning. */
  const activeByValue = useMemo(() => {
    const groups = new Map<string, Catalog['records']>();
    for (const c of catalog.records) {
      if (c.status !== 'active') continue;
      const key = `${c.en}\u0000${c.id}`;
      const group = groups.get(key);
      if (group) group.push(c);
      else groups.set(key, [c]);
    }
    return groups;
  }, [catalog.records]);
  const anchorHint = useMemo(() => {
    for (let i = searchIndex - 1; i >= 0; i -= 1) if (rows[i]!.key) return rows[i]!.key;
    return null;
  }, [rows, searchIndex]);

  const resultMounted = usePresence(!!result);
  const lastResult = useRef(result);
  if (result) lastResult.current = result;

  const focusRow = useCallback((layerId: string) => {
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`#row-${CSS.escape(layerId)} .row__main`)?.focus(),
    );
  }, []);
  const openSearch = (layerId: string) => {
    setActiveId(layerId);
    setSearchFor(layerId);
  };
  const closeSearch = () => {
    const id = searchFor;
    setSearchFor(null);
    if (id) focusRow(id);
  };

  // ── Commit: plan → (review) → save → bind ──
  const bindKey = useCallback(
    (key: string, boundKey: string | null) => {
      if (boundKey && same(key, boundKey)) return boundKey;
      return index.entries.get(key)?.bindKey ?? key;
    },
    [index.entries, same],
  );
  const saves = useMemo(
    () =>
      rows.flatMap((row) =>
        row.state.compose && row.state.status === 'include' ? [row.state.compose] : [],
      ),
    [rows],
  );
  const problems = useMemo(
    () => new Map(saves.map((row) => [row.layerId, composeErrors(row, catalog.products)[0] ?? ''])),
    [saves, catalog.products],
  );
  const blocked = [...problems.values()].some(Boolean);

  const start = async () => {
    if (!selection || busy || !selection.layers.length) return;
    if (pending) {
      say('Finish or discard the earlier save first.', 'error');
      return;
    }
    if (blocked) {
      const first = [...problems].find(([, problem]) => problem)!;
      setActiveId(first[0]);
      say(first[1], 'error');
      return;
    }
    if (saves.length && !connected) {
      say('New copy needs a connection to the registry. Retry when online.', 'error');
      return;
    }
    if (conflictingEdits(saves)) {
      say('Two rows change the same copy differently. Make them match first.', 'error');
      return;
    }
    const target = selection.frameId;
    const decisions = decisionsFor(rows, bindKey);
    if (!decisions.length && !saves.length) {
      say('Nothing to apply yet. Choose a string for a layer first.');
      return;
    }
    setBusy('Checking the frame…');
    try {
      const [applyPreview, delivery] = await Promise.all([
        decisions.length
          ? request<ApplyPreview>(bridge, 'apply:preview', { frameId: target, decisions })
          : Promise.resolve(null),
        saves.length
          ? request<CommitPlan['delivery']>(bridge, 'preflight', { frameId: target, rows: saves })
          : Promise.resolve(null),
      ]);
      if (frameRef.current !== target) return;
      const next: CommitPlan = {
        frameId: target,
        frameName: selection.frameName,
        decisions,
        saves,
        applyPreview,
        delivery,
      };
      const duplicatesChange =
        (applyPreview?.targets.some((t) => t.change !== 'none') ?? false) ||
        (delivery?.targets.some((t) => t.duplicate) ?? false);
      setDropped(new Set());
      if (!saves.length && !duplicatesChange) {
        await commit(next);
        return;
      }
      setPlan(next);
    } catch (e) {
      if (frameRef.current === target) say(message(e), 'error');
    } finally {
      setBusy('');
    }
  };

  /** Saves drafted copy, then binds everything in one commit on the canvas. */
  const commit = async (reviewed: CommitPlan, resume?: Pending) => {
    const target = reviewed.frameId;
    const here = () => frameRef.current === target;
    let d: Pending | undefined = resume;
    const persistPending = async (value: Pending | undefined) => {
      if (here()) setPending(value);
      const base = here()
        ? draftNow.current
        : await request<AuthoringDraft | null>(bridge, 'draft:get', { frameId: target });
      if (base) await persist({ ...base, pending: value });
    };
    try {
      let records: CopyRecord[] = [];
      if (reviewed.saves.length || d) {
        if (!d) {
          const operations = [
            ...new Map(
              reviewed.saves
                .map(operationOf)
                .filter((op): op is NonNullable<typeof op> => !!op)
                .map((op) => [op.copyId, op]),
            ).values(),
          ];
          const batch: MutationBatch = {
            requestId: uuid(),
            operations,
            attribution: { deviceId: device.current },
          };
          d = {
            batch,
            targets: reviewed.delivery?.targets ?? [],
            decisions: reviewed.decisions,
            ...(reviewed.applyPreview ? { applyPreview: reviewed.applyPreview } : {}),
          };
          await persistPending(d);
        }
        if (!d.result) {
          setBusy('Saving copy…');
          const committed =
            (await request<MutationResult | null>(bridge, 'request', {
              requestId: d.batch.requestId,
            }).catch(() => null)) ??
            (await request<MutationResult>(bridge, 'submit', { batch: d.batch }));
          d = { ...d, result: committed };
          await persistPending(d);
        }
        records = d.deliveryRecords ?? d.result!.records;
      }
      setBusy('Applying in Figma…');
      const outcome = await request<{ binding: BindingResult; summary: ApplySummary | null }>(
        bridge,
        'writer:commit',
        {
          frameId: target,
          records,
          targets: d?.targets ?? [],
          globalIds: reviewed.saves
            .filter((r) => r.action === 'edit' || r.restoreLocal)
            .map((r) => r.copyId),
          restoreIds: reviewed.saves.filter((r) => r.restoreLocal).map((r) => r.copyId),
          decisions: d?.decisions ?? reviewed.decisions,
          preview: d ? d.applyPreview : (reviewed.applyPreview ?? undefined),
        },
      );
      const { binding } = outcome;
      const layers = new Map(
        (latestSelection.current?.layers ?? []).map((layer) => [layer.id, layer.name]),
      );
      const named = (nodeId: string) => ({
        id: nodeId,
        name: layers.get(nodeId) ?? 'Text layer',
        frameName: reviewed.frameName,
      });
      const base = outcome.summary ?? EMPTY_SUMMARY;
      const summary: ApplySummary = {
        ...base,
        boundInFrame: base.boundInFrame + binding.applied.filter((id) => layers.has(id)).length,
        boundAcrossPage:
          base.boundAcrossPage + binding.applied.filter((id) => !layers.has(id)).length,
        conflicts: [...base.conflicts, ...binding.conflicts.map(named)],
        failures: [
          ...base.failures,
          ...binding.failures.map((f) => ({ ...named(f.nodeId), reason: f.reason })),
        ],
      };
      const unfinished = binding.failures.length > 0;
      await persistPending(unfinished ? d : undefined);
      if (here()) {
        // Drafted rows that landed become ordinary bound rows after the re-read.
        const landed = new Set(binding.applied);
        setStates((current) => {
          const next = new Map(current);
          for (const [layerId, state] of current)
            if (state.compose && landed.has(layerId)) next.delete(layerId);
            else if (!state.compose) next.delete(layerId);
          return next;
        });
        setPlan(null);
        setConflicts([]);
        setResult({ summary, frameName: reviewed.frameName, saved: d?.result?.records ?? [] });
      } else say(`${reviewed.frameName}: copy saved and applied.`);
      void registry.refresh();
    } catch (e) {
      if (!here()) {
        say(`${reviewed.frameName}: ${message(e)}`, 'error');
        return;
      }
      if (e instanceof ClientError && e.code === 'REVISION_CONFLICT') {
        await persistPending(undefined);
        setConflicts(e.details?.conflicts ?? []);
        setPlan(reviewed);
      } else if (
        e instanceof ClientError &&
        !d?.result &&
        ['VALIDATION', 'DUPLICATE_COPY_ID', 'REQUEST_REUSED'].includes(e.code)
      ) {
        // Rejected outright: nothing was saved, so the writer can fix the draft and retry.
        await persistPending(undefined);
        say(message(e), 'error');
      } else say(message(e), 'error');
    } finally {
      setBusy('');
    }
  };

  const retryPending = () => {
    if (!pending || !selection) return;
    void commit(
      {
        frameId: selection.frameId,
        frameName: selection.frameName,
        decisions: pending.decisions ?? [],
        saves: saves.filter((row) =>
          pending.batch.operations.some((op) => op.copyId === row.copyId),
        ),
        applyPreview: pending.applyPreview ?? null,
        delivery: { targets: pending.targets, conflicts: [] },
      },
      pending,
    );
  };
  const discardPending = async () => {
    if (!pending) return;
    setBusy('Checking the earlier save…');
    try {
      const saved =
        pending.result ??
        (await request<MutationResult | null>(bridge, 'request', {
          requestId: pending.batch.requestId,
        }));
      if (saved) {
        // Saved copy stays saved; offer it as picks so nothing written is lost.
        for (const record of saved.records) {
          const row = pending.targets.find((t) => t.copyId === record.copyId && !t.duplicate);
          if (row)
            pick(
              row.nodeId,
              index.entries.get(registryKey(record.copyId))?.key ?? registryKey(record.copyId),
            );
        }
        say('That copy was already saved. Its layers now point at it; apply when ready.');
      }
      setPending(undefined);
      await persist(draftNow.current && { ...draftNow.current, pending: undefined });
    } catch (e) {
      say(message(e), 'error');
    } finally {
      setBusy('');
    }
  };
  const resolveConflict = (conflict: RevisionConflict, choice: 'theirs' | 'revise' | 'variant') => {
    const latest = conflict.actualRecord;
    for (const row of saves.filter((r) => r.copyId === conflict.copyId)) {
      if (choice === 'theirs' || !latest)
        pick(
          row.layerId,
          index.entries.get(registryKey(conflict.copyId))?.key ?? registryKey(conflict.copyId),
        );
      else if (choice === 'revise') changeCompose(row.layerId, { baseline: latest });
      else {
        const layer = selection?.layers.find((l) => l.id === row.layerId);
        if (layer)
          setCompose(row.layerId, {
            ...composeVariant(layer, latest, row.locale),
            en: row.en,
            id: row.id,
          });
      }
    }
    setConflicts((current) => current.filter((c) => c !== conflict));
    setPlan(null);
  };

  // ── Canvas follows the keyboard ──
  const revealTimer = useRef<ReturnType<typeof setTimeout>>();
  const activate = useCallback(
    (layerId: string, zoom: boolean) => {
      setActiveId(layerId);
      clearTimeout(revealTimer.current);
      revealTimer.current = setTimeout(
        () => bridge.send({ type: 'layer:focus', layerId, zoom }),
        zoom ? 0 : 140,
      );
    },
    [bridge],
  );
  useEffect(() => {
    if (!activeId) return;
    document
      .getElementById(`row-${activeId}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeId, active]);

  useEffect(() => {
    if (!active || plan || searchOpen || result || !rows.length) return;
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key === 'Enter') {
        event.preventDefault();
        void start();
        return;
      }
      if (isTyping(event.target) || meta || event.altKey) return;
      const at = rows.findIndex((row) => row.layer.id === activeId);
      const row = at === -1 ? null : rows[at]!;
      const inList = !!(event.target as HTMLElement | null)?.closest?.('.rows');
      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowUp': {
          const next =
            rows[
              Math.max(0, Math.min(rows.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))
            ]!;
          activate(next.layer.id, false);
          if (inList) focusRow(next.layer.id);
          break;
        }
        case 'Enter':
          // A focused button handles Enter itself.
          if ((event.target as HTMLElement).tagName === 'BUTTON' || !row) return;
          openSearch(row.layer.id);
          break;
        case 'Escape':
          if (!activeId) return;
          setActiveId(null);
          break;
        case 'n':
          if (!row || row.state.compose) return;
          startCreate(row.layer.id);
          break;
        case 's':
        case 'f':
          if (!row) return;
          update(row.layer.id, (current) => {
            const status = event.key === 's' ? 'skip' : 'flag';
            return { ...current, status: current.status === status ? 'include' : status };
          });
          break;
        case 'u':
          if (!row?.layer.boundKey || row.state.compose) return;
          update(row.layer.id, (current) =>
            current.unbind
              ? { ...current, unbind: false }
              : { ...current, pick: null, unbind: true },
          );
          break;
        case '[':
        case ']':
          if (row?.source !== 'sequence') return;
          update(row.layer.id, (current) => ({
            ...current,
            shift: current.shift + (event.key === ']' ? 1 : -1),
          }));
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ── Header menus ──
  const scopeItems: MenuItem[] = index.products
    .filter((product) => product.id !== SHARED_PRODUCT)
    .map((product) => ({
      id: product.id,
      label: productLabel(product.id),
      hint: product.count.toLocaleString(),
      checked: scope === product.id,
      onSelect: () => setScope(product.id),
    }));
  const loading =
    index.status.phase === 'starting' ||
    index.status.phase === 'listing' ||
    index.status.phase === 'importing';
  const overflowItems: MenuItem[] = [
    {
      id: 'reread',
      label: 'Re-read frame',
      disabled: !selection,
      onSelect: () => bridge.send({ type: 'frame:reread' }),
    },
    {
      id: 'flags',
      label: 'Select flagged layers on page',
      onSelect: () => bridge.send({ type: 'flags:select' }),
    },
    {
      id: 'reset',
      label: 'Discard my changes in this frame',
      disabled: !states.size,
      onSelect: discardFrame,
    },
    {
      id: 'refresh',
      label: loading ? 'Loading strings…' : 'Reload strings',
      hint: index.list.length ? index.list.length.toLocaleString() : undefined,
      disabled: loading,
      separatorBefore: true,
      onSelect: () => {
        index.refresh();
        void registry.refresh(true);
      },
    },
    {
      id: 'library',
      label: 'Library sync (maintainers)',
      separatorBefore: true,
      onSelect: onLibrary,
    },
  ];
  const progress =
    index.status.phase === 'importing' && index.status.total
      ? index.status.done / index.status.total
      : index.status.phase === 'ready' || index.status.phase === 'empty'
        ? null
        : 0.08;
  const scopeAuto = !!scope && !(page && chosenScope[page.id]) && !stored?.confirmed;

  const duplicatesFor = (row: DraftRow) =>
    (activeByValue.get(`${row.en}\u0000${row.id}`) ?? [])
      .filter(
        (c) =>
          (c.product === row.product || c.product === SHARED_PRODUCT) && c.copyId !== row.copyId,
      )
      .slice(0, 3);

  const primaryLabel = busy
    ? busy
    : drafted
      ? `Review and apply · ${changes}`
      : changes
        ? `Apply · ${changes}`
        : 'Apply to frame and page';

  return (
    <main className="app">
      <div className="workspace" {...(searchOpen || result || plan ? { inert: '' } : {})}>
        <header className="top">
          <div className="top__row">
            <div className="top__title">
              <span className="eyebrow">
                {selection?.page ? selection.page.name : 'String Binder'}
              </span>
              <h1 title={selection?.frameName}>{selection?.frameName ?? 'Select a frame'}</h1>
            </div>
            {selection && (
              <Menu
                triggerClassName={`scope ${scope === null ? 'scope--unset' : ''}`}
                triggerLabel={
                  scopeAuto
                    ? 'Product for this page, guessed from names. Click to confirm or change.'
                    : 'Product for every frame on this page'
                }
                title="Product for this page"
                items={scopeItems}
                align="end"
                trigger={() => (
                  <>
                    {scopeAuto && <Icon name="sparkle" className="scope__auto" />}
                    <span className="scope__label">
                      {scope === null ? 'Choose product' : productLabel(scope)}
                    </span>
                    <Icon name="chevron" />
                  </>
                )}
              />
            )}
            <Menu
              triggerClassName="icon-button"
              triggerLabel="More actions"
              items={overflowItems}
              align="end"
              trigger={() => <Icon name="more" />}
            />
          </div>
          <div className={`status ${connected ? '' : 'is-offline'}`} role="status">
            <i className="status__dot" aria-hidden="true" />
            <span className="status__text">
              {connected ? registry.status : `Offline · ${registry.status}`}
            </span>
            {!connected && (
              <button
                type="button"
                className="link-button"
                disabled={registry.refreshing}
                onClick={() => void registry.refresh(true)}
              >
                Retry
              </button>
            )}
          </div>
          {progress !== null && (
            <div className="progress" role="progressbar" aria-label="Loading strings">
              <span style={{ transform: `scaleX(${progress})` }} />
            </div>
          )}
        </header>

        <IndexNotice status={index.status} onRefresh={index.refresh} />
        {registry.issue && <p className="notice notice--warning">{registry.issue}</p>}
        {pending && (
          <div className="notice notice--warning pending" role="alert">
            <span>
              {pending.result
                ? 'Copy from your last save is saved but not fully applied.'
                : 'Your last save didn’t finish. It may or may not have reached the registry.'}
            </span>
            <span className="pending__actions">
              <button
                type="button"
                className="button button--secondary"
                disabled={!!busy || (!connected && !pending.result)}
                onClick={retryPending}
              >
                Retry
              </button>
              <button
                type="button"
                className="link-button"
                disabled={!!busy}
                onClick={() => void discardPending()}
              >
                {pending.result ? 'Leave unapplied' : 'Discard'}
              </button>
            </span>
          </div>
        )}

        {!selection ? (
          <div className="intro">
            <div className="intro__art" aria-hidden="true">
              <Icon name="frame" />
            </div>
            <h2>Select a frame to work on its copy</h2>
            <ol>
              <li>Select one frame, component or instance on the canvas.</li>
              <li>Pick each layer’s string. The rest follow the legacy sheet order.</li>
              <li>No string fits? Press N to write new copy in EN and ID.</li>
              <li>Apply. Matching layers on this page get the same strings.</li>
            </ol>
          </div>
        ) : selection.layers.length === 0 ? (
          <div className="intro">
            <h2>No visible text in this frame</h2>
            <p className="intro__text">Select a frame that contains text layers.</p>
          </div>
        ) : (
          <>
            <div className="rows__heading">
              <h2>Text layers</h2>
              <span>
                {rows.length} in reading order
                {feature && scope ? ` · ${feature.replace(/-/gu, ' ')}` : ''}
              </span>
            </div>
            <ol className="rows" aria-label="Text layers in reading order">
              {rows.map((row, i) => {
                const compose = row.state.compose;
                const record = recordOf(row.layer.boundKey);
                return (
                  <LayerRow
                    key={row.layer.id}
                    row={row}
                    kind={kinds[i]!}
                    entry={row.key ? index.entries.get(row.key) : undefined}
                    previous={
                      row.layer.boundKey ? index.entries.get(row.layer.boundKey) : undefined
                    }
                    active={row.layer.id === activeId}
                    cascade={cascade[i]!}
                    problem={
                      compose && row.layer.id !== activeId
                        ? problems.get(row.layer.id) || undefined
                        : undefined
                    }
                    compose={
                      compose && (
                        <ComposeForm
                          row={compose}
                          layer={row.layer}
                          catalog={catalog}
                          disabled={!!busy}
                          duplicates={duplicatesFor(compose)}
                          onChange={(patch) => changeCompose(row.layer.id, patch)}
                          onUseExisting={(found) =>
                            pick(
                              row.layer.id,
                              index.entries.get(registryKey(found.copyId))?.key ??
                                registryKey(found.copyId),
                            )
                          }
                          onCancel={() => setCompose(row.layer.id, null)}
                        />
                      )
                    }
                    onActivate={() => activate(row.layer.id, true)}
                    onChoose={() => openSearch(row.layer.id)}
                    onReveal={() =>
                      bridge.send({ type: 'layer:focus', layerId: row.layer.id, zoom: true })
                    }
                    onCreate={() => startCreate(row.layer.id)}
                    onEdit={record && connected ? () => startEdit(row.layer.id, false) : undefined}
                    onVariant={
                      record && connected ? () => startEdit(row.layer.id, true) : undefined
                    }
                    onChange={(change) => update(row.layer.id, change)}
                  />
                );
              })}
            </ol>
          </>
        )}

        {toast && (
          <div
            className={`toast toast--${toast.tone}`}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            key={toast.id}
          >
            <span>{toast.text}</span>
            <button
              type="button"
              className="icon-button"
              aria-label="Dismiss"
              onClick={() => setToast(null)}
            >
              <Icon name="close" />
            </button>
          </div>
        )}

        {selection && selection.layers.length > 0 && (
          <footer className="footer">
            <div className="tally" aria-live="polite">
              {drafted > 0 && <span className="tally--brand">{drafted} new or edited</span>}
              {counts.replace > 0 && (
                <span className="tally--warning">{counts.replace} replace</span>
              )}
              {counts.unbind > 0 && <span className="tally--danger">{counts.unbind} unbind</span>}
              {counts.empty > 0 && <span>{counts.empty} empty</span>}
              {counts.flag > 0 && <span className="tally--warning">{counts.flag} flagged</span>}
              {counts.skip > 0 && <span className="tally--quiet">{counts.skip} skipped</span>}
            </div>
            <button
              type="button"
              className={`button button--primary ${busy ? 'is-busy' : ''}`}
              disabled={!!busy || !!pending}
              onClick={() => void start()}
              title="Apply  ⌘↵"
            >
              {primaryLabel}
            </button>
          </footer>
        )}
      </div>

      {searchMounted && selection && searchRow && (
        <div
          className="overlay"
          data-state={searchOpen ? 'open' : 'closed'}
          {...(!searchOpen ? { inert: '' } : {})}
        >
          <SearchPanel
            key={searchRow.layer.id}
            canvasText={searchRow.layer.characters.replace(/\s+/gu, ' ').trim()}
            layerName={searchRow.layer.name}
            contextNames={searchContextNames}
            current={searchRow.key ? index.entries.get(searchRow.key) : undefined}
            currentKey={
              searchRow.key ? (index.entries.get(searchRow.key)?.key ?? searchRow.key) : null
            }
            anchorHint={anchorHint}
            list={index.list}
            entries={index.entries}
            sequences={sequences}
            used={usedCanonical}
            scope={scope}
            feature={feature}
            products={index.products}
            onScope={setScope}
            onPick={(key) => {
              pick(searchRow.layer.id, key);
              closeSearch();
            }}
            onCreateNew={() => startCreate(searchRow.layer.id)}
            onClose={closeSearch}
          />
        </div>
      )}

      {plan && selection && (
        <div className="overlay overlay--sheet" data-state="open">
          <ReviewSheet
            plan={plan}
            selection={selection}
            catalog={catalog}
            entries={index.entries}
            dropped={dropped}
            conflicts={conflicts}
            busy={busy}
            onToggle={(id) =>
              setDropped((current) => {
                const next = new Set(current);
                if (!next.delete(id)) next.add(id);
                return next;
              })
            }
            onResolve={resolveConflict}
            onConfirm={() => void commit(withoutTargets(plan, dropped))}
            onClose={() => {
              setPlan(null);
              setConflicts([]);
            }}
          />
        </div>
      )}
      {resultMounted && lastResult.current && (
        <div className="overlay overlay--sheet" data-state={result ? 'open' : 'closed'}>
          <SummaryPanel
            summary={lastResult.current.summary}
            frameName={lastResult.current.frameName}
            saved={lastResult.current.saved}
            onSelect={(ids) => bridge.send({ type: 'layers:select', layerIds: ids })}
            onClose={() => setResult(null)}
          />
        </div>
      )}
    </main>
  );
}
