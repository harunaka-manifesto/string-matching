import type { ReviewedPair, SheetValue } from '@ux-copy-sync/contracts';
import { normalizeLayerName } from './name-normalization';

export type PairingTarget = {
  layerId: string;
  layerName: string;
  originalText: string;
  originalName: string;
  included: boolean;
};

export type PairingResult = {
  active: Array<{ target: PairingTarget; replacement: SheetValue }>;
  unassigned: SheetValue[];
};

export type PairingStats = {
  changed: number;
  alreadySynced: number;
  skipped: number;
  unassigned: number;
};

export function computePairing(
  targets: readonly PairingTarget[],
  replacements: readonly SheetValue[],
): PairingResult {
  const activeTargets = targets.filter((target) => target.included);
  return {
    active: activeTargets.slice(0, replacements.length).map((target, index) => ({
      target,
      replacement: replacements[index]!,
    })),
    unassigned: replacements.slice(activeTargets.length),
  };
}

export function reviewedPairs(
  targets: readonly PairingTarget[],
  replacements: readonly SheetValue[],
): ReviewedPair[] {
  return computePairing(targets, replacements).active.map(({ target, replacement }) => ({
    layerId: target.layerId,
    replacementId: replacement.id,
    value: replacement.value,
  }));
}

export function moveReplacement(
  replacements: readonly SheetValue[],
  replacementId: string,
  targetIndex: number,
): SheetValue[] {
  const oldIndex = replacements.findIndex((replacement) => replacement.id === replacementId);
  if (oldIndex < 0 || replacements.length < 2) return [...replacements];
  const next = [...replacements];
  const [moved] = next.splice(oldIndex, 1);
  const boundedIndex = Math.max(0, Math.min(targetIndex, next.length));
  next.splice(boundedIndex, 0, moved!);
  return next;
}

export function moveReplacementBy(
  replacements: readonly SheetValue[],
  replacementId: string,
  delta: -1 | 1,
): SheetValue[] {
  const index = replacements.findIndex((replacement) => replacement.id === replacementId);
  return index < 0
    ? [...replacements]
    : moveReplacement(replacements, replacementId, index + delta);
}

export function pairingStats(
  targets: readonly PairingTarget[],
  replacements: readonly SheetValue[],
): PairingStats {
  const pairing = computePairing(targets, replacements);
  let changed = 0;
  let alreadySynced = 0;
  for (const { target, replacement } of pairing.active) {
    const hasChange =
      target.originalText !== replacement.value ||
      target.originalName !== normalizeLayerName(replacement.value);
    if (hasChange) changed += 1;
    else alreadySynced += 1;
  }
  return {
    changed,
    alreadySynced,
    skipped: targets.filter((target) => !target.included).length,
    unassigned: pairing.unassigned.length,
  };
}
