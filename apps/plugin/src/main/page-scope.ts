/** Product a page belongs to, chosen by a writer or guessed once by the plugin. */
export type PageScope = { product: string; confirmed: boolean };

const KEY = 'scope';
const fallbackKey = (page: PageNode) => `scope:${figma.root.id}:${page.id}`;

function parse(raw: unknown): PageScope | null {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return value && typeof value.product === 'string' && typeof value.confirmed === 'boolean'
      ? { product: value.product, confirmed: value.confirmed }
      : null;
  } catch {
    return null;
  }
}

export function pageOf(node: BaseNode): PageNode | null {
  let current: BaseNode | null = node;
  while (current && current.type !== 'PAGE') current = current.parent;
  return current;
}

/** Stored on the page so every writer of the file shares it; per device in view-only files. */
export async function readPageScope(page: PageNode): Promise<PageScope | null> {
  return (
    parse(page.getSharedPluginData('copy', KEY)) ??
    parse(await figma.clientStorage.getAsync(fallbackKey(page)))
  );
}

export async function writePageScope(pageId: string, scope: PageScope): Promise<PageScope> {
  const page = await figma.getNodeByIdAsync(pageId);
  if (!page || page.type !== 'PAGE') throw new Error('That page no longer exists');
  if (typeof scope.product !== 'string' || !/^[a-z0-9-]*$/u.test(scope.product))
    throw new Error('Invalid product');
  const value = { product: scope.product, confirmed: !!scope.confirmed };
  // A guess never replaces a writer's choice made elsewhere in the meantime.
  const existing = await readPageScope(page);
  if (existing?.confirmed && !value.confirmed) return existing;
  try {
    page.setSharedPluginData('copy', KEY, JSON.stringify(value));
  } catch {
    await figma.clientStorage.setAsync(fallbackKey(page), value);
  }
  return value;
}
