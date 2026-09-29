import {
  PLUGIN_DATA_NAMESPACE,
  PLUGIN_DATA_STATE_KEY,
  StoredLayerStateSchema,
  type StoredLayerState,
} from '@string-binder/contracts';

export function readLayerState(node: BaseNode): StoredLayerState | null {
  const parsed = StoredLayerStateSchema.safeParse(
    node.getSharedPluginData(PLUGIN_DATA_NAMESPACE, PLUGIN_DATA_STATE_KEY),
  );
  return parsed.success ? parsed.data : null;
}

export function writeLayerState(node: BaseNode, state: StoredLayerState | null): void {
  if (readLayerState(node) === state) return;
  node.setSharedPluginData(PLUGIN_DATA_NAMESPACE, PLUGIN_DATA_STATE_KEY, state ?? '');
}

export function boundVariableId(node: TextNode): string | null {
  return node.boundVariables?.characters?.id ?? null;
}

const variableCache = new Map<string, Promise<Variable | null>>();

export function variableById(id: string): Promise<Variable | null> {
  let variable = variableCache.get(id);
  if (!variable) {
    variable = figma.variables.getVariableByIdAsync(id).catch(() => null);
    variableCache.set(id, variable);
  }
  return variable;
}

export function forgetVariableCache(): void {
  variableCache.clear();
}
