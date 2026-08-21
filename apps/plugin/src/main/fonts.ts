import { AppError } from '@ux-copy-sync/contracts';

type TextNodeLike = TextNode & { hasMissingFont?: boolean };

export function fontsUsedBy(node: TextNodeLike): FontName[] {
  const length = node.characters.length;
  const fonts = length > 0 ? node.getRangeAllFontNames(0, length) : [node.fontName as FontName];
  const seen = new Set<string>();
  return fonts.filter((font) => {
    const key = `${font.family}\n${font.style}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function loadFontsForNodes(nodes: readonly TextNodeLike[]): Promise<void> {
  const fonts = new Map<string, FontName>();
  for (const node of nodes) {
    if (node.hasMissingFont)
      throw new AppError('FONT_LOAD_FAILED', `Could not load the font used by “${node.name}”.`, {
        layers: [node.name],
      });
    for (const font of fontsUsedBy(node)) fonts.set(`${font.family}\n${font.style}`, font);
  }
  try {
    for (const font of fonts.values()) await figma.loadFontAsync(font);
  } catch (cause) {
    console.error('[UX Copy Sync] Font loading failed.', {
      name: cause instanceof Error ? cause.name : typeof cause,
    });
    throw new AppError('FONT_LOAD_FAILED', 'Could not load all fonts before applying changes.');
  }
}
