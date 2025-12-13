/**
 * tRPC Context for Elysia/Bun
 *
 * Creates the context for each tRPC request, including:
 * - Authenticated user information from WorkOS tokens
 * - Drizzle database client for type-safe queries
 * - Request object from Elysia/Fetch API
 *
 * The context is available in all tRPC procedures and middleware.
 *
 * Ported from /server/src/trpc/context.ts for Elysia/Bun compatibility.
 */

import { db } from '../lib/drizzle.js';
import { getBearerToken } from '../lib/jwt.js';
import { verifyWorkOSToken } from '../services/workos.js';
import { Pool } from 'pg';

/**
 * Authenticated user payload extracted from WorkOS token
 */
export interface AuthUser {
  userId: string;
  email?: string;
  plan: string;
}

/**
 * Create PostgreSQL client for plan resolution
 */
function createPgClient(): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
    max: Number(process.env.PGPOOL_MAX || 10),
  });
}

/**
 * Resolves user's subscription plan from database or headers
 */
async function resolveUserPlan(
  userId: string,
  headers: Record<string, string | undefined>
): Promise<string> {
  // 1) Check for explicit header override (useful for tests)
  const planHeader = headers['x-plan'];
  const hdr = planHeader?.toLowerCase();
  if (hdr) return hdr;

  // 2) Try to resolve from Postgres users table
  try {
    if (process.env.DATABASE_URL) {
      const pgClient = createPgClient();
      const client = await pgClient.connect();
      try {
        const { rows } = await client.query(
          'SELECT plan FROM users WHERE id = $1 LIMIT 1',
          [userId]
        );
        if (rows?.[0]?.plan) return String(rows[0].plan).toLowerCase();
      } finally {
        try {
          client.release();
        } catch {
          // Ignore release errors
        }
        try {
          await pgClient.end();
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  } catch {
    // Fall through to default
  }

  // 3) Default plan
  return 'free';
}

/**
 * Context creation options for Elysia/Fetch adapter
 * Uses standard Fetch API Request/Response
 */
export interface CreateContextOptions {
  req: Request;
  resHeaders: Headers;
}

/**
 * Creates context for tRPC requests
 * Extracts and validates WorkOS auth token if present
 *
 * Compatible with @elysiajs/trpc plugin
 */
export async function createContext({ req, resHeaders }: CreateContextOptions) {
  // Extract bearer token from Authorization header
  const authHeader = req.headers.get('authorization');
  const token = getBearerToken(authHeader);

  let user: AuthUser | null = null;

  // Attempt to authenticate user if token is present
  if (token) {
    try {
      const workosUser = await verifyWorkOSToken(token);
      if (workosUser) {
        // Convert Headers to plain object for resolveUserPlan
        const headersObj: Record<string, string | undefined> = {};
        req.headers.forEach((value, key) => {
          headersObj[key] = value;
        });

        const plan = await resolveUserPlan(workosUser.userId, headersObj);
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
