import type { SheetValue } from '@ux-copy-sync/contracts';

export type CandidateQueueState = {
  active: SheetValue[];
  excluded: SheetValue[];
};

export type CandidateQueueAction =
  | { type: 'reset'; values: readonly SheetValue[] }
  | { type: 'move'; id: string; index: number }
  | { type: 'exclude'; id: string }
  | { type: 'restore-end'; id: string }
  | { type: 'restore-at'; id: string; index: number };

export function candidateQueue(values: readonly SheetValue[]): CandidateQueueState {
  return { active: [...values], excluded: [] };
}

export function resetCandidates(values: readonly SheetValue[]): CandidateQueueState {
  return candidateQueue(values);
}

export function moveCandidate(
  state: CandidateQueueState,
  id: string,
  index: number,
): CandidateQueueState {
  const oldIndex = state.active.findIndex((candidate) => candidate.id === id);
  if (oldIndex < 0 || state.active.length < 2) return state;

  const active = [...state.active];
  const [moved] = active.splice(oldIndex, 1);
  const boundedIndex = Math.max(0, Math.min(index, active.length));
  active.splice(boundedIndex, 0, moved!);
  return { ...state, active };
}

export function excludeCandidate(state: CandidateQueueState, id: string): CandidateQueueState {
  const index = state.active.findIndex((candidate) => candidate.id === id);
  if (index < 0) return state;

  const active = [...state.active];
  const [excluded] = active.splice(index, 1);
  return { active, excluded: [...state.excluded, excluded!] };
}

export function restoreCandidateToEnd(
  state: CandidateQueueState,
  id: string,
): CandidateQueueState {
  return restoreCandidateAt(state, id, state.active.length);
}

export function restoreCandidateAt(
  state: CandidateQueueState,
  id: string,
  activeIndex: number,
): CandidateQueueState {
  const excludedIndex = state.excluded.findIndex((candidate) => candidate.id === id);
  if (excludedIndex < 0) return state;

  const excluded = [...state.excluded];
  const [restored] = excluded.splice(excludedIndex, 1);
  const active = [...state.active];
  const boundedIndex = Math.max(0, Math.min(activeIndex, active.length));
  active.splice(boundedIndex, 0, restored!);
  return { active, excluded };
}

export function candidateQueueReducer(
  state: CandidateQueueState,
  action: CandidateQueueAction,
): CandidateQueueState {
  switch (action.type) {
    case 'reset':
      return resetCandidates(action.values);
    case 'move':
      return moveCandidate(state, action.id, action.index);
    case 'exclude':
      return excludeCandidate(state, action.id);
    case 'restore-end':
      return restoreCandidateToEnd(state, action.id);
    case 'restore-at':
      return restoreCandidateAt(state, action.id, action.index);
  }
}
