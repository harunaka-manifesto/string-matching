import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  sortableKeyboardCoordinates,
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
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
}: {
  targets: PairingTarget[];
  replacements: SheetValue[];
  disabled: boolean;
  onToggle: (layerId: string) => void;
  onMove: (replacementId: string, targetIndex: number) => void;
  onLocate: (layerId: string) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
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
  const handleDragEnd = (event: DragEndEvent) => {
    const over = event.over?.id.toString();
    if (!over) return;
    const replacementId = event.active.id.toString();
    const targetIndex = over.startsWith('slot:')
      ? activeIndex.get(over.slice(5))
      : replacements.findIndex((replacement) => replacement.id === over);
    if (targetIndex !== undefined && targetIndex >= 0) onMove(replacementId, targetIndex);
  };
  return (
    <section className="section review-section">
      <div className="section-title review-title">
        <span>
          <span className="step">3</span>REVIEW PAIRING
        </span>
        <span className="review-count">
          {stats.changed} changes · {stats.alreadySynced} already synced
          {stats.skipped ? ` · ${stats.skipped} skipped` : ''}
        </span>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={replacements.map((replacement) => replacement.id)}
          strategy={verticalListSortingStrategy}
        >
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
              <div className="copy-label">UNASSIGNED SHEET COPY</div>
              <p className="metadata">
                These cards are not written to Figma. Drag one back into the source order if needed.
              </p>
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
          )}
        </SortableContext>
      </DndContext>
    </section>
  );
}
