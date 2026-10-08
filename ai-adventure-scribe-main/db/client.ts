/**
 * Drizzle Database Client
 *
 * This module initializes the Drizzle ORM client with a postgres connection.
 * The client provides type-safe database queries alongside the existing Supabase client.
 *
 * Usage:
 * ```typescript
 * import { db } from '@/db/client';
 * import { blogPosts } from '@/db/schema';
 *
 * // Type-safe query
 * const posts = await db.select().from(blogPosts).where(eq(blogPosts.status, 'published'));
 * ```
 */

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index';
import { transactionContext } from './transaction-context';


// Create postgres connection
// Note: This connection is separate from Supabase's connection pool
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}

// Create the postgres client with pool configuration
const client = postgres(connectionString, {
  max: Number(process.env.PGPOOL_MAX || 25),
  idle_timeout: 20,
  connect_timeout: 10,
  max_lifetime: 60 * 30,
});

// Create Drizzle instance with schema for relational queries
const database = drizzle(client, { schema });
export const db: typeof database = new Proxy(database, {
  get: (_target, property) => {
    const current = (transactionContext.getStore()?.database ?? database) as typeof database;
    const value = Reflect.get(current, property);
    return typeof value === 'function' ? value.bind(current) : value;
  },
});

export async function withNpcActionTransaction<T>(encounterId: string, work: () => Promise<T>): Promise<T> {
  const afterCommit: Array<() => void> = [];
  const result = await database.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM combat_encounters WHERE id = ${encounterId} FOR UPDATE`);
    return transactionContext.run({ database: tx, afterCommit }, work);
  });
  for (const publish of afterCommit) publish();
  return result;
}

// Export the client for raw SQL queries if needed
export { client as pgClient };
