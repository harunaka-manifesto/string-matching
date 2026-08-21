import { AppError } from '@ux-copy-sync/contracts';

export type GoogleIdentityClaims = {
  sub: string;
  email: string;
  email_verified?: boolean;
  hd?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
};

export function assertAllowedWorkspaceIdentity(
  claims: GoogleIdentityClaims,
  expectedDomain: string,
  expectedAudience?: string,
): GoogleIdentityClaims {
  if (
    !claims.sub ||
    !claims.email ||
    claims.email_verified !== true ||
    !claims.hd ||
    !expectedDomain
  ) {
    throw new AppError(
      'AUTH_DOMAIN_NOT_ALLOWED',
      'This Google account is not part of the approved Workspace.',
    );
  }
  if (claims.hd !== expectedDomain)
    throw new AppError(
      'AUTH_DOMAIN_NOT_ALLOWED',
      'This Google account is not part of the approved Workspace.',
    );
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    !claims.iss ||
    !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) ||
    !claims.exp ||
    !Number.isFinite(claims.exp) ||
    claims.exp * 1000 <= Date.now() ||
    !audiences.some(Boolean) ||
    (expectedAudience && !audiences.includes(expectedAudience))
  )
    throw new AppError('AUTH_FAILED', 'Google identity verification failed.');
  return claims;
}
