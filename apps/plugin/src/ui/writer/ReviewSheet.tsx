import type {
  ApplyPreview,
  BindingTarget,
  Catalog,
  CopyRecord,
  DraftRow,
  LayerDecision,
  SelectionInfo,
} from '@string-binder/contracts';
import { productLabel } from '@string-binder/domain';
import { useEffect, useRef } from 'react';
import type { StringEntry } from '../string-index';
import { Icon } from '../components/Icon';
import { keyPreview } from './model';

export type CommitPlan = {
  frameId: string;
  frameName: string;
  decisions: LayerDecision[];
  saves: DraftRow[];
  applyPreview: ApplyPreview | null;
  delivery: {
    targets: BindingTarget[];
    conflicts: { nodeId: string; frameName: string }[];
    usages?: Record<string, number>;
  } | null;
};

export type RevisionConflict = { copyId: string; actualRecord?: CopyRecord };

const ACTION: Record<DraftRow['action'], string> = {
  create: 'New',
  edit: 'Edited everywhere',
  variant: 'Variant',
  reuse: 'Restore',
  keep: '',
};

/** Page duplicates either commit path would change, with a stable id for keep/drop toggles. */
export function duplicateTargets(plan: CommitPlan) {
  const fromSaves = (plan.delivery?.targets ?? [])
    .filter((t) => t.duplicate)
    .map((t) => ({ id: `save:${t.nodeId}`, frameName: t.frameName, layerName: t.layerName }));
  const fromBinds = (plan.applyPreview?.targets ?? [])
    .filter((t) => t.change !== 'none')
    .map((t) => ({ id: `bind:${t.nodeId}`, frameName: t.frameName, layerName: t.layerName }));
  return [...fromSaves, ...fromBinds];
}

/** Drops the page duplicates the writer chose to keep as they are. */
export function withoutTargets(plan: CommitPlan, dropped: ReadonlySet<string>): CommitPlan {
  return {
    ...plan,
    delivery: plan.delivery && {
      ...plan.delivery,
      targets: plan.delivery.targets.filter((t) => !dropped.has(`save:${t.nodeId}`)),
    },
    applyPreview: plan.applyPreview && {
      ...plan.applyPreview,
      targets: plan.applyPreview.targets.filter((t) => !dropped.has(`bind:${t.nodeId}`)),
    },
  };
}

export function ReviewSheet(props: {
  plan: CommitPlan;
  selection: SelectionInfo;
  catalog: Catalog;
  entries: ReadonlyMap<string, StringEntry>;
  dropped: ReadonlySet<string>;
  conflicts: readonly RevisionConflict[];
  busy: string;
  onToggle: (id: string) => void;
  onResolve: (conflict: RevisionConflict, choice: 'theirs' | 'revise' | 'variant') => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { plan, selection, catalog } = props;
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => confirm.current?.focus(), []);
  const layerName = (id: string) => selection.layers.find((l) => l.id === id)?.name ?? 'Layer';
  const binds = plan.decisions.filter(
    (d): d is Extract<LayerDecision, { action: 'bind' }> =>
      d.action === 'bind' &&
      props.entries.get(d.key) !==
        props.entries.get(selection.layers.find((l) => l.id === d.layerId)?.boundKey ?? ''),
  );
  const unbinds = plan.decisions.filter((d) => d.action === 'unbind').length;
  const duplicates = duplicateTargets(plan);

  return (
    <div className="scrim" onClick={props.busy ? undefined : props.onClose}>
      <section
        className="sheet review"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape' && !props.busy) props.onClose();
        }}
      >
        <header className="sheet__head">
          <div>
            <h2 id="review-title">Review and apply</h2>
            <p className="sheet__sub" title={plan.frameName}>
              {plan.frameName}
            </p>
          </div>
        </header>

        <div className="review__body">
          {props.conflicts.length > 0 && (
            <section className="review__group tone--danger">
              <h3>Someone changed this copy since you started</h3>
              {props.conflicts.map((conflict) => (
                <div className="review__item" key={conflict.copyId}>
                  <span className="mono">
                    {conflict.actualRecord?.platformKey ?? conflict.copyId}
                  </span>
                  {conflict.actualRecord && (
                    <>
                      <span className="review__en">{conflict.actualRecord.en}</span>
                      <span className="review__id">{conflict.actualRecord.id}</span>
                    </>
                  )}
                  <span className="review__choices">
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => props.onResolve(conflict, 'theirs')}
                    >
                      Use their wording
                    </button>
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => props.onResolve(conflict, 'revise')}
                    >
                      Edit on top of it
                    </button>
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => props.onResolve(conflict, 'variant')}
                    >
                      Make a variant
                    </button>
                  </span>
                </div>
              ))}
            </section>
          )}

          {plan.saves.length > 0 && (
            <section className="review__group">
              <h3>
                Copy to save <span className="count">{plan.saves.length}</span>
              </h3>
              {plan.saves.map((row) => {
                const usages = plan.delivery?.usages?.[row.copyId];
                const key =
                  row.action === 'edit'
                    ? row.baseline?.platformKey
                    : keyPreview(row, catalog.products);
                return (
                  <div className="review__item" key={row.layerId}>
                    <span className="review__line">
                      <span className="review__layer">{layerName(row.layerId)}</span>
                      <span className={`tag tag--${row.action}`}>{ACTION[row.action]}</span>
                    </span>
                    <span className="review__en">
                      <span className="locale-label">EN</span>
                      {row.en}
                    </span>
                    <span className="review__id">
                      <span className="locale-label">ID</span>
                      {row.id}
                    </span>
                    <span className="review__meta">
                      {[
                        productLabel(row.product),
                        row.context.feature,
                        row.context.screen,
                        row.context.role,
                      ]
                        .filter(Boolean)
                        .join(' › ')}
                    </span>
                    <span className="mono review__key">{key}</span>
                    {row.action === 'edit' && usages !== undefined && (
                      <span className="review__warning">
                        Changes {usages} known use{usages === 1 ? '' : 's'} in this file, and every
                        other file using this copy.
                      </span>
                    )}
                  </div>
                );
              })}
            </section>
          )}

          {binds.length > 0 && (
            <section className="review__group">
              <h3>
                Strings to bind <span className="count">{binds.length}</span>
              </h3>
              {binds.map((decision) => {
                const entry = props.entries.get(decision.key);
                return (
                  <div className="review__item review__item--compact" key={decision.layerId}>
                    <span className="review__layer">{layerName(decision.layerId)}</span>
                    <Icon name="arrow" className="review__arrow" />
                    <span className="review__value">
                      <span className="review__en">{entry?.en || entry?.id || '—'}</span>
                      <span className="mono review__key">
                        {entry?.name.slice(entry.name.lastIndexOf('/') + 1)}
                      </span>
                    </span>
                  </div>
                );
              })}
              {unbinds > 0 && (
                <p className="review__note">
                  {unbinds} layer{unbinds === 1 ? '' : 's'} will be unbound.
                </p>
              )}
            </section>
          )}

          {duplicates.length > 0 && (
            <section className="review__group">
              <h3>
                Matching layers on this page <span className="count">{duplicates.length}</span>
              </h3>
              <p className="review__note">These get the same copy. Uncheck any to leave as is.</p>
              {duplicates.map((target) => (
                <label className="review__check" key={target.id}>
                  <input
                    type="checkbox"
                    checked={!props.dropped.has(target.id)}
                    onChange={() => props.onToggle(target.id)}
                  />
                  <span className="review__frame">{target.frameName}</span>
                  <span className="review__layer">{target.layerName ?? 'Text layer'}</span>
                </label>
              ))}
            </section>
          )}

          {(plan.delivery?.conflicts.length ?? 0) > 0 && (
            <p className="review__note">
              {plan.delivery!.conflicts.length} matching layer
              {plan.delivery!.conflicts.length === 1 ? ' keeps its' : 's keep their'} different
              string.
            </p>
          )}
        </div>

        <footer className="sheet__foot">
          <span className="hint">
            {plan.saves.length ? 'Saves to the registry, then binds in Figma' : 'Binds in Figma'}
          </span>
          <button type="button" className="button button--secondary" onClick={props.onClose}>
            Back
          </button>
          <button
            type="button"
            ref={confirm}
            className={`button button--primary ${props.busy ? 'is-busy' : ''}`}
            disabled={!!props.busy || props.conflicts.length > 0}
            onClick={props.onConfirm}
          >
            {props.busy || (plan.saves.length ? 'Save and apply' : 'Apply')}
          </button>
        </footer>
      </section>
    </div>
  );
}
