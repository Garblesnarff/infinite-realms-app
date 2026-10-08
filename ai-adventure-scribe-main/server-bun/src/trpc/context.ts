/**
 * tRPC Context
 *
 * Creates the context for each tRPC request, including:
 * - Authenticated user information from WorkOS tokens
 * - Drizzle database client for type-safe queries
 * - Express request and response objects
 *
 * The context is available in all tRPC procedures and middleware.
 */

import { db } from '../../../db/client';
import { resolveUserPlan } from '../lib/auth.js';
import { getBearerToken } from '../lib/jwt.js';
import { verifyWorkOSToken } from '../services/workos.js';

import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';

/**
 * Authenticated user payload extracted from WorkOS token
 */
export interface AuthUser {
  userId: string;
  email?: string;
  plan: string;
}

/**
 * Creates context for tRPC requests
 * Extracts and validates WorkOS auth token if present
 */
export async function createContext({ req, resHeaders }: FetchCreateContextFnOptions) {
  // Extract bearer token from Authorization header
  // NOTE: req is a fetch Request object, so we use req.headers.get()
  const authHeader = req.headers.get('authorization');
  const token = getBearerToken(authHeader);

  let user: AuthUser | null = null;

  // Attempt to authenticate user if token is present
  if (token) {
    try {
      const workosUser = await verifyWorkOSToken(token);
      if (workosUser) {
        const plan = await resolveUserPlan(workosUser.userId);
        user = {
          userId: workosUser.userId,
          email: workosUser.email,
          plan,
        };
      }
    } catch {
      // Invalid token - user remains null
    }
  }

  return {
    req,
    resHeaders,
    db, // Drizzle ORM client
    user, // Authenticated user or null
  };
}

/**
 * Type of the tRPC context
 */
export type Context = Awaited<ReturnType<typeof createContext>>;
