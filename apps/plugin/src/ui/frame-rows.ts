import type { LayerDecision, LayerInfo, SelectionInfo } from '@string-binder/contracts';
import { prefillSequence, type PrefillResult, type SequenceSource } from '@string-binder/domain';
import { useCallback, useMemo, useState } from 'react';

export type RowStatus = 'include' | 'skip' | 'flag';

export type RowState = {
  status: RowStatus;
  /** Writer's pick for this layer; overrides the existing binding. */
  pick: string | null;
  /** Writer asked to remove the existing binding. */
  unbind: boolean;
  shift: number;
};

export type RowSource = 'existing' | 'picked' | 'sequence' | 'none';

export type ResolvedRow = {
  layer: LayerInfo;
  state: RowState;
  key: string | null;
  source: RowSource;
};

export function initialRowState(layer: LayerInfo): RowState {
  const status: RowStatus =
    layer.stored === 'skip'
      ? 'skip'
      : layer.stored === 'needs-new'
        ? 'flag'
        : layer.stored === 'include' || layer.boundKey || !layer.autoSkipReason
          ? 'include'
          : 'skip';
  return { status, pick: null, unbind: false, shift: 0 };
}

function anchorOf(layer: LayerInfo, state: RowState): string | null {
  return state.pick ?? (state.unbind ? null : layer.boundKey);
}

export function resolveRows(
  layers: readonly LayerInfo[],
  states: ReadonlyMap<string, RowState>,
  sequences: SequenceSource,
): ResolvedRow[] {
  const prefill = prefillSequence(
    layers.map((layer) => {
      const state = states.get(layer.id) ?? initialRowState(layer);
      return {
        id: layer.id,
        excluded: state.status !== 'include',
        anchorKey: anchorOf(layer, state),
        shift: state.shift,
      };
    }),
    sequences,
  );
  return layers.map((layer) => {
    const state = states.get(layer.id) ?? initialRowState(layer);
    const result: PrefillResult | null = prefill.get(layer.id) ?? null;
    const source: RowSource = !result
      ? 'none'
      : result.source === 'sequence'
        ? 'sequence'
        : state.pick
          ? 'picked'
          : 'existing';
    return { layer, state, key: result?.key ?? null, source };
  });
}

export function decisionsFor(rows: readonly ResolvedRow[]): LayerDecision[] {
  const decisions: LayerDecision[] = [];
  for (const { layer, state, key } of rows) {
    const layerId = layer.id;
    // Skips are always sent: they also get copied to matching layers on the page.
    if (state.status === 'skip') decisions.push({ layerId, action: 'skip' });
    else if (state.status === 'flag') decisions.push({ layerId, action: 'flag' });
    else if (key) {
      // Sent even when unchanged: bound layers are what gets copied to duplicates.
      decisions.push({ layerId, action: 'bind', key });
    } else if (layer.boundKey && state.unbind) {
      decisions.push({ layerId, action: 'unbind' });
    } else if (layer.stored || layer.autoSkipReason) {
      // Remember that the writer unskipped or unflagged this layer.
      decisions.push({ layerId, action: 'include' });
    }
  }
  return decisions;
}

export function useFrameRows(selection: SelectionInfo | null, sequences: SequenceSource) {
  const [states, setStates] = useState(() => new Map<string, RowState>());

  // A different frame (or a re-read after apply) starts from what is stored on the layers.
  const layersKey = selection
    ? `${selection.frameId}:${selection.layers.map((layer) => `${layer.id}=${layer.boundKey ?? ''}/${layer.stored ?? ''}`).join(',')}`
    : '';
  const [seenKey, setSeenKey] = useState(layersKey);
  if (seenKey !== layersKey) {
    setSeenKey(layersKey);
    setStates(new Map());
  }

  const rows = useMemo(
    () => (selection ? resolveRows(selection.layers, states, sequences) : []),
    [selection, states, sequences],
  );

  const update = useCallback(
    (layerId: string, change: (state: RowState) => RowState) => {
      setStates((current) => {
        const layer = selection?.layers.find((item) => item.id === layerId);
        if (!layer) return current;
        const next = new Map(current);
        next.set(layerId, change(current.get(layerId) ?? initialRowState(layer)));
        return next;
      });
    },
    [selection],
  );

  /** Picking restarts the sequence here, so nudges further down no longer apply. */
  const pick = useCallback(
    (layerId: string, key: string) => {
      setStates((current) => {
        if (!selection) return current;
        const next = new Map(current);
        const index = selection.layers.findIndex((layer) => layer.id === layerId);
        for (let i = index; i >= 0 && i < selection.layers.length; i += 1) {
          const layer = selection.layers[i]!;
          const state = next.get(layer.id) ?? initialRowState(layer);
          if (i === index) {
            next.set(layer.id, { ...state, status: 'include', pick: key, unbind: false, shift: 0 });
            continue;
          }
          if (anchorOf(layer, state)) break;
          if (state.shift) next.set(layer.id, { ...state, shift: 0 });
        }
        return next;
      });
    },
    [selection],
  );

  const reset = useCallback(() => setStates(new Map()), []);

  return { rows, update, pick, reset, dirty: states.size > 0 };
}
