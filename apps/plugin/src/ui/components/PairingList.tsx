import { useEffect, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { SheetValue } from '@ux-copy-sync/contracts';
import { computePairing, pairingStats, type PairingTarget } from '@ux-copy-sync/domain';
import { CopyCard } from './CopyCard';
import { TargetSlot } from './TargetSlot';

export function PairingList({
  targets,
  activeCandidates,
  excludedCandidates,
  disabled,
  onToggle,
  onMove,
  onExclude,
  onRestore,
  onRestoreAt,
  onLocate,
  onPreviewTarget,
  previewEnabled,
}: {
  targets: PairingTarget[];
  activeCandidates: SheetValue[];
  excludedCandidates: SheetValue[];
  disabled: boolean;
  onToggle: (layerId: string) => void;
  onMove: (replacementId: string, targetIndex: number) => void;
  onExclude: (replacementId: string) => void;
  onRestore: (replacementId: string) => void;
  onRestoreAt: (replacementId: string, targetIndex: number) => void;
  onLocate: (layerId: string) => void;
  onPreviewTarget: (layerId: string | null) => void;
  previewEnabled: boolean;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const pairing = computePairing(targets, activeCandidates);
  const byTarget = new Map(
    pairing.active.map(({ target, replacement }) => [target.layerId, replacement]),
  );
  const activeIndex = new Map(
    targets.filter((target) => target.included).map((target, index) => [target.layerId, index]),
  );
  const stats = pairingStats(targets, activeCandidates);
  const [activeReplacementId, setActiveReplacementId] = useState<string | undefined>();
  const [hoveredLayerId, setHoveredLayerId] = useState<string | null>(null);
  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null);
  const [excludedOpen, setExcludedOpen] = useState(true);
  const activeReplacement = [...activeCandidates, ...excludedCandidates].find(
    (replacement) => replacement.id === activeReplacementId,
  );
  const activeReplacementIsExcluded = Boolean(
    activeReplacement && excludedCandidates.some((candidate) => candidate.id === activeReplacement.id),
  );
  const effectivePreviewLayerId = previewEnabled ? (dragOverLayerId ?? hoveredLayerId) : null;

  useEffect(() => {
    onPreviewTarget(effectivePreviewLayerId);
  }, [effectivePreviewLayerId, onPreviewTarget]);

  useEffect(() => () => onPreviewTarget(null), [onPreviewTarget]);

  const handleDragEnd = (event: DragEndEvent) => {
    const over = event.over?.id.toString();
    const replacementId = event.active.id.toString();
    if (over?.startsWith('slot:')) {
      const targetIndex = activeIndex.get(over.slice(5));
      if (targetIndex !== undefined) {
        if (activeReplacementIsExcluded) onRestoreAt(replacementId, targetIndex);
        else onMove(replacementId, targetIndex);
      }
    }
    setActiveReplacementId(undefined);
    setDragOverLayerId(null);
  };

  return (
    <section className="section review-section" aria-label="Review pairing">
      <div className="section-title review-title">
        <span>REVIEW</span>
        <span className="review-count">
          {stats.changed} change{stats.changed === 1 ? '' : 's'}
          {stats.alreadySynced ? ` · ${stats.alreadySynced} synced` : ''}
          {stats.skipped ? ` · ${stats.skipped} kept` : ''}
          {excludedCandidates.length ? ` · ${excludedCandidates.length} excluded` : ''}
        </span>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={({ active }) => {
          setActiveReplacementId(active.id.toString());
          setDragOverLayerId(null);
        }}
        onDragOver={({ over }) => {
          const id = over?.id.toString();
          const layerId = id?.startsWith('slot:') ? id.slice(5) : null;
          setDragOverLayerId((current) => (current === layerId ? current : layerId));
        }}
        onDragCancel={() => {
          setActiveReplacementId(undefined);
          setDragOverLayerId(null);
        }}
        onDragEnd={handleDragEnd}
      >
        <div className="pairing-header pairing-columns" role="row">
          <span />
          <span role="columnheader">CURRENT IN FIGMA</span>
          <span role="columnheader">FROM SHEET</span>
        </div>
        <p className="pairing-hint" data-testid="pairing-preview-hint">
          Hover current copy to preview · drag Sheet copy to a destination
        </p>
        <div className="pairing-list">
          {targets.map((target, index) => (
            <TargetSlot
              key={target.layerId}
              index={index}
              target={target}
              replacement={byTarget.get(target.layerId)}
              disabled={disabled}
              onToggle={() => onToggle(target.layerId)}
              onLocate={() => onLocate(target.layerId)}
              onPreviewEnter={() => setHoveredLayerId(target.layerId)}
              onPreviewLeave={() =>
                setHoveredLayerId((current) => (current === target.layerId ? null : current))
              }
              onPreviewFocus={() => setHoveredLayerId(target.layerId)}
              onPreviewBlur={() =>
                setHoveredLayerId((current) => (current === target.layerId ? null : current))
              }
              isCanvasPreviewed={effectivePreviewLayerId === target.layerId}
              canMoveUp={Boolean(
                byTarget.get(target.layerId) &&
                  activeCandidates.findIndex(
                    (replacement) => replacement.id === byTarget.get(target.layerId)!.id,
                ) > 0,
              )}
              canMoveDown={Boolean(
                byTarget.get(target.layerId) &&
                activeCandidates.findIndex(
                  (replacement) => replacement.id === byTarget.get(target.layerId)!.id,
                ) <
                  activeCandidates.length - 1,
              )}
              onMove={(id, delta) => {
                const current = activeCandidates.findIndex((replacement) => replacement.id === id);
                if (current >= 0) onMove(id, current + delta);
              }}
              onExclude={() => {
                const replacement = byTarget.get(target.layerId);
                if (replacement) onExclude(replacement.id);
              }}
            />
          ))}
        </div>
        {pairing.unassigned.length > 0 && (
          <div className="unassigned">
            <div className="copy-label">
              UNASSIGNED <span>{pairing.unassigned.length}</span>
            </div>
            <p className="metadata">Drag to a destination or exclude.</p>
            <div className="unassigned-list">
              {pairing.unassigned.map((replacement) => (
                <CopyCard
                  key={replacement.id}
                  replacement={replacement}
                  disabled={disabled}
                  canMoveUp={activeCandidates.findIndex((item) => item.id === replacement.id) > 0}
                  canMoveDown={
                    activeCandidates.findIndex((item) => item.id === replacement.id) <
                    activeCandidates.length - 1
                  }
                  onExclude={() => onExclude(replacement.id)}
                  onMove={(delta) => {
                    const current = activeCandidates.findIndex((item) => item.id === replacement.id);
                    if (current >= 0) onMove(replacement.id, current + delta);
                  }}
                />
              ))}
            </div>
          </div>
        )}
        {excludedCandidates.length > 0 && (
          <details
            className="excluded-tray"
            open={excludedOpen}
            onToggle={(event) => setExcludedOpen(event.currentTarget.open)}
          >
            <summary className="copy-label">
              EXCLUDED FROM APPLY <span>{excludedCandidates.length}</span>
            </summary>
            <p className="metadata">These Sheet rows will not be applied.</p>
            <div className="excluded-list">
              {excludedCandidates.map((replacement) => (
                <CopyCard
                  key={replacement.id}
                  replacement={replacement}
                  variant="excluded"
                  disabled={disabled}
                  onRestore={() => onRestore(replacement.id)}
                  onMove={() => undefined}
                />
              ))}
            </div>
          </details>
        )}
        <DragOverlay dropAnimation={null}>
          {activeReplacement ? (
            <CopyCard
              replacement={activeReplacement}
              variant={activeReplacementIsExcluded ? 'excluded' : 'active'}
              disabled
              dragOverlay
              onMove={() => undefined}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </section>
  );
}
