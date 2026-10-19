export function figmaFixture() {
  let next = 0;
  const collections: any[] = [];
  const vars: any[] = [];
  const nodes: any[] = [];
  /** Font families `loadFontAsync` refuses, as if not installed. */
  const missingFonts = new Set<string>();
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
  /** Explicit EN/ID modes, as Figma keeps them: a node's own, else the nearest ancestor's. */
  const modes = (n: any) => {
    n.explicitVariableModes = {};
    n.setExplicitVariableModeForCollection = (c: any, mode: string) =>
      (n.explicitVariableModes[c.id] = mode);
    n.clearExplicitVariableModeForCollection = (c: any) => delete n.explicitVariableModes[c.id];
    Object.defineProperty(n, 'resolvedVariableModes', {
      get: () => ({ ...(n.parent?.resolvedVariableModes ?? {}), ...n.explicitVariableModes }),
    });
  };
  const frame = (name = 'Frame') => {
    const f: any = {
      id: 'f' + next++,
      type: 'FRAME',
      name,
      parent: { type: 'PAGE' },
      findAllWithCriteria: () =>
        nodes.filter((n) => {
          for (let p = n.parent; p; p = p.parent) if (p === f) return true;
          return false;
        }),
    };
    modes(f);
    return f;
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
      fontSize: 14,
      boundVariables: {},
      ...shared(),
      getRangeAllFontNames: () => [n.fontName],
      getStyledTextSegments: () => [{ start: 0, end: n.characters.length, fontName: n.fontName }],
      setRangeFontName: (_start: number, _end: number, font: any) => {
        n.fontName = font;
        n.hasMissingFont = missingFonts.has(font.family);
      },
      setBoundVariable: (property: string, v: any) => {
        if (n.failBinding) {
          n.failBinding = false;
          throw new Error('Binding interrupted');
        }
        n.boundVariables[property] = v ? { id: v.id, type: 'VARIABLE_ALIAS' } : undefined;
      },
    };
    modes(n);
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
    loadFontAsync: async (font: any) => {
      if (missingFonts.has(font.family)) throw new Error(`${font.family} is not available`);
    },
    loadAllPagesAsync: async () => {},
    commitUndo: () => {},
    root: { children: [{ findAllWithCriteria: () => nodes.filter((n) => n.type === 'TEXT') }] },
  };
  return {
    figma,
    collections,
    vars,
    nodes,
    text,
    frame,
    createCollection,
    createVariable,
    missingFonts,
  };
}
