/**
 * Finds the "same" text layer across duplicated screens on a page. Placeholder
 * text is often identical but not reliable, so matching leans on structure:
 * where the layer sits in the layer tree, where it sits on screen, and how it
 * is styled.
 */

export type TextNodeSnapshot = {
  id: string;
  name: string;
  characters: string;
  /** Screen-level frame that contains the node. */
  frameId: string;
  frameName: string;
  frameWidth: number;
  /** Ancestor layer names between the frame (exclusive) and the node (exclusive). */
  path: string[];
  fontKey?: string;
  fontSize?: number;
  textStyleId?: string;
  /** `<main component key>/<path inside instance>` when inside an instance. */
  instanceKey?: string;
  /** Node center relative to the frame's top-left corner, in px. */
  offsetX: number;
  offsetY: number;
};

export type LayerMatch = {
  sourceId: string;
  nodeId: string;
  frameId: string;
  frameName: string;
  score: number;
  reasons: string[];
};

export const MATCH_THRESHOLD = 0.75;

const WEIGHTS = {
  path: 0.3,
  position: 0.2,
  style: 0.15,
  name: 0.1,
  text: 0.15,
  frame: 0.1,
} as const;

/** Drops Figma duplicate suffixes and punctuation: `Header Copy 2` → `header`. */
export function normalizeDuplicateName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(copy|duplicate)\b(\s*\d+)?/gu, ' ')
    .replace(/[\s_-]*\d+$/u, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/gu, ' ').trim();
}

function tokens(value: string): Set<string> {
  return new Set(normalizeDuplicateName(value).split(' ').filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function lcsLength(a: readonly string[], b: readonly string[]): number {
  const row = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    let previousDiagonal = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const saved = row[j]!;
      row[j] = a[i - 1] === b[j - 1] ? previousDiagonal + 1 : Math.max(row[j]!, row[j - 1]!);
      previousDiagonal = saved;
    }
  }
  return row[b.length]!;
}

export function pathSimilarity(a: readonly string[], b: readonly string[]): number {
  const left = a.map(normalizeDuplicateName);
  const right = b.map(normalizeDuplicateName);
  if (!left.length && !right.length) return 1;
  return (2 * lcsLength(left, right)) / (left.length + right.length);
}

function positionSimilarity(source: TextNodeSnapshot, candidate: TextNodeSnapshot): number {
  const width = Math.max(1, source.frameWidth);
  const dx = (candidate.offsetX - source.offsetX) / width;
  // Duplicated screens often grow vertically (banners, errors), so vertical drift is forgiven more.
  const dy = (candidate.offsetY - source.offsetY) / Math.max(400, width);
  const distance = Math.sqrt(dx * dx + dy * dy);
  return Math.max(0, 1 - distance / 0.5);
}

function styleSimilarity(source: TextNodeSnapshot, candidate: TextNodeSnapshot): number {
  if (source.textStyleId && source.textStyleId === candidate.textStyleId) return 1;
  let score = 0;
  if (source.fontKey && source.fontKey === candidate.fontKey) score += 0.5;
  if (source.fontSize !== undefined && source.fontSize === candidate.fontSize) score += 0.5;
  return score;
}

export function scoreCandidate(
  source: TextNodeSnapshot,
  candidate: TextNodeSnapshot,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let path = pathSimilarity(source.path, candidate.path);
  // Same slot of the same component (e.g. a list item title) is structurally identical.
  if (source.instanceKey && source.instanceKey === candidate.instanceKey) path = Math.max(path, 1);
  if (path === 1) reasons.push('Same layer path');
  else if (path >= 0.6) reasons.push('Similar layer path');
  const position = positionSimilarity(source, candidate);
  if (position >= 0.9) reasons.push('Same position');
  else if (position >= 0.6) reasons.push('Nearby position');
  const style = styleSimilarity(source, candidate);
  if (style === 1) reasons.push('Same text style');
  const name =
    normalizeDuplicateName(source.name) === normalizeDuplicateName(candidate.name) ? 1 : 0;
  if (name) reasons.push('Same layer name');
  const text = normalizeText(source.characters) === normalizeText(candidate.characters) ? 1 : 0;
  if (text) reasons.push('Same text');
  const frame =
    0.7 * jaccard(tokens(source.frameName), tokens(candidate.frameName)) +
    0.3 * (Math.abs(source.frameWidth - candidate.frameWidth) < 1 ? 1 : 0);
  if (frame >= 0.8) reasons.push('Similar frame');
  const score =
    WEIGHTS.path * path +
    WEIGHTS.position * position +
    WEIGHTS.style * style +
    WEIGHTS.name * name +
    WEIGHTS.text * text +
    WEIGHTS.frame * frame;
  return { score: Math.round(score * 1000) / 1000, reasons };
}

/**
 * Scores candidates against source layers and assigns one-to-one per frame, so
 * one duplicate screen never maps two layers to the same source layer (and vice
 * versa). Only pairs at or above the threshold are returned.
 */
export function matchDuplicateLayers(input: {
  sources: readonly TextNodeSnapshot[];
  candidates: readonly TextNodeSnapshot[];
  threshold?: number;
}): LayerMatch[] {
  const threshold = input.threshold ?? MATCH_THRESHOLD;
  const sourceIds = new Set(input.sources.map((source) => source.id));
  type Pair = { source: TextNodeSnapshot; candidate: TextNodeSnapshot } & ReturnType<
    typeof scoreCandidate
  >;
  const byFrame = new Map<string, Pair[]>();
  for (const candidate of input.candidates) {
    if (sourceIds.has(candidate.id)) continue;
    for (const source of input.sources) {
      const scored = scoreCandidate(source, candidate);
      if (scored.score < threshold) continue;
      const pairs = byFrame.get(candidate.frameId) ?? [];
      pairs.push({ source, candidate, ...scored });
      byFrame.set(candidate.frameId, pairs);
    }
  }
  const results: LayerMatch[] = [];
  for (const pairs of byFrame.values()) {
    pairs.sort(
      (a, b) =>
        b.score - a.score ||
        a.source.id.localeCompare(b.source.id) ||
        a.candidate.id.localeCompare(b.candidate.id),
    );
    const usedSources = new Set<string>();
    const usedCandidates = new Set<string>();
    for (const pair of pairs) {
      if (usedSources.has(pair.source.id) || usedCandidates.has(pair.candidate.id)) continue;
      usedSources.add(pair.source.id);
      usedCandidates.add(pair.candidate.id);
      results.push({
        sourceId: pair.source.id,
        nodeId: pair.candidate.id,
        frameId: pair.candidate.frameId,
        frameName: pair.candidate.frameName,
        score: pair.score,
        reasons: pair.reasons,
      });
    }
  }
  return results;
}
