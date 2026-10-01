import { expect, it, vi } from 'vitest';
import { readVariableValues } from '../src/main/library-index';

it('resolves shared aliases by locale when collection mode orders differ and rejects cycles', async () => {
  const target = {
    id: 'shared',
    variableCollectionId: 'target',
    description: '',
    key: 'shared-key',
    valuesByMode: { idFirst: 'Lanjut', enSecond: 'Continue' },
  };
  vi.stubGlobal('figma', {
    variables: {
      getVariableByIdAsync: async () => target,
      getVariableCollectionByIdAsync: async (id: string) => ({
        modes:
          id === 'target'
            ? [
                { modeId: 'idFirst', name: 'ID' },
                { modeId: 'enSecond', name: 'EN' },
              ]
            : [
                { modeId: 'english', name: 'EN' },
                { modeId: 'indonesian', name: 'ID' },
              ],
      }),
    },
  });
  try {
    const alias = {
      variableCollectionId: 'source',
      description: '',
      key: 'old-key',
      valuesByMode: {
        english: { type: 'VARIABLE_ALIAS', id: 'shared' },
        indonesian: { type: 'VARIABLE_ALIAS', id: 'shared' },
      },
    };
    expect(await readVariableValues(alias as unknown as Variable)).toEqual({
      key: 'old-key',
      en: 'Continue',
      id: 'Lanjut',
      description: '',
    });
    target.valuesByMode.enSecond = { type: 'VARIABLE_ALIAS', id: 'shared' } as unknown as string;
    await expect(readVariableValues(alias as unknown as Variable)).rejects.toThrow('Circular');
  } finally {
    vi.unstubAllGlobals();
  }
});
