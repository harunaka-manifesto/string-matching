import { beforeEach, expect, it, vi } from 'vitest';
import type { CopyRecord } from '@string-binder/contracts';
import { figmaFixture } from './figma-fixture';
import { materialize } from '../src/main/delivery';

vi.mock('../src/main/library-index', () => ({ readVariableValues: vi.fn() }));
vi.mock('../src/main/registry-api', () => ({ api: vi.fn() }));

const record = (n: number): CopyRecord => ({
  copyId: `cp_01K0000000E00R00000000000${n}`,
  platformKey: `gopay_test_screen_title_${n}`,
  revision: 1,
  en: `Hello ${n}`,
  id: `Halo ${n}`,
  product: 'test',
  context: { feature: '', screen: 'screen', context: '', role: 'title', note: '' },
  status: 'active',
  aliases: [],
});

let f: ReturnType<typeof figmaFixture>;
beforeEach(() => {
  f = figmaFixture();
  // Collection lookups resolve on a later tick, like Figma's async API.
  const list = f.figma.variables.getLocalVariableCollectionsAsync;
  f.figma.variables.getLocalVariableCollectionsAsync = async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return list();
  };
  vi.stubGlobal('figma', f.figma);
});

it('two new strings of one product materialized at once share one new collection', async () => {
  await Promise.all([materialize(record(1), 'Test'), materialize(record(2), 'Test')]);
  expect(f.collections).toHaveLength(1);
  expect(f.collections[0].variableIds).toHaveLength(2);
});
