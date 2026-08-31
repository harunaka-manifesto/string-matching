import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PluginToUiMessageSchema,
  parseSheetCellUrl,
  type ErrorCode,
  type ErrorPayload,
  type SheetSource as SheetSourceModel,
  type SheetValue,
  type User,
} from '@ux-copy-sync/contracts';
import {
  moveReplacement,
  normalizeLayerName,
  pairingStats,
  reviewedPairs,
  type PairingTarget,
} from '@ux-copy-sync/domain';
import { AuthGate } from './components/AuthGate';
import { SelectionCard, type SelectionCardValue } from './components/SelectionCard';
import { SheetSource } from './components/SheetSource';
import { PairingList, type ExcludedSheetValue } from './components/PairingList';
import { ActionFooter } from './components/ActionFooter';
import { ReviewContext } from './components/ReviewContext';
import type { UiBridge } from './bridge';
import type { AppPhase, AuthState } from './state/model';
import { errorGuidance, type ErrorAction } from './error-copy';
import './styles.css';

function requestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function localError(code: ErrorCode, message: string): ErrorPayload {
  return { code, message };
}

export function App({ bridge }: { bridge: UiBridge }) {
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [enabledPublicTestMode, setEnabledPublicTestMode] = useState(false);
  const [user, setUser] = useState<User | undefined>();
  const [selection, setSelection] = useState<SelectionCardValue>(null);
  const [selectionValid, setSelectionValid] = useState(false);
  const [selectionMessage, setSelectionMessage] = useState<string | undefined>();
  const [pinnedSelection, setPinnedSelection] = useState<SelectionCardValue>(null);
  const [cellUrl, setCellUrl] = useState('');
  const [urlError, setUrlError] = useState<string | undefined>();
  const [phase, setPhase] = useState<AppPhase>('idle');
  const [previewToken, setPreviewToken] = useState<string | undefined>();
  const [previewSource, setPreviewSource] = useState<SheetSourceModel | undefined>();
  const [targets, setTargets] = useState<PairingTarget[]>([]);
  const [replacements, setReplacements] = useState<SheetValue[]>([]);
  const [error, setError] = useState<ErrorPayload | undefined>();
  const [staleKind, setStaleKind] = useState<'figma' | 'source' | undefined>();
  const [excluded, setExcluded] = useState<ExcludedSheetValue[]>([]);
  const [sourceEditorOpen, setSourceEditorOpen] = useState(false);
  const [appliedCount, setAppliedCount] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const pollTimer = useRef<number | undefined>();
  const fetchTimeout = useRef<number | undefined>();
  const pollInFlight = useRef(false);
  const fetchId = useRef<string | undefined>();
  const phaseRef = useRef(phase);
  const previewTokenRef = useRef(previewToken);
  const previewTargetRef = useRef<string | null>(null);
  const previewTargetSentRef = useRef<string | null>(null);
  const previewTargetFrameRef = useRef<number | undefined>();
  const previewTargetQueuedRef = useRef<string | null | undefined>();
  const previewEnabledRef = useRef(false);
  const refreshInFlightRef = useRef(false);
  const excludedOrderRef = useRef(0);
  const errorRef = useRef<HTMLDivElement>(null);
  phaseRef.current = phase;
  previewTokenRef.current = previewToken;

  const stopPolling = () => {
    pollInFlight.current = false;
    if (pollTimer.current !== undefined) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = undefined;
    }
  };
  const stopFetchTimeout = () => {
    if (fetchTimeout.current !== undefined) {
      window.clearTimeout(fetchTimeout.current);
      fetchTimeout.current = undefined;
    }
  };
  const startFetchTimeout = (id: string) => {
    stopFetchTimeout();
    fetchTimeout.current = window.setTimeout(() => {
      if (fetchId.current !== id) return;
      send({ type: 'cancel-fetch', payload: { requestId: id } });
      fetchId.current = undefined;
      setPhase(refreshInFlightRef.current ? 'review' : 'idle');
      refreshInFlightRef.current = false;
      setError(localError('SHEET_READ_FAILED', 'The Sheet request timed out.'));
      setAnnouncement('The backend request timed out.');
    }, 25_000);
  };
  const send = bridge.send;

  useEffect(() => {
    const unsubscribe = bridge.subscribe((message) => {
      const parsed = PluginToUiMessageSchema.safeParse(message);
      if (!parsed.success) return;
      const next = parsed.data;
      switch (next.type) {
        case 'auth-state':
          setEnabledPublicTestMode(next.enabledPublicTestMode);
          setUser(next.user);
          setAuthState(
            next.mode === 'public-test'
              ? 'public-test'
              : next.authenticated
                ? 'authenticated'
                : 'required',
          );
          if (!next.authenticated && next.mode !== 'public-test') {
            clearPreviewTarget();
            if (fetchId.current)
              send({ type: 'cancel-fetch', payload: { requestId: fetchId.current } });
            stopFetchTimeout();
            fetchId.current = undefined;
            setPhase('idle');
            setPreviewToken(undefined);
            setPreviewSource(undefined);
            setTargets([]);
            setReplacements([]);
            setExcluded([]);
            setStaleKind(undefined);
            setError(undefined);
            setSelectionValid(false);
            setSelectionMessage(undefined);
          }
          if (next.authenticated || next.mode === 'public-test')
            send({ type: 'get-selection-state' });
          break;
        case 'auth-started':
          setAnnouncement('Sign-in opened in your browser.');
          stopPolling();
          pollTimer.current = window.setInterval(() => {
            if (pollInFlight.current) return;
            pollInFlight.current = true;
            send({ type: 'auth:poll-tick' });
          }, 1000);
          break;
        case 'auth-poll':
          pollInFlight.current = false;
          if (next.status === 'complete') stopPolling();
          if (next.status === 'complete') setAnnouncement('Sign-in complete.');
          if (next.status === 'failed') {
            stopPolling();
            setAuthState('required');
            setError(next.error);
            setAnnouncement('Sign-in failed.');
          }
          break;
        case 'auth-cancelled':
          stopPolling();
          setAuthState('required');
          setAnnouncement('Sign-in cancelled.');
          break;
        case 'selection-state':
          setSelection(next.selection);
          setSelectionValid(next.valid);
          setSelectionMessage(next.message);
          if (phaseRef.current === 'idle') setPinnedSelection(next.selection);
          break;
        case 'preview-ready':
          if (fetchId.current !== next.requestId) break;
          stopFetchTimeout();
          previewTokenRef.current = next.previewToken;
          setPreviewToken(next.previewToken);
          setPinnedSelection(next.selection);
          setSelectionValid(true);
          setSelectionMessage(undefined);
          setPreviewSource(next.source);
          setTargets(
            next.targets.map((target) => ({
              layerId: target.id,
              layerName: target.name,
              originalText: target.originalCharacters,
              originalName: target.originalName,
              included: true,
            })),
          );
          setReplacements(next.values);
          setExcluded([]);
          excludedOrderRef.current = 0;
          refreshInFlightRef.current = false;
          setSourceEditorOpen(false);
          setPhase('review');
          setStaleKind(undefined);
          setError(undefined);
          setAnnouncement(`Fetched ${next.values.length} non-empty Sheet strings.`);
          break;
        case 'preview-stale':
          if (next.previewToken === previewTokenRef.current) {
            clearPreviewTarget();
            setPhase('stale');
            setStaleKind(next.kind);
            setError(
              localError(next.kind === 'source' ? 'SOURCE_STALE' : 'PREVIEW_STALE', next.reason),
            );
            setAnnouncement(next.reason);
          }
          break;
        case 'apply-reviewed-pairs-result':
          if (next.previewToken !== previewTokenRef.current) break;
          if (next.ok && next.result) {
            setAppliedCount(next.result.appliedCount);
            setPhase('applied');
            setError(undefined);
            setAnnouncement(
              `Updated ${next.result.appliedCount} layer${next.result.appliedCount === 1 ? '' : 's'}.`,
            );
          } else if (next.error?.code === 'SOURCE_STALE') {
            setPhase('stale');
            setStaleKind('source');
            setError(next.error);
            setAnnouncement(next.error.message);
          } else if (next.error?.code === 'PREVIEW_STALE') {
            setPhase('stale');
            setStaleKind('figma');
            setError(next.error);
            setAnnouncement(next.error.message);
          } else {
            setPhase('review');
            const payload =
              next.error ?? localError('APPLY_FAILED', 'The changes could not be applied.');
            setError(payload);
            setAnnouncement(payload.message);
          }
          break;
        case 'error':
          if (!next.requestId || next.requestId === fetchId.current) {
            stopFetchTimeout();
            setPhase((current) =>
              current === 'fetching' ? (refreshInFlightRef.current ? 'review' : 'idle') : current,
            );
            refreshInFlightRef.current = false;
            setError(next.error);
            setAnnouncement(next.error.message);
          }
          break;
      }
    });
    send({ type: 'auth:check' });
    return () => {
      unsubscribe();
      stopPolling();
      stopFetchTimeout();
    };
    // The bridge is intentionally stable for the lifetime of the plugin.
  }, []);

  const localParsed = useMemo(() => {
    if (!cellUrl.trim()) return null;
    try {
      return parseSheetCellUrl(cellUrl);
    } catch {
      return null;
    }
  }, [cellUrl]);
  const sourceDirty = Boolean(previewSource && previewSource.cellUrl !== cellUrl);
  const previewEnabled = phase === 'review' && !sourceDirty && Boolean(previewToken);
  previewEnabledRef.current = previewEnabled;

  const clearPreviewTarget = useCallback(() => {
    const token = previewTokenRef.current;
    const hadPendingTarget =
      previewTargetRef.current !== null ||
      previewTargetSentRef.current !== null ||
      previewTargetFrameRef.current !== undefined ||
      previewTargetQueuedRef.current !== undefined;
    if (!hadPendingTarget) return;
    if (previewTargetFrameRef.current !== undefined) {
      window.cancelAnimationFrame(previewTargetFrameRef.current);
      previewTargetFrameRef.current = undefined;
    }
    previewTargetQueuedRef.current = undefined;
    previewTargetRef.current = null;
    if (token && previewTargetSentRef.current !== null) {
      previewTargetSentRef.current = null;
      send({ type: 'preview-target', payload: { previewToken: token, layerId: null } });
    }
  }, [send]);
  const handlePreviewTarget = useCallback(
    (layerId: string | null) => {
      const token = previewTokenRef.current;
      if (previewTargetRef.current === layerId) return;
      previewTargetRef.current = layerId;
      if (!token || !previewEnabledRef.current) return;
      previewTargetQueuedRef.current = layerId;
      if (previewTargetFrameRef.current !== undefined) return;
      previewTargetFrameRef.current = window.requestAnimationFrame(() => {
        previewTargetFrameRef.current = undefined;
        const queued = previewTargetQueuedRef.current;
        previewTargetQueuedRef.current = undefined;
        const nextToken = previewTokenRef.current;
        if (
          queued === undefined ||
          !nextToken ||
          !previewEnabledRef.current ||
          queued === previewTargetSentRef.current
        )
          return;
        previewTargetSentRef.current = queued;
        send({ type: 'preview-target', payload: { previewToken: nextToken, layerId: queued } });
      });
    },
    [send],
  );
  useEffect(() => {
    if (!previewEnabled) clearPreviewTarget();
  }, [clearPreviewTarget, previewEnabled]);
  useEffect(() => () => clearPreviewTarget(), [clearPreviewTarget]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  const stats = useMemo(() => pairingStats(targets, replacements), [targets, replacements]);
  const reviewLocked =
    phase === 'fetching' ||
    phase === 'applying' ||
    phase === 'applied' ||
    phase === 'stale' ||
    sourceDirty;

  const handleUrlChange = (value: string) => {
    clearPreviewTarget();
    if (phase === 'fetching') {
      if (fetchId.current) send({ type: 'cancel-fetch', payload: { requestId: fetchId.current } });
      stopFetchTimeout();
      fetchId.current = undefined;
      setPhase('idle');
      setAnnouncement('Fetch cancelled.');
    }
    setCellUrl(value);
    if (!value.trim()) {
      setUrlError(undefined);
      return;
    }
    try {
      parseSheetCellUrl(value);
      setUrlError(undefined);
    } catch (cause) {
      setUrlError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const handleRefresh = () => {
    if (!previewToken || !localParsed || phase === 'fetching' || phase === 'applying') return;
    clearPreviewTarget();
    const id = requestId();
    fetchId.current = id;
    refreshInFlightRef.current = true;
    startFetchTimeout(id);
    setPhase('fetching');
    setError(undefined);
    setStaleKind(undefined);
    setAnnouncement('Refreshing review…');
    send({
      type: 'refresh-preview',
      payload: {
        requestId: id,
        previewToken,
        cellUrl,
        mode: authState === 'public-test' ? 'public-test' : 'authenticated',
      },
    });
  };

  const handleFetch = () => {
    if (previewToken) {
      handleRefresh();
      return;
    }
    if (!localParsed || !selection || !selectionValid) return;
    const id = requestId();
    fetchId.current = id;
    refreshInFlightRef.current = false;
    startFetchTimeout(id);
    setPhase('fetching');
    setError(undefined);
    setStaleKind(undefined);
    setAnnouncement('Fetching Sheet copy…');
    send({
      type: 'fetch-preview',
      payload: {
        requestId: id,
        cellUrl,
        mode: authState === 'public-test' ? 'public-test' : 'authenticated',
      },
    });
  };
  const handleApply = () => {
    if (!previewToken || stats.changed === 0 || sourceDirty) return;
    clearPreviewTarget();
    setPhase('applying');
    setError(undefined);
    setAnnouncement(`Applying ${stats.changed} change${stats.changed === 1 ? '' : 's'}…`);
    const targetById = new Map(targets.map((target) => [target.layerId, target]));
    const pairs = reviewedPairs(targets, replacements).filter((pair) => {
      const target = targetById.get(pair.layerId);
      return Boolean(
        target &&
        (target.originalText !== pair.value ||
          target.originalName !== normalizeLayerName(pair.value)),
      );
    });
    send({
      type: 'apply-reviewed-pairs',
      payload: { previewToken, pairs },
    });
  };
  const handleNewPreview = () => {
    clearPreviewTarget();
    if (fetchId.current) send({ type: 'cancel-fetch', payload: { requestId: fetchId.current } });
    stopFetchTimeout();
    if (previewToken) send({ type: 'discard-preview', payload: { previewToken } });
    setPhase('idle');
    setPreviewToken(undefined);
    setPreviewSource(undefined);
    setTargets([]);
    setReplacements([]);
    setExcluded([]);
    excludedOrderRef.current = 0;
    setError(undefined);
    setStaleKind(undefined);
    setSelectionValid(false);
    setSelectionMessage(undefined);
    setSourceEditorOpen(false);
    setAppliedCount(0);
    setAnnouncement('Ready to build a new preview.');
    send({ type: 'get-selection-state' });
  };
  const handleToggle = (layerId: string) => {
    const target = targets.find((item) => item.layerId === layerId);
    if (!target) return;
    const rowNumber = targets.findIndex((item) => item.layerId === layerId) + 1;
    setAnnouncement(
      target.included ? `Row ${rowNumber}: keep current.` : `Row ${rowNumber} included again.`,
    );
    setTargets((current) =>
      current.map((item) =>
        item.layerId === layerId ? { ...item, included: !item.included } : item,
      ),
    );
  };
  const handleMove = (id: string, index: number) =>
    setReplacements((current) => moveReplacement(current, id, index));
  const handleExclude = (replacementId: string) => {
    const index = replacements.findIndex((replacement) => replacement.id === replacementId);
    const replacement = replacements[index];
    if (!replacement) return;
    setReplacements((current) => current.filter((item) => item.id !== replacementId));
    const excludedOrder = excludedOrderRef.current++;
    setExcluded((current) => [
      ...current.map((entry) =>
        entry.originalIndex > index ? { ...entry, originalIndex: entry.originalIndex - 1 } : entry,
      ),
      { replacement, originalIndex: index, excludedOrder },
    ]);
    setAnnouncement(`${replacement.cell} excluded from active Sheet values.`);
  };
  const handleRestore = (replacementId: string) => {
    const entry = excluded.find(({ replacement }) => replacement.id === replacementId);
    if (!entry) return;
    setReplacements((current) => {
      const next = [...current];
      next.splice(Math.max(0, Math.min(entry.originalIndex, next.length)), 0, entry.replacement);
      return next;
    });
    setExcluded((current) =>
      current
        .filter(({ replacement }) => replacement.id !== replacementId)
        .map((item) =>
          item.originalIndex > entry.originalIndex ||
          (item.originalIndex === entry.originalIndex && item.excludedOrder > entry.excludedOrder)
            ? { ...item, originalIndex: item.originalIndex + 1 }
            : item,
        ),
    );
    setAnnouncement(`${entry.replacement.cell} restored to active Sheet values.`);
  };
  const handleLocate = (layerId: string) => {
    if (previewToken) send({ type: 'select-node', payload: { previewToken, layerId } });
  };

  const canFetch = Boolean(
    localParsed &&
    phase !== 'fetching' &&
    phase !== 'applying' &&
    (previewToken ? Boolean(pinnedSelection) : Boolean(selection && selectionValid)),
  );
  const fetchLabel = sourceDirty ? 'Fetch new source' : 'Fetch copy';
  const hasReviewContext = Boolean(previewSource && previewToken);
  const guidance = error ? errorGuidance(error, hasReviewContext) : undefined;
  const handleErrorAction = (action: ErrorAction) => {
    if (action === 'sign-in') {
      setAuthState('connecting');
      setError(undefined);
      send({ type: 'auth:start' });
    } else if (action === 'change-source') {
      setSourceEditorOpen(true);
    } else if (action === 'apply') {
      handleApply();
    } else if (action === 'refresh') {
      handleRefresh();
    } else {
      handleFetch();
    }
  };

  if (authState === 'checking' || authState === 'required' || authState === 'connecting')
    return (
      <AuthGate
        state={
          authState === 'checking'
            ? 'checking'
            : authState === 'connecting'
              ? 'connecting'
              : 'required'
        }
        enabledPublicTestMode={enabledPublicTestMode}
        error={error?.message}
        onConnect={() => {
          setAuthState('connecting');
          setError(undefined);
          send({ type: 'auth:start' });
        }}
        onReopen={() => {
          setAuthState('connecting');
          setError(undefined);
          send({ type: 'auth:start' });
        }}
        onPublicTest={() => {
          setAuthState('public-test');
          setError(undefined);
          send({ type: 'auth:enter-public-test' });
        }}
        onCancel={() => {
          stopPolling();
          setAuthState('required');
          send({ type: 'auth:cancel' });
        }}
      />
    );

  return (
    <div className="app-shell">
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
      <header className={`app-header ${hasReviewContext ? 'review-header' : ''}`}>
        <div>
          <h1 className="app-title">UX Copy Sync</h1>
        </div>
        {user && (
          <div className="account">
            {user.email}{' '}
            <button onClick={() => send({ type: 'auth:disconnect' })}>Disconnect</button>
          </div>
        )}
      </header>
      {authState === 'public-test' && (
        <div className="test-banner">
          <button
            onClick={() => {
              handleNewPreview();
              setAuthState('required');
              send({ type: 'auth:exit-public-test' });
            }}
          >
            Exit test mode
          </button>
          <strong>TEST MODE</strong>Public Sheets only · Google sign-in bypassed
        </div>
      )}
      <main className="content">
        {previewSource && previewToken ? (
          <ReviewContext
            selection={pinnedSelection}
            source={previewSource}
            cellUrl={cellUrl}
            parsed={localParsed}
            counts={{
              changed: stats.changed,
              synced: stats.alreadySynced,
              kept: stats.skipped,
              unassigned: stats.unassigned,
              excluded: excluded.length,
            }}
            sourceDirty={sourceDirty}
            editorOpen={sourceEditorOpen}
            disabled={phase === 'fetching' || phase === 'applying'}
            canFetch={canFetch}
            loading={phase === 'fetching'}
            urlError={urlError}
            onChange={handleUrlChange}
            onChangeSource={() => setSourceEditorOpen((open) => !open)}
            onFetch={handleFetch}
          />
        ) : (
          <>
            <SelectionCard
              selection={selection}
              valid={selectionValid}
              message={selectionMessage}
            />
            <SheetSource
              value={cellUrl}
              parsed={localParsed}
              disabled={phase === 'fetching' || phase === 'applying'}
              canFetch={canFetch}
              loading={phase === 'fetching'}
              fetchLabel={fetchLabel}
              error={urlError}
              onChange={handleUrlChange}
              onFetch={handleFetch}
            />
          </>
        )}
        {hasReviewContext && phase === 'fetching' && (
          <div className="refreshing" role="status">
            Refreshing review…
          </div>
        )}
        {sourceDirty && (
          <div className="notice" role="status">
            This Sheet link changed after the review. Fetch new source before applying.
          </div>
        )}
        {staleKind && (
          <div className="notice" role="status">
            {staleKind === 'source'
              ? 'The Sheet copy changed after this review. Refresh the review before applying.'
              : 'The design changed after this review. Refresh the review before applying.'}
            <br />
            <button className="secondary" onClick={handleRefresh} disabled={phase === 'fetching'}>
              Refresh review
            </button>
          </div>
        )}
        {targets.length > 0 && (
          <PairingList
            targets={targets}
            replacements={replacements}
            disabled={reviewLocked}
            onToggle={handleToggle}
            onMove={handleMove}
            onLocate={handleLocate}
            excluded={excluded}
            onExclude={handleExclude}
            onRestore={handleRestore}
            onPreviewTarget={handlePreviewTarget}
            previewEnabled={previewEnabled}
          />
        )}
        {guidance && phase !== 'stale' && (
          <div className="error" role="alert" ref={errorRef} tabIndex={-1}>
            <span>{guidance.message}</span>
            {guidance.action && guidance.actionLabel && (
              <button
                className="text-button error-action"
                onClick={() => guidance.action && handleErrorAction(guidance.action)}
              >
                {guidance.actionLabel}
              </button>
            )}
          </div>
        )}
      </main>
      {targets.length > 0 && (
        <ActionFooter
          phase={phase}
          changed={stats.changed}
          appliedCount={appliedCount}
          blockedReason={
            sourceDirty
              ? 'Source changed — fetch the new source before applying.'
              : staleKind === 'source'
                ? 'Sheet changed — refresh the review before applying.'
                : staleKind === 'figma'
                  ? 'Figma changed — refresh the review before applying.'
                  : undefined
          }
          disabled={phase !== 'review' || reviewLocked}
          onApply={handleApply}
          onNewPreview={handleNewPreview}
        />
      )}
    </div>
  );
}
