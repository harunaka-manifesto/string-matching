import { describe, expect, it } from 'vitest';
import { PluginToUiMessageSchema, UiToPluginMessageSchema } from '@ux-copy-sync/contracts';

describe('plugin message contracts', () => {
  it('accepts the reviewed fetch/apply messages', () => {
    expect(
      UiToPluginMessageSchema.safeParse({
        type: 'fetch-preview',
        payload: {
          requestId: '1',
          cellUrl:
            'https://docs.google.com/spreadsheets/d/1abcDEFghiJKLmnopQRS/edit#gid=1&range=D1',
          mode: 'public-test',
        },
      }).success,
    ).toBe(true);
    expect(
      UiToPluginMessageSchema.safeParse({
        type: 'refresh-preview',
        payload: {
          requestId: '2',
          previewToken: 'preview',
          cellUrl:
            'https://docs.google.com/spreadsheets/d/1abcDEFghiJKLmnopQRS/edit#gid=1&range=D1',
          mode: 'public-test',
        },
      }).success,
    ).toBe(true);
    expect(
      UiToPluginMessageSchema.safeParse({
        type: 'apply-reviewed-pairs',
        payload: {
          previewToken: 'p',
          pairs: [{ layerId: 't', replacementId: 'r', value: 'Copy' }],
        },
      }).success,
    ).toBe(true);
  });
  it('rejects untrusted arbitrary messages', () =>
    expect(
      UiToPluginMessageSchema.safeParse({ type: 'apply', value: 'delete everything' }).success,
    ).toBe(false));
  it('accepts only safe UI projections for auth state', () =>
    expect(
      PluginToUiMessageSchema.safeParse({
        type: 'auth-state',
        enabledPublicTestMode: false,
        authenticated: true,
        user: { email: 'writer@company.test' },
        mode: 'authenticated',
      }).success,
    ).toBe(true));
});
