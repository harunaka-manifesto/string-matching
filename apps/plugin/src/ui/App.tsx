import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PluginToUiMessageSchema,
  parseSheetCellUrl,
  type SheetSource as SheetSourceModel,
  type SheetValue,
  type User,
} from '@ux-copy-sync/contracts';
import {
  moveReplacement,
  pairingStats,
  reviewedPairs,
  type PairingTarget,
} from '@ux-copy-sync/domain';
import { AuthGate } from './components/AuthGate';
import { SelectionCard, type SelectionCardValue } from './components/SelectionCard';
import { SheetSource } from './components/SheetSource';
import { PairingList } from './components/PairingList';
import { ActionFooter } from './components/ActionFooter';
import type { UiBridge } from './bridge';
import type { AppPhase, AuthState } from './state/model';
import './styles.css';

function requestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function App({ bridge }: { bridge: UiBridge }) {
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [enabledPublicTestMode, setEnabledPublicTestMode] = useState(false);
  const [user, setUser] = useState<User | undefined>();
  const [selection, setSelection] = useState<SelectionCardValue>(null);
  const [pinnedSelection, setPinnedSelection] = useState<SelectionCardValue>(null);
  const [cellUrl, setCellUrl] = useState('');
  const [parsedUrl, setParsedUrl] = useState<ReturnType<typeof parseSheetCellUrl> | null>(null);
  const [urlError, setUrlError] = useState<string | undefined>();
  const [phase, setPhase] = useState<AppPhase>('idle');
  const [previewToken, setPreviewToken] = useState<string | undefined>();
  const [previewSource, setPreviewSource] = useState<SheetSourceModel | undefined>();
  const [targets, setTargets] = useState<PairingTarget[]>([]);
  const [replacements, setReplacements] = useState<SheetValue[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [staleKind, setStaleKind] = useState<'figma' | 'source' | undefined>();
  const [appliedCount, setAppliedCount] = useState(0);
  const pollTimer = useRef<number | undefined>();
  const pollInFlight = useRef(false);
  const fetchId = useRef<string | undefined>();
  const phaseRef = useRef(phase);
  const previewTokenRef = useRef(previewToken);
  phaseRef.current = phase;
  previewTokenRef.current = previewToken;

  const stopPolling = () => {
    pollInFlight.current = false;
    if (pollTimer.current !== undefined) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = undefined;
    }
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
            fetchId.current = undefined;
            setPhase('idle');
            setPreviewToken(undefined);
            setPreviewSource(undefined);
            setTargets([]);
            setReplacements([]);
            setStaleKind(undefined);
            setError(undefined);
          }
          if (next.authenticated || next.mode === 'public-test')
            send({ type: 'get-selection-state' });
          break;
        case 'auth-started':
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
          if (next.status === 'failed') {
            stopPolling();
            setAuthState('required');
            setError(next.error?.message);
          }
          break;
        case 'auth-cancelled':
          stopPolling();
          setAuthState('required');
          break;
        case 'selection-state':
          setSelection(next.selection);
          if (phaseRef.current === 'idle') setPinnedSelection(next.selection);
          break;
        case 'preview-ready':
          if (fetchId.current !== next.requestId) break;
          previewTokenRef.current = next.previewToken;
          setPreviewToken(next.previewToken);
          setPinnedSelection(next.selection);
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
          setPhase('review');
          setStaleKind(undefined);
          setError(undefined);
          break;
        case 'preview-stale':
          if (next.previewToken === previewTokenRef.current) {
            setPhase('stale');
            setStaleKind(next.kind);
            setError(next.reason);
          }
          break;
        case 'apply-reviewed-pairs-result':
          if (next.previewToken !== previewTokenRef.current) break;
          if (next.ok && next.result) {
            setAppliedCount(next.result.appliedCount);
            setPhase('applied');
            setError(undefined);
          } else if (next.error?.code === 'SOURCE_STALE') {
            setPhase('stale');
            setStaleKind('source');
            setError(next.error.message);
          } else if (next.error?.code === 'PREVIEW_STALE') {
            setPhase('stale');
            setStaleKind('figma');
            setError(next.error.message);
          } else {
            setPhase('review');
            setError(next.error?.message ?? 'The changes could not be applied.');
          }
          break;
        case 'error':
          if (!next.requestId || next.requestId === fetchId.current) {
            setPhase((current) => (current === 'fetching' ? 'idle' : current));
            setError(next.error.message);
          }
          break;
      }
    });
    send({ type: 'auth:check' });
    return () => {
      unsubscribe();
      stopPolling();
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
  const stats = pairingStats(targets, replacements);
  const reviewLocked =
    phase === 'fetching' ||
    phase === 'applying' ||
    phase === 'applied' ||
    phase === 'stale' ||
    sourceDirty;

  const handleUrlChange = (value: string) => {
    if (phase === 'fetching') {
      fetchId.current = undefined;
      setPhase('idle');
    }
    setCellUrl(value);
    if (!value.trim()) {
      setParsedUrl(null);
      setUrlError(undefined);
      return;
    }
    try {
      setParsedUrl(parseSheetCellUrl(value));
      setUrlError(undefined);
    } catch (cause) {
      setParsedUrl(null);
      setUrlError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const handleFetch = () => {
    if (!localParsed || !selection) return;
    const id = requestId();
    fetchId.current = id;
    setPhase('fetching');
    setError(undefined);
    setStaleKind(undefined);
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
    setPhase('applying');
    setError(undefined);
    send({
      type: 'apply-reviewed-pairs',
      payload: { previewToken, pairs: reviewedPairs(targets, replacements) },
    });
  };
  const handleNewPreview = () => {
    if (previewToken) send({ type: 'discard-preview', payload: { previewToken } });
    setPhase('idle');
    setPreviewToken(undefined);
    setPreviewSource(undefined);
    setTargets([]);
    setReplacements([]);
    setError(undefined);
    setStaleKind(undefined);
    send({ type: 'get-selection-state' });
  };
  const handleToggle = (layerId: string) =>
    setTargets((current) =>
      current.map((target) =>
        target.layerId === layerId ? { ...target, included: !target.included } : target,
      ),
    );
  const handleMove = (id: string, index: number) =>
    setReplacements((current) => moveReplacement(current, id, index));
  const handleLocate = (layerId: string) => {
    if (previewToken) send({ type: 'select-node', payload: { previewToken, layerId } });
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
        error={error}
        onConnect={() => {
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
      <header className="app-header">
        <div>
          <h1 className="app-title">UX Copy Sync</h1>
          <p className="app-subtitle">Review approved copy before changing the design.</p>
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
        <SelectionCard
          selection={
            phase === 'review' || phase === 'stale' || phase === 'applying' || phase === 'applied'
              ? pinnedSelection
              : selection
          }
        />
        <SheetSource
          value={cellUrl}
          parsed={localParsed}
          disabled={phase === 'fetching' || phase === 'applying'}
          error={urlError}
          onChange={handleUrlChange}
          onFetch={handleFetch}
        />
        {previewSource && (
          <div className="source-provenance">
            {previewSource.spreadsheetTitle ?? 'Google Sheet'} · {previewSource.sheetTitle} ·
            starting {previewSource.startCell}
            <br />
            {replacements.length} non-empty string{replacements.length === 1 ? '' : 's'} found
            {replacements.length < targets.length
              ? ` · ${targets.length - replacements.length} layer${targets.length - replacements.length === 1 ? '' : 's'} will remain unchanged`
              : ''}
          </div>
        )}
        {sourceDirty && (
          <div className="notice" role="status">
            The Sheet link changed after this review. Fetch again before applying.
          </div>
        )}
        {staleKind && (
          <div className="notice" role="status">
            {staleKind === 'source'
              ? 'The Sheet copy changed after this review. Refresh before applying.'
              : 'The design changed after this review. Refresh before applying.'}
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
          />
        )}
        {error && phase !== 'stale' && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </main>
      {targets.length > 0 && (
        <ActionFooter
          phase={phase}
          changed={stats.changed}
          appliedCount={appliedCount}
          disabled={phase !== 'review' || reviewLocked || stats.changed === 0}
          onApply={handleApply}
          onNewPreview={handleNewPreview}
        />
      )}
    </div>
  );
}
