import { useEffect, useMemo, useRef, useState } from 'react';
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
import { computePairing, type PairingTarget } from '@ux-copy-sync/domain';
import { CopyCard } from './CopyCard';
import { TargetSlot } from './TargetSlot';

export type ExcludedSheetValue = {
  replacement: SheetValue;
  originalIndex: number;
  excludedOrder: number;
};

export function PairingList({
  targets,
  replacements,
  excluded,
  disabled,
  onToggle,
  onMove,
  onLocate,
  onExclude,
  onRestore,
  onPreviewTarget,
  previewEnabled,
}: {
  targets: PairingTarget[];
  replacements: SheetValue[];
  excluded: ExcludedSheetValue[];
  disabled: boolean;
  onToggle: (layerId: string) => void;
  onMove: (replacementId: string, targetIndex: number) => void;
  onLocate: (layerId: string) => void;
  onExclude: (replacementId: string) => void;
  onRestore: (replacementId: string) => void;
  onPreviewTarget: (layerId: string | null) => void;
  previewEnabled: boolean;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const pairing = useMemo(() => computePairing(targets, replacements), [targets, replacements]);
  const byTarget = useMemo(
    () => new Map(pairing.active.map(({ target, replacement }) => [target.layerId, replacement])),
    [pairing],
  );
  const activeIndex = useMemo(
    () =>
      new Map(
        targets.filter((target) => target.included).map((target, index) => [target.layerId, index]),
      ),
    [targets],
  );
  const replacementIndex = useMemo(
    () => new Map(replacements.map((replacement, index) => [replacement.id, index])),
    [replacements],
  );
  const [activeReplacementId, setActiveReplacementId] = useState<string | undefined>();
  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null);
  const hoveredLayerId = useRef<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const previousExcludedIds = useRef(new Set(excluded.map(({ replacement }) => replacement.id)));
  const activeReplacement = useMemo(
    () => replacements.find((replacement) => replacement.id === activeReplacementId),
    [activeReplacementId, replacements],
  );
  const effectivePreviewLayerId = previewEnabled && activeReplacementId ? dragOverLayerId : null;

  useEffect(() => {
    onPreviewTarget(effectivePreviewLayerId);
  }, [effectivePreviewLayerId, onPreviewTarget]);

  useEffect(() => () => onPreviewTarget(null), [onPreviewTarget]);

  useEffect(() => {
    const currentIds = new Set(excluded.map(({ replacement }) => replacement.id));
    const added = [...currentIds].find((id) => !previousExcludedIds.current.has(id));
    const restoredIds = [...previousExcludedIds.current].filter((id) => !currentIds.has(id));
    const restored = restoredIds.length === 1 ? restoredIds[0] : undefined;
    if (added) sectionRef.current?.querySelector<HTMLElement>('.excluded-section summary')?.focus();
    else if (restored) {
      const cards = sectionRef.current?.querySelectorAll<HTMLElement>('[data-replacement-id]');
      const card = Array.from(cards ?? []).find(
        (element) => element.dataset.replacementId === restored,
      );
      card?.querySelector<HTMLButtonElement>('.drag-handle')?.focus();
    }
    previousExcludedIds.current = currentIds;
  }, [excluded]);

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
    <section className="section review-section" aria-label="Review pairing" ref={sectionRef}>
      <div className="section-title review-title">REVIEW COPY</div>
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
        <div className="pairing-table" role="table" aria-label="Figma copy and Sheet copy">
          <div className="pairing-header pairing-columns" role="row">
            <span aria-hidden="true" />
            <span role="columnheader">Current / Figma</span>
            <span role="columnheader">New / Sheet</span>
          </div>
          <p className="pairing-hint" data-testid="pairing-preview-hint">
            Hover or focus current copy to highlight it on canvas. Use the subtle handle or buttons
            to move Sheet copy between destinations.
          </p>
          <div className="pairing-list" role="rowgroup">
            {targets.map((target, index) => {
              const replacement = byTarget.get(target.layerId);
              const position = replacement ? replacementIndex.get(replacement.id) : undefined;
              return (
                <TargetSlot
                  key={target.layerId}
                  index={index}
                  target={target}
                  replacement={replacement}
                  disabled={disabled}
                  onToggle={() => onToggle(target.layerId)}
                  onLocate={() => onLocate(target.layerId)}
                  onExclude={onExclude}
                  onPreviewEnter={() => {
                    hoveredLayerId.current = target.layerId;
                    if (!activeReplacementId && previewEnabled) onPreviewTarget(target.layerId);
                  }}
                  onPreviewLeave={() => {
                    if (hoveredLayerId.current === target.layerId) hoveredLayerId.current = null;
                    if (!activeReplacementId && previewEnabled) onPreviewTarget(null);
                  }}
                  onPreviewFocus={() => {
                    hoveredLayerId.current = target.layerId;
                    if (!activeReplacementId && previewEnabled) onPreviewTarget(target.layerId);
                  }}
                  onPreviewBlur={() => {
                    if (hoveredLayerId.current === target.layerId) hoveredLayerId.current = null;
                    if (!activeReplacementId && previewEnabled) onPreviewTarget(null);
                  }}
                  isCanvasPreviewed={effectivePreviewLayerId === target.layerId}
                  canMoveUp={position !== undefined && position > 0}
                  canMoveDown={position !== undefined && position < replacements.length - 1}
                  onMove={(id, delta) => {
                    const current = replacementIndex.get(id);
                    if (current !== undefined) onMove(id, current + delta);
                  }}
                />
              );
            })}
          </div>
        </div>
        {pairing.unassigned.length > 0 && (
          <div className="unassigned">
            <div className="copy-label">
              UNASSIGNED SHEET VALUES <span>{pairing.unassigned.length}</span>
            </div>
            <p className="metadata">Not applied unless reassigned.</p>
            <div className="unassigned-list">
              {pairing.unassigned.map((replacement) => {
                const position = replacementIndex.get(replacement.id);
                return (
                  <CopyCard
                    key={replacement.id}
                    replacement={replacement}
                    disabled={disabled}
                    canMoveUp={position !== undefined && position > 0}
                    canMoveDown={position !== undefined && position < replacements.length - 1}
                    onMove={(delta) => {
                      if (position !== undefined) onMove(replacement.id, position + delta);
                    }}
                    onExclude={() => onExclude(replacement.id)}
                  />
                );
              })}
            </div>
          </div>
        )}
        {excluded.length > 0 && (
          <details className="excluded-section">
            <summary>
              Excluded Sheet values <span>{excluded.length}</span>
            </summary>
            <p className="metadata">Excluded values are not paired or applied.</p>
            <div className="excluded-list">
              {excluded.map(({ replacement }) => (
                <CopyCard
                  key={replacement.id}
                  replacement={replacement}
                  disabled={disabled}
                  onMove={() => undefined}
                  onRestore={() => onRestore(replacement.id)}
                />
              ))}
            </div>
          </details>
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
