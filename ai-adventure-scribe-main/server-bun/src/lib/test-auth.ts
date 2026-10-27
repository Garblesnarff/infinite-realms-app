/**
 * Test Authentication
 *
 * Mints and verifies the HS256 tokens used by POST /v1/auth/test-login for
 * automated testing. Every entry point is gated by isTestAuthEnabled(), which
 * is false in production regardless of configuration.
 */

import jwt from 'jsonwebtoken';

export const TEST_AUTH_USER_ID = 'user_TEST_AUTOMATION_BOT_001';

/** ENABLE_TEST_AUTH is on only for the explicit, case-sensitive literal `true`. */
export function isTestAuthFlagOn(): boolean {
  return process.env.ENABLE_TEST_AUTH === 'true';
}

export function isTestAuthEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  if (!isTestAuthFlagOn()) return false;
  return Boolean(process.env.TEST_AUTH_SECRET);
}

export function verifyTestAccessToken(token: string): { userId: string; email?: string } | null {
  if (!isTestAuthEnabled()) return null;

  try {
    const payload = jwt.verify(token, process.env.TEST_AUTH_SECRET as string, {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;

    if (payload.type === 'refresh') return null;
    if (payload.sub !== TEST_AUTH_USER_ID) return null;

    return { userId: payload.sub, email: payload.email as string | undefined };
  } catch {
    return null;
  }
}

export function verifyTestRefreshToken(token: string): string | null {
  if (!isTestAuthEnabled()) return null;

  try {
    const payload = jwt.verify(token, process.env.TEST_AUTH_SECRET as string, {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;

    if (payload.type !== 'refresh') return null;
    if (payload.sub !== TEST_AUTH_USER_ID) return null;

    return payload.sub;
  } catch {
    return null;
  }
}

export function mintTestTokens(user: { id: string; email: string }): {
  accessToken: string;
  refreshToken: string;
} {
  const secret = process.env.TEST_AUTH_SECRET as string;

  const accessToken = jwt.sign(
    {
      sub: user.id,
      email: user.email,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
      type: 'access',
    },
    secret,
    { algorithm: 'HS256' },
  );

  const refreshToken = jwt.sign({ sub: user.id, type: 'refresh' }, secret, {
    algorithm: 'HS256',
    expiresIn: '7d',
  });

  return { accessToken, refreshToken };
}
