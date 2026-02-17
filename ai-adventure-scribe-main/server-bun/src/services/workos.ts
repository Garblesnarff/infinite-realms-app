/**
 * WorkOS Authentication Service
 *
 * Provides WorkOS token verification using JWT signature validation.
 * Ported from /server/src/services/workos.ts for Bun/Elysia compatibility.
 */

import { WorkOS } from '@workos-inc/node';
import { jwtVerify, createRemoteJWKSet } from 'jose';

import { logger } from '../lib/logger.js';

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
      logger.error('WorkOS token missing sub claim');
      return null;
    }

    return {
      userId: payload.sub as string,
      email: payload.email as string,
    };
  } catch (error) {
    // ⚡ Bolt: Replaced console.error with structured logger and optimized token decoding on error.
    if (error instanceof Error) {
      try {
        const parts = accessToken.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          logger.error({
            msg: 'WorkOS token verification failed',
            error: error.message,
            tokenData: {
              exp: payload.exp ? new Date(payload.exp * 1000).toISOString() : 'N/A',
              now: new Date().toISOString(),
              ageSec: payload.iat ? Math.floor(Date.now() / 1000 - payload.iat) : 'N/A',
              sub: payload.sub,
              sid: payload.sid,
            },
          });
        } else {
          logger.error({ msg: 'WorkOS token verification failed: Invalid format', error: error.message });
        }
      } catch (decodeError) {
        logger.error({
          msg: 'WorkOS token verification failed',
          error: error.message,
          decodeError: decodeError instanceof Error ? decodeError.message : String(decodeError),
        });
      }
    } else {
      logger.error({ msg: 'WorkOS token verification failed', error });
    }
    return null;
  }
}
