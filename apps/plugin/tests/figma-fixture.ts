export function figmaFixture() {
  let next = 0;
  const collections: any[] = [];
  const vars: any[] = [];
  const nodes: any[] = [];
  const shared = () => {
    const data = new Map<string, string>();
    return {
      getSharedPluginData: (ns: string, k: string) => data.get(ns + ':' + k) ?? '',
      setSharedPluginData: (ns: string, k: string, v: string) => data.set(ns + ':' + k, v),
    };
  };
  const createCollection = (name: string) => {
    const c: any = {
      id: 'c' + next++,
      name,
      defaultModeId: 'id',
      modes: [{ modeId: 'id', name: 'ID' }],
      variableIds: [],
      ...shared(),
      renameMode: (id: string, name: string) =>
        (c.modes.find((m: any) => m.modeId === id).name = name),
      addMode: (name: string) => {
        const id = 'mode' + next++;
        c.modes.push({ modeId: id, name });
        return id;
      },
    };
    collections.push(c);
    return c;
  };
  const createVariable = (name: string, c: any) => {
    const v: any = {
      id: 'v' + next++,
      key: 'key' + next,
      name,
      variableCollectionId: c.id,
      valuesByMode: {},
      description: '',
      remote: false,
      ...shared(),
      setValueForMode: (id: string, value: string) => (v.valuesByMode[id] = value),
      remove: () => {
        vars.splice(vars.indexOf(v), 1);
        c.variableIds = c.variableIds.filter((id: string) => id !== v.id);
      },
      getPublishStatusAsync: async () => 'CURRENT',
    };
    vars.push(v);
    c.variableIds.push(v.id);
    return v;
  };
  const text = (name = 'Title', characters = 'Canvas') => {
    const n: any = {
      id: 'n' + next++,
      type: 'TEXT',
      name,
      visible: true,
      parent: null,
      hasMissingFont: false,
      fontName: { family: 'Inter', style: 'Regular' },
      boundVariables: {},
      resolvedVariableModes: {},
      ...shared(),
      getRangeAllFontNames: () => [{ family: 'Inter', style: 'Regular' }],
      setBoundVariable: (property: string, v: any) => {
        if (n.failBinding) {
          n.failBinding = false;
          throw new Error('Binding interrupted');
        }
        n.boundVariables[property] = v ? { id: v.id, type: 'VARIABLE_ALIAS' } : undefined;
      },
      setExplicitVariableModeForCollection: (c: any, mode: string) =>
        (n.resolvedVariableModes[c.id] = mode),
    };
    Object.defineProperty(n, 'characters', {
      get: () => {
        const v = vars.find((v) => v.id === n.boundVariables.characters?.id);
        return v
          ? v.valuesByMode[n.resolvedVariableModes[v.variableCollectionId] ?? 'id']
          : characters;
      },
      set: (value: string) => (characters = value),
    });
    nodes.push(n);
    return n;
  };
  const figma: any = {
    // Progress (`activity`) messages to the UI.
    ui: { postMessage: () => {} },
    variables: {
      getLocalVariablesAsync: async () => vars.filter((v) => !v.remote),
      getLocalVariableCollectionsAsync: async () => collections,
      getVariableByIdAsync: async (id: string) => vars.find((v) => v.id === id) ?? null,
      getVariableCollectionByIdAsync: async (id: string) =>
        collections.find((c) => c.id === id) ?? null,
      createVariableCollection: createCollection,
      createVariable,
      importVariableByKeyAsync: async (key: string) => vars.find((v) => v.key === key),
    },
    getNodeByIdAsync: async (id: string) => nodes.find((n) => n.id === id) ?? null,
    loadFontAsync: async () => {},
    loadAllPagesAsync: async () => {},
    commitUndo: () => {},
    root: { children: [{ findAllWithCriteria: () => nodes.filter((n) => n.type === 'TEXT') }] },
  };
  return { figma, collections, vars, nodes, text, createCollection, createVariable };
}
