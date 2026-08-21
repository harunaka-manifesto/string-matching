import { describe, expect, it, vi, afterEach } from 'vitest';
import { SheetCopyResponseSchema } from '@ux-copy-sync/contracts';
import { PublicSheetProvider } from '../src/sheets/public-test-provider';

afterEach(() => vi.unstubAllGlobals());

describe('public Sheet test provider', () => {
  it('uses the same blank filtering and fingerprint shape as private reads', async () => {
    const body =
      'google.visualization.Query.setResponse(' +
      JSON.stringify({
        status: 'ok',
        table: {
          cols: [{ label: 'Copy' }],
          rows: [{ c: [{ v: 'A' }] }, { c: [{ v: '' }] }, { c: [{ v: 'B' }] }],
        },
      }) +
      ');';
    let requestUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        requestUrl = input;
        return new Response(body, { status: 200 });
      }),
    );
    const result = await new PublicSheetProvider(500).copy(
      'https://docs.google.com/spreadsheets/d/1abcDEFghiJKLmnopQRS/edit#gid=123&range=D18',
      2,
    );
    expect(result.values.map((value) => [value.value, value.cell])).toEqual([
      ['A', 'D18'],
      ['B', 'D20'],
    ]);
    expect(SheetCopyResponseSchema.safeParse(result).success).toBe(true);
    expect(result.source.fingerprint).toHaveLength(64);
    expect(requestUrl).toContain('range=D18%3AD517');
    expect(requestUrl).toContain('headers=0');
  });
});
