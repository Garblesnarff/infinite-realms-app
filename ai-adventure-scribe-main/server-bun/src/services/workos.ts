/**
 * WorkOS Authentication Service
 *
 * Provides WorkOS token verification using JWT signature validation.
 * Ported from /server/src/services/workos.ts for Bun/Elysia compatibility.
 */

import { WorkOS } from '@workos-inc/node';
import { jwtVerify, createRemoteJWKSet } from 'jose';

// Initialize WorkOS client with API key
export const workos = new WorkOS(process.env.WORKOS_API_KEY!);

// Auth configuration
export const authConfig = {
  clientId: process.env.WORKOS_CLIENT_ID!,
  redirectUri: process.env.WORKOS_REDIRECT_URI || 'https://infiniterealms.app/auth/callback',
};

// Create JWKS for WorkOS token verification
// This is cached and will be reused across requests
const JWKS = createRemoteJWKSet(
  new URL(`https://api.workos.com/sso/jwks/${authConfig.clientId}`),
  {
    cooldownDuration: 1000 * 60 * 5, // 5 minutes cooldown for JWKS refresh
  }
);

/**
 * Verify WorkOS JWT access token with signature verification
 *
 * @param accessToken - The WorkOS JWT access token
 * @returns User info if valid, null if invalid
 */
export async function verifyWorkOSToken(accessToken: string) {
  try {
    // Verify JWT signature using WorkOS JWKS endpoint
    // WorkOS User Management tokens have issuer: https://api.workos.com/user_management/{clientId}
    const { payload } = await jwtVerify(accessToken, JWKS, {
      issuer: `https://api.workos.com/user_management/${authConfig.clientId}`,
    });

    // Extract user information from verified token
    if (!payload.sub) {
      console.error('WorkOS token missing sub claim');
      return null;
    }

    return {
      userId: payload.sub as string,
      email: payload.email as string,
    };
  } catch (error) {
    // Log specific error for debugging
    if (error instanceof Error) {
      console.error('WorkOS token verification failed:', error.message);
    } else {
      console.error('WorkOS token verification failed:', error);
    }
    return null;
  }
}
