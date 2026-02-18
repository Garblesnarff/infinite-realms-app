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
import { logger } from '../lib/logger.js';
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
 * Resolves user's subscription plan from database or headers
 */
async function resolveUserPlan(
  userId: string,
  headers: Headers
): Promise<string> {
  // 1) Check for explicit header override (useful for tests)
  const planHeader = headers.get('x-plan');
  if (planHeader && process.env.NODE_ENV !== 'production') return planHeader.toLowerCase();

  // 2) Try to resolve from Postgres users table using shared Drizzle client
  try {
    // Using relational query with callback to avoid cross-package type conflicts
    // between local and root drizzle-orm versions
    const user = await (db.query as any).users.findFirst({
      where: (fields: any, { eq }: any) => eq(fields.id, userId),
      columns: { plan: true },
    });

    if (user?.plan) return user.plan.toLowerCase();
  } catch (error) {
    // Fall through to default, but log the error for diagnostic purposes
    logger.error({ msg: 'Failed to resolve user plan', error });
  }

  // 3) Default plan
  return 'free';
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
        const plan = await resolveUserPlan(workosUser.userId, req.headers);
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
