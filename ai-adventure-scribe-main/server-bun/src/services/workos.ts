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
    // Add 30-second clock tolerance to handle minor timing differences
    const { payload } = await jwtVerify(accessToken, JWKS, {
      issuer: `https://api.workos.com/user_management/${authConfig.clientId}`,
      clockTolerance: 30, // 30 seconds tolerance
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
    // Log specific error for debugging with token details
    if (error instanceof Error) {
      // Decode token payload to see expiry (without verifying signature)
      try {
        const parts = accessToken.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          const expTime = payload.exp ? new Date(payload.exp * 1000).toISOString() : 'N/A';
          const nowTime = new Date().toISOString();
          const tokenAgeSec = payload.iat ? Math.floor((Date.now() / 1000) - payload.iat) : 'N/A';
          console.error(`WorkOS token verification failed: ${error.message}`);
          console.error(`  Token exp: ${expTime}, Now: ${nowTime}, Token age: ${tokenAgeSec}s`);
          console.error(`  Token sub: ${payload.sub}, sid: ${payload.sid}`);
        }
      } catch {
        console.error('WorkOS token verification failed:', error.message);
      }
    } else {
      console.error('WorkOS token verification failed:', error);
    }
    return null;
  }
}
