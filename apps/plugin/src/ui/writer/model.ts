import type {
  AuthoringDraft,
  CopyRecord,
  DraftRow,
  LayerInfo,
  Locale,
  ProductConfig,
} from '@string-binder/contracts';
import {
  bilingualErrors,
  canonical,
  canvasFingerprint,
  initialRow,
  operationOf,
  proposedKey,
} from '@string-binder/domain';
import { initialRowState, type RowState } from '../frame-rows';
import { registryKey } from '../index-merge';
import { identity } from '../shared';
import { isPlaceholder } from '../components/LayerRow';

export type Pending = NonNullable<AuthoringDraft['pending']>;

/** Starts new copy for a layer, with the canvas text in the frame's canvas language. */
export function composeCreate(
  layer: LayerInfo,
  locale: Locale,
  product: string,
  frameName: string,
  feature = '',
): DraftRow {
  const row = initialRow(layer, locale, product, screenOf(frameName, product), identity());
  // Lorem ipsum is layout filler, not copy worth carrying into a translation.
  const filler = isPlaceholder(layer.characters);
  return {
    ...row,
    action: 'create',
    canvasText: layer.characters,
    en: filler ? '' : row.en,
    id: filler ? '' : row.id,
    context: { ...row.context, feature },
  };
}

/** Frame name without the product it repeats ("Investment – Landing page" → "Landing page"). */
export function screenOf(frameName: string, product: string): string {
  const words = product.split('-').filter(Boolean).join('[\\s_-]+');
  const trimmed = words
    ? frameName.replace(new RegExp(`^\\s*${words}\\b[\\s\\p{P}]*`, 'iu'), '')
    : frameName;
  return trimmed.trim() || frameName.trim();
}

/** Starts a global wording edit of the copy a layer is bound to. Keeps its ID and key. */
export function composeEdit(layer: LayerInfo, record: CopyRecord, locale: Locale): DraftRow {
  return {
    ...initialRow(layer, locale, record.product, '', record.copyId, record),
    action: 'edit',
    canvasText: layer.characters,
  };
}

/** Starts a screen-specific copy forked from a layer's copy, with a new ID and key. */
export function composeVariant(layer: LayerInfo, record: CopyRecord, locale: Locale): DraftRow {
  // initialRow keeps the baseline's ID; a variant is a new identity that only points back to it.
  return {
    ...initialRow(layer, locale, record.product, '', record.copyId, record),
    copyId: identity(),
    action: 'variant',
    canvasText: layer.characters,
  };
}

/**
 * Brings a drafted row's canvas baseline up to date. A rename (Apply names
 * layers after their key) or rebinding is not a change the writer must review;
 * different text is, so that row keeps its old fingerprint and shows a warning.
 */
export function rebaseline(row: DraftRow, layer: LayerInfo): DraftRow {
  const fingerprint = canvasFingerprint(layer);
  if (row.canvasFingerprint === fingerprint) return row;
  if ((row.canvasText ?? null) !== layer.characters) return row;
  return { ...row, canvasFingerprint: fingerprint };
}

export const canvasChanged = (row: DraftRow, layer: LayerInfo) =>
  row.canvasFingerprint !== canvasFingerprint(layer);

/** Problems that block review, in writer language. */
export function composeErrors(row: DraftRow, products: readonly ProductConfig[]): string[] {
  const errors = bilingualErrors(row.en, row.id);
  if ((row.action === 'create' || row.action === 'variant') && !row.product)
    errors.unshift('Choose the product for this page first');
  else if (row.action !== 'edit')
    try {
      proposedKey(row, products);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  return errors;
}

/** Key the row will get. Provisional for new copy: a concurrent save can add a suffix. */
export function keyPreview(row: DraftRow, products: readonly ProductConfig[]): string {
  try {
    return proposedKey(row, products);
  } catch {
    return '';
  }
}

/** Rows drafting the same identity must agree, or the batch would contradict itself. */
export function conflictingEdits(rows: readonly DraftRow[]): boolean {
  const seen = new Map<string, string>();
  for (const row of rows) {
    const op = operationOf(row);
    if (!op) continue;
    const value = canonical(op);
    if (seen.has(op.copyId) && seen.get(op.copyId) !== value) return true;
    seen.set(op.copyId, value);
  }
  return false;
}

const isDefault = (state: RowState, layer: LayerInfo) => {
  const initial = initialRowState(layer);
  return (
    state.status === initial.status &&
    !state.pick &&
    !state.unbind &&
    !state.shift &&
    !state.compose
  );
};

/** What persists for a frame: drafted rows and the writer's other choices. */
export function toDraft(input: {
  frameId: string;
  frameName: string;
  locale: Locale;
  layers: readonly LayerInfo[];
  states: ReadonlyMap<string, RowState>;
  pending?: Pending;
}): AuthoringDraft {
  const rows: DraftRow[] = [];
  const picks: NonNullable<AuthoringDraft['picks']> = {};
  for (const layer of input.layers) {
    const state = input.states.get(layer.id);
    if (!state || isDefault(state, layer)) continue;
    if (state.compose) rows.push(state.compose);
    picks[layer.id] = {
      status: state.status,
      pick: state.pick,
      unbind: state.unbind,
      shift: state.shift,
    };
  }
  return {
    frameId: input.frameId,
    frameName: input.frameName,
    locale: input.locale,
    rows,
    picks,
    ...(input.pending ? { pending: input.pending } : {}),
  };
}

/** Restores row states from a saved draft, including drafts saved by the older Create screen. */
export function fromDraft(
  draft: AuthoringDraft | null,
  layers: readonly LayerInfo[],
): Map<string, RowState> {
  const states = new Map<string, RowState>();
  if (!draft) return states;
  const present = new Set(layers.map((layer) => layer.id));
  for (const [layerId, pick] of Object.entries(draft.picks ?? {}))
    if (present.has(layerId)) states.set(layerId, { ...pick, compose: null });
  for (const row of draft.rows) {
    const layer = layers.find((item) => item.id === row.layerId);
    if (!layer || row.action === 'keep') continue;
    const state = states.get(row.layerId) ?? initialRowState(layer);
    if (row.action === 'reuse' && !row.restoreLocal)
      states.set(row.layerId, {
        ...state,
        status: 'include',
        pick: registryKey(row.copyId),
        compose: null,
      });
    else
      states.set(row.layerId, {
        ...state,
        status: 'include',
        compose: { ...row, canvasText: row.canvasText ?? layer.characters },
      });
  }
  return states;
}
