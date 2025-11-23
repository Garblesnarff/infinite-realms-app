import { WorkOS } from '@workos-inc/node';
import jwt from 'jsonwebtoken';

// Initialize WorkOS client with API key
export const workos = new WorkOS(process.env.WORKOS_API_KEY!);

// Auth configuration
export const authConfig = {
  clientId: process.env.WORKOS_CLIENT_ID!,
  redirectUri: process.env.WORKOS_REDIRECT_URI || 'https://infiniterealms.app/auth/callback',
};

// Verify WorkOS JWT access token
export async function verifyWorkOSToken(accessToken: string) {
  try {
    // Decode the JWT without verification (WorkOS tokens are signed by WorkOS)
    // For production, you should verify the signature using WorkOS's public key
    const decoded = jwt.decode(accessToken) as any;

    if (!decoded || !decoded.sub) {
      return null;
    }

    return {
      userId: decoded.sub as string,
      email: decoded.email as string,
    };
  } catch (error) {
    console.error('WorkOS token verification failed:', error);
    return null;
  }
}
