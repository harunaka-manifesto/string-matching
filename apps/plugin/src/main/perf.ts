// Helpers that keep file-wide work (every text layer, every variable) linear.

const loadedFonts = new Map<string, Promise<void>>();

/** `figma.loadFontAsync`, once per font for the plugin session; a failed load is retried next time. */
export function loadFont(font: FontName): Promise<void> {
  const key = `${font.family}\u0000${font.style}`;
  let pending = loadedFonts.get(key);
  if (!pending) {
    pending = figma.loadFontAsync(font).catch((error) => {
      loadedFonts.delete(key);
      throw error;
    });
    loadedFonts.set(key, pending);
  }
  return pending;
}

/** Text layers grouped by the variable bound to their characters. Built in one pass. */
export function textsByVariable(texts: readonly TextNode[]): Map<string, TextNode[]> {
  const byVariable = new Map<string, TextNode[]>();
  for (const node of texts) {
    const id = node.boundVariables?.characters?.id;
    if (!id) continue;
    const group = byVariable.get(id);
    if (group) group.push(node);
    else byVariable.set(id, [node]);
  }
  return byVariable;
}
