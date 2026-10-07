import type { DraftRow, LayerDecision, LayerInfo } from '@string-binder/contracts';
import { prefillSequence, type PrefillResult, type SequenceSource } from '@string-binder/domain';

export type RowStatus = 'include' | 'skip' | 'flag';

export type RowState = {
  status: RowStatus;
  /** Writer's pick for this layer; overrides the existing binding. */
  pick: string | null;
  /** Writer asked to remove the existing binding. */
  unbind: boolean;
  shift: number;
  /** New, edited or variant copy the writer is drafting for this layer; saved on apply. */
  compose?: DraftRow | null;
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
  return { status, pick: null, unbind: false, shift: 0, compose: null };
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
        // Drafted copy is new to the legacy order, so it takes no slot in the sequence.
        excluded: state.status !== 'include' || !!state.compose,
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

/**
 * Decisions for rows that use existing copy. Drafted rows are saved and bound
 * separately. `bindKey` maps a picked key to the key Apply should bind; a row
 * whose pick is the same identity as its current binding keeps that binding.
 */
export function decisionsFor(
  rows: readonly ResolvedRow[],
  bindKey: (key: string, boundKey: string | null) => string = (key) => key,
): LayerDecision[] {
  const decisions: LayerDecision[] = [];
  for (const { layer, state, key: picked } of rows) {
    if (state.compose && state.status === 'include') continue;
    const layerId = layer.id;
    const key = picked ? bindKey(picked, layer.boundKey) : null;
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
