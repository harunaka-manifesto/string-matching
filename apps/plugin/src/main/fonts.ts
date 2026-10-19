import { loadFont } from './perf';

/** Stands in for a font missing on this machine: the house typeface at regular weight. */
export const FALLBACK_FONT: FontName = { family: 'Rupa Sans', style: 'Regular' };

const fontKey = (font: FontName) => `${font.family}\u0000${font.style}`;

/**
 * Fonts this machine can render, read once per plugin session (keyed by the `figma`
 * global, which tests replace). `loadFontAsync` is no guide: it can resolve for a
 * font the layer still reports as missing.
 */
const installed = new WeakMap<object, Promise<Set<string>>>();
function installedFonts(): Promise<Set<string>> {
  let fonts = installed.get(figma);
  if (!fonts) {
    fonts = figma
      .listAvailableFontsAsync()
      .then((list) => new Set(list.map((font) => fontKey(font.fontName))));
    fonts.catch(() => installed.delete(figma));
    installed.set(figma, fonts);
  }
  return fonts;
}

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
  const have = await installedFonts();
  const missing = new Set(names.map(fontKey).filter((key) => !have.has(key)));
  await Promise.all(
    names.filter((font) => !missing.has(fontKey(font))).map((font) => loadFont(font)),
  );
  const unavailable = () =>
    new Error(
      `Missing font in “${node.name}”, and ${FALLBACK_FONT.family} ${FALLBACK_FONT.style} isn’t available to replace it`,
    );
  if (!have.has(fontKey(FALLBACK_FONT))) throw unavailable();
  await loadFont(FALLBACK_FONT).catch(() => {
    throw unavailable();
  });
  if (!replace) return;
  if (!node.characters.length) node.fontName = FALLBACK_FONT;
  else
    for (const segment of node.getStyledTextSegments(['fontName']))
      // Every range when Figma names no missing font: the layer still cannot be edited as is.
      if (!missing.size || missing.has(fontKey(segment.fontName)))
        node.setRangeFontName(segment.start, segment.end, FALLBACK_FONT);
  if (node.hasMissingFont) throw new Error(`Missing font in “${node.name}” could not be replaced`);
}
