export function normalizeLayerName(value: string): string {
  return value
    .replace(/\r\n?|\n/g, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}
