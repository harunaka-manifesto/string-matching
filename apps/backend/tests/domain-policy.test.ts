import { describe, expect, it } from 'vitest';
import { AppError } from '@ux-copy-sync/contracts';
import { assertAllowedWorkspaceIdentity } from '../src/security/domain-policy';

const claims = {
  sub: 'google-sub',
  email: 'writer@company.test',
  email_verified: true,
  hd: 'company.test',
  aud: 'client-id',
  iss: 'https://accounts.google.com',
  exp: Math.floor(Date.now() / 1000) + 1000,
};

describe('Workspace identity policy', () => {
  it('accepts verified trusted hosted-domain claims', () =>
    expect(assertAllowedWorkspaceIdentity(claims, 'company.test', 'client-id').sub).toBe(
      'google-sub',
    ));
  it('does not authorize from the email suffix alone', () =>
    expect(() =>
      assertAllowedWorkspaceIdentity({ ...claims, hd: undefined }, 'company.test'),
    ).toThrow(AppError));
  it('rejects a different hosted domain', () =>
    expect(() =>
      assertAllowedWorkspaceIdentity({ ...claims, hd: 'other.test' }, 'company.test'),
    ).toThrow(AppError));
  it('requires issuer, audience, and a live expiry', () => {
    expect(() =>
      assertAllowedWorkspaceIdentity({ ...claims, iss: undefined }, 'company.test'),
    ).toThrow(AppError);
    expect(() =>
      assertAllowedWorkspaceIdentity({ ...claims, aud: undefined }, 'company.test'),
    ).toThrow(AppError);
    expect(() =>
      assertAllowedWorkspaceIdentity(
        { ...claims, exp: Math.floor(Date.now() / 1000) - 1 },
        'company.test',
      ),
    ).toThrow(AppError);
  });
});
