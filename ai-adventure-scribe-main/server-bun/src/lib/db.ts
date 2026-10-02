/**
 * PostgreSQL Database Client
 *
 * Creates a singleton postgres.js client for the Bun server.
 * Uses postgres.js which is Bun-compatible and faster than pg (node-postgres).
 *
 * Pattern based on /db/client.ts
 */

import postgres from 'postgres';

import { env } from './env.js';

/**
 * Configure postgres.js client
 *
 * Options:
 * - max: Maximum number of connections in the pool
 * - ssl: SSL configuration (disabled for local development)
 */
function createClient() {
  const config: postgres.Options<Record<string, never>> = {
    max: Number(env.PGPOOL_MAX || 25),
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 60 * 30,
  };

  // Add SSL configuration if enabled
  // Note: rejectUnauthorized is false because Supabase runs locally in Docker
  // with a self-signed certificate. In a cloud Supabase deployment, the SSL
  // would use a proper certificate and rejectUnauthorized should be true.
  // This is acceptable because traffic is localhost (same server).
  if (env.PGSSL === 'true') {
    // For local Docker: self-signed cert, can't validate
    // For cloud Supabase: cert is trusted, should validate
    const isLocalSupabase =
      env.DATABASE_URL?.includes('localhost') || env.DATABASE_URL?.includes('127.0.0.1');
    config.ssl = { rejectUnauthorized: !isLocalSupabase };
  }

  return postgres(env.DATABASE_URL, config);
}

/**
 * Singleton postgres.js SQL client, created on first use. Importing this module
 * does not read the environment; the first query validates it (see lib/env.ts).
 *
 * Usage:
 * ```typescript
 * import { sql } from '@/lib/db';
 *
 * // Tagged template for safe queries
 * const users = await sql`SELECT * FROM users WHERE id = ${userId}`;
 *
 * // Transaction support
 * await sql.begin(async (sql) => {
 *   await sql`INSERT INTO ...`;
 *   await sql`UPDATE ...`;
 * });
 * ```
 */
let client: ReturnType<typeof createClient> | undefined;

export const sql: ReturnType<typeof createClient> = new Proxy(
  (() => undefined) as unknown as ReturnType<typeof createClient>,
  {
    apply: (_target, _thisArg, args) => {
      client ??= createClient();
      return Reflect.apply(client as unknown as (...a: unknown[]) => unknown, undefined, args);
    },
    get: (_target, prop) => {
      client ??= createClient();
      const value = Reflect.get(client, prop);
      return typeof value === 'function' ? value.bind(client) : value;
    },
  },
);

/**
 * Type helper for postgres.js client
 */
export type Sql = typeof sql;
