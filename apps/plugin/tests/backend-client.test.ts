import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackendClient } from '../src/main/backend-client';

afterEach(() => vi.unstubAllGlobals());

const exactUrl =
  'https://docs.google.com/spreadsheets/d/1Dz1VMHYKaRu8koJbwLq0OkizKVd8pIaOIzNBzRnmn54/edit?gid=1754548139#gid=1754548139&range=C1';

function copyResponse(cellUrl = exactUrl) {
  return {
    source: {
      cellUrl,
      spreadsheetId: '1Dz1VMHYKaRu8koJbwLq0OkizKVd8pIaOIzNBzRnmn54',
      sheetId: 1754548139,
      sheetTitle: 'Public Sheet',
      startCell: 'C1',
      scannedThroughCell: 'C9',
      requestedCount: 9,
      fingerprint: '0'.repeat(64),
    },
    values: [{ id: 'C1', value: 'Copy', row: 1, cell: 'C1' }],
    meta: { requestedCount: 9, returnedCount: 1, scannedRowCount: 9, scanLimitReached: false },
  };
}

describe('Figma controller backend transport', () => {
  it('uses a string URL and plain Fetch options for unauthenticated auth start', async () => {
    vi.stubGlobal('URL', undefined);
    const calls: Array<{ url: string; options?: Record<string, unknown> }> = [];
    const client = new BackendClient(
      'https://backend.test',
      async () => 'session-token',
      async (url, options) => {
        calls.push({ url, options: options as Record<string, unknown> });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            flowId: 'flow-1',
            readKey: 'read-key',
            browserUrl: 'https://backend.test/oauth/start?flowId=flow-1',
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
          }),
        };
      },
    );

    await client.startAuth();

    expect(calls[0]?.url).toBe('https://backend.test/v1/auth/start');
    expect(calls[0]?.options).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Plugin-Version': 'test' },
    });
    expect(calls[0]?.options).not.toHaveProperty('signal');
  });

  it('parses the public Sheet response without a browser URL global', async () => {
    vi.stubGlobal('URL', undefined);
    const client = new BackendClient(
      'https://backend.test',
      async () => undefined,
      async () => ({ ok: true, status: 200, json: async () => copyResponse() }),
    );

    const result = await client.publicCopy(exactUrl, 9);

    expect(result.source).toMatchObject({
      cellUrl: exactUrl,
      spreadsheetId: '1Dz1VMHYKaRu8koJbwLq0OkizKVd8pIaOIzNBzRnmn54',
      sheetId: 1754548139,
      startCell: 'C1',
    });
  });

  it('normalizes malformed backend responses instead of exposing schema details', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = new BackendClient(
      'https://backend.test',
      async () => undefined,
      async () => ({ ok: true, status: 200, json: async () => copyResponse('not-a-sheet-url') }),
    );

    await expect(client.publicCopy(exactUrl, 9)).rejects.toMatchObject({
      code: 'INVALID_BACKEND_RESPONSE',
      message:
        'The backend returned an unexpected response. Restart the development backend and try again.',
    });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('normalizes structurally invalid backend responses', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const invalidResponse = copyResponse();
    invalidResponse.source.fingerprint = 'not-a-fingerprint';
    const client = new BackendClient(
      'https://backend.test',
      async () => undefined,
      async () => ({ ok: true, status: 200, json: async () => invalidResponse }),
    );

    await expect(client.publicCopy(exactUrl, 9)).rejects.toMatchObject({
      code: 'INVALID_BACKEND_RESPONSE',
      message:
        'The backend returned an unexpected response. Restart the development backend and try again.',
    });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('does not make a private request without a stored session', async () => {
    const fetcher = async () => {
      throw new Error('must not fetch');
    };
    const client = new BackendClient('https://backend.test', async () => undefined, fetcher);
    await expect(client.copy('cell', 1)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });
});
