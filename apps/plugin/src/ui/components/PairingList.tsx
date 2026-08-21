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
  replacements,
  disabled,
  onToggle,
  onMove,
  onLocate,
  onPreviewTarget,
  previewEnabled,
}: {
  targets: PairingTarget[];
  replacements: SheetValue[];
  disabled: boolean;
  onToggle: (layerId: string) => void;
  onMove: (replacementId: string, targetIndex: number) => void;
  onLocate: (layerId: string) => void;
  onPreviewTarget: (layerId: string | null) => void;
  previewEnabled: boolean;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const pairing = computePairing(targets, replacements);
  const byTarget = new Map(
    pairing.active.map(({ target, replacement }) => [target.layerId, replacement]),
  );
  const activeIndex = new Map(
    targets.filter((target) => target.included).map((target, index) => [target.layerId, index]),
  );
  const stats = pairingStats(targets, replacements);
  const [activeReplacementId, setActiveReplacementId] = useState<string | undefined>();
  const [hoveredLayerId, setHoveredLayerId] = useState<string | null>(null);
  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null);
  const activeReplacement = replacements.find(
    (replacement) => replacement.id === activeReplacementId,
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
      if (targetIndex !== undefined) onMove(replacementId, targetIndex);
    }
    setActiveReplacementId(undefined);
    setDragOverLayerId(null);
  };

  return (
    <section className="section review-section" aria-label="Review pairing">
      <div className="section-title review-title">
        <span>
          <span className="step">3</span>REVIEW PAIRING
        </span>
        <span className="review-count">
          {stats.changed} changes
          {stats.alreadySynced ? ` · ${stats.alreadySynced} synced` : ''}
          {stats.skipped ? ` · ${stats.skipped} skipped` : ''}
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
          Hover current copy to highlight it on canvas. Drag over a destination to preview where
          Sheet copy will land.
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
                replacements.findIndex(
                  (replacement) => replacement.id === byTarget.get(target.layerId)!.id,
                ) > 0,
              )}
              canMoveDown={Boolean(
                byTarget.get(target.layerId) &&
                replacements.findIndex(
                  (replacement) => replacement.id === byTarget.get(target.layerId)!.id,
                ) <
                  replacements.length - 1,
              )}
              onMove={(id, delta) => {
                const current = replacements.findIndex((replacement) => replacement.id === id);
                if (current >= 0) onMove(id, current + delta);
              }}
            />
          ))}
        </div>
        {pairing.unassigned.length > 0 && (
          <div className="unassigned">
            <div className="copy-label">
              UNASSIGNED COPY <span>{pairing.unassigned.length}</span>
            </div>
            <p className="metadata">Not applied unless reassigned.</p>
            <div className="unassigned-list">
              {pairing.unassigned.map((replacement) => (
                <CopyCard
                  key={replacement.id}
                  replacement={replacement}
                  disabled={disabled}
                  canMoveUp={replacements.findIndex((item) => item.id === replacement.id) > 0}
                  canMoveDown={
                    replacements.findIndex((item) => item.id === replacement.id) <
                    replacements.length - 1
                  }
                  onMove={(delta) => {
                    const current = replacements.findIndex((item) => item.id === replacement.id);
                    if (current >= 0) onMove(replacement.id, current + delta);
                  }}
                />
              ))}
            </div>
          </div>
        )}
        <DragOverlay dropAnimation={null}>
          {activeReplacement ? (
            <CopyCard
              replacement={activeReplacement}
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
