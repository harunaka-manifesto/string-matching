import { loadFont } from './perf';

/** Stands in for a font missing on this machine: the house typeface at regular weight. */
export const FALLBACK_FONT: FontName = { family: 'Rupa Sans', style: 'Regular' };

const fontKey = (font: FontName) => `${font.family}\u0000${font.style}`;

/**
 * Loads the fonts a text layer uses so its characters can change. A font missing on
 * this machine is replaced by Rupa Sans Regular; each range keeps its size. With
 * `replace: false` (previews) the layer is left untouched and only checked.
 */
export async function loadTextFonts(node: TextNode, replace = true): Promise<void> {
  const names = node.characters.length
    ? node.getRangeAllFontNames(0, node.characters.length)
    : [node.fontName as FontName];
  if (!node.hasMissingFont) {
    await Promise.all(names.map(loadFont));
    return;
  }
  const missing = new Set<string>();
  await Promise.all(names.map((font) => loadFont(font).catch(() => missing.add(fontKey(font)))));
  await loadFont(FALLBACK_FONT).catch(() => {
    throw new Error(
      `Missing font in “${node.name}”, and ${FALLBACK_FONT.family} ${FALLBACK_FONT.style} isn’t available to replace it`,
    );
  });
  if (!replace) return;
  if (!node.characters.length) {
    node.fontName = FALLBACK_FONT;
    return;
  }
  for (const segment of node.getStyledTextSegments(['fontName']))
    if (missing.has(fontKey(segment.fontName)))
      node.setRangeFontName(segment.start, segment.end, FALLBACK_FONT);
}
