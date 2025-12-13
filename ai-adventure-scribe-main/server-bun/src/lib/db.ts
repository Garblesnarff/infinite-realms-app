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
const config: postgres.Options<{}> = {
  max: Number(env.PGPOOL_MAX || 10),
};

// Add SSL configuration if enabled
if (env.PGSSL === 'true') {
  config.ssl = { rejectUnauthorized: false };
}

/**
 * Singleton postgres.js SQL client
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
export const sql = postgres(env.DATABASE_URL, config);

/**
 * Type helper for postgres.js client
 */
export type Sql = typeof sql;
