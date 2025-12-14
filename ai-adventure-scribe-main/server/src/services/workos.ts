import { WorkOS } from '@workos-inc/node';
import { jwtVerify, createRemoteJWKSet, JWTPayload } from 'jose';

// Lazy initialization - WorkOS client is created on first use
// This allows env vars to be loaded before initialization
let _workos: WorkOS | null = null;

export function getWorkOS(): WorkOS {
  if (!_workos) {
    const apiKey = process.env.WORKOS_API_KEY;
    if (!apiKey) {
      throw new Error('WORKOS_API_KEY environment variable is not set');
    }
    _workos = new WorkOS(apiKey);
  }
  return _workos;
}

// Lazy getter for backward compatibility
export const workos = {
  get userManagement() {
    return getWorkOS().userManagement;
  },
};

// Auth configuration - also lazy to ensure env vars are loaded
let _authConfig: { clientId: string; redirectUri: string } | null = null;

export function getAuthConfig() {
  if (!_authConfig) {
    _authConfig = {
      clientId: process.env.WORKOS_CLIENT_ID!,
      redirectUri: process.env.WORKOS_REDIRECT_URI || 'https://infiniterealms.app/auth/callback',
    };
  }
  return _authConfig;
}

// For backward compatibility, export authConfig as a getter
export const authConfig = {
  get clientId() {
    return getAuthConfig().clientId;
  },
  get redirectUri() {
    return getAuthConfig().redirectUri;
  },
};

// Create JWKS for WorkOS token verification - lazy initialization
let _JWKS: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!_JWKS) {
    _JWKS = createRemoteJWKSet(
      new URL(`https://api.workos.com/sso/jwks/${authConfig.clientId}`),
      {
        cooldownDuration: 1000 * 60 * 5, // 5 minutes cooldown for JWKS refresh
      }
    );
  }
  return _JWKS;
}

// Verify WorkOS JWT access token with signature verification
export async function verifyWorkOSToken(accessToken: string) {
  try {
    // Verify JWT signature using WorkOS JWKS endpoint
    // WorkOS User Management tokens have issuer: https://api.workos.com/user_management/{clientId}
    const { payload } = await jwtVerify(accessToken, getJWKS(), {
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
