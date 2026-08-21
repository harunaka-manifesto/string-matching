import { describe, expect, it } from 'vitest';
import { readPrivateSheet } from '../src/sheets/read-copy';

const api = {
  spreadsheets: {
    get: async () => ({
      data: {
        properties: { title: 'Copybook' },
        sheets: [{ properties: { sheetId: 123, title: "Writer's Copy" } }],
      },
    }),
    values: {
      get: async (input: { range: string }) => ({
        data: { values: [['Title'], [''], ['  '], ['Body'], ['Continue']] },
      }),
    },
  },
};

describe('private Sheet read', () => {
  it('resolves gid, quotes tab names, skips blanks, and preserves rows', async () => {
    const ranges: string[] = [];
    const renderOptions: string[] = [];
    const response = await readPrivateSheet({
      api: {
        ...api,
        spreadsheets: {
          ...api.spreadsheets,
          values: {
            get: async (input: { range: string; valueRenderOption: string }) => {
              ranges.push(input.range);
              renderOptions.push(input.valueRenderOption);
              return { data: { values: [['Title'], [''], ['  '], ['Body'], ['Continue']] } };
            },
          },
        },
      },
      cellUrl: 'https://docs.google.com/spreadsheets/d/1abcDEFghiJKLmnopQRS/edit#gid=123&range=D18',
      requestedCount: 3,
      scanLimit: 500,
      retry: async (operation) => operation(1),
    });
    expect(response.source.sheetTitle).toBe("Writer's Copy");
    expect(response.values.map((value) => [value.value, value.cell])).toEqual([
      ['Title', 'D18'],
      ['Body', 'D21'],
      ['Continue', 'D22'],
    ]);
    expect(response.meta.returnedCount).toBe(3);
    expect(ranges).toEqual(["'Writer''s Copy'!D18:D517"]);
    expect(renderOptions).toEqual(['FORMATTED_VALUE']);
  });
  it('fails when the gid is not present', async () => {
    const missing = {
      ...api,
      spreadsheets: { ...api.spreadsheets, get: async () => ({ data: { sheets: [] } }) },
    };
    await expect(
      readPrivateSheet({
        api: missing,
        cellUrl:
          'https://docs.google.com/spreadsheets/d/1abcDEFghiJKLmnopQRS/edit#gid=123&range=D18',
        requestedCount: 1,
        scanLimit: 500,
      }),
    ).rejects.toMatchObject({ code: 'SHEET_TAB_NOT_FOUND' });
  });
});
