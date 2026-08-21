export const SAME_ROW_TOLERANCE = 4;

export type OrderedBounds = { id: string; x: number; y: number; width: number; height: number };

export function orderByVisualReading<T extends OrderedBounds>(nodes: readonly T[]): T[] {
  return [...nodes].sort((a, b) => {
    const dy = a.y - b.y;
    if (Math.abs(dy) > SAME_ROW_TOLERANCE) return dy;
    const dx = a.x - b.x;
    if (dx !== 0) return dx;
    return a.id.localeCompare(b.id);
  });
}
