/**
 * Drizzle ORM Database Instance
 *
 * Creates Drizzle ORM instance using postgres.js driver.
 * Imports unified schema from /db/schema for type-safe queries.
 *
 * Pattern based on:
 * - /db/client.ts (postgres.js with Drizzle)
 * - /src/infrastructure/database/drizzle-client.ts (schema import)
 */

import { drizzle } from 'drizzle-orm/postgres-js';

import { sql } from './db.js';
import * as schema from '../../../db/schema/index';

/**
 * Drizzle database instance with unified schema
 *
 * Provides type-safe database queries with full schema support.
 *
 * Usage:
 * ```typescript
 * import { db } from '@/lib/drizzle';
 * import { campaigns } from '@/db/schema';
 * import { eq } from 'drizzle-orm';
 *
 * // Type-safe query
 * const userCampaigns = await db
 *   .select()
 *   .from(campaigns)
 *   .where(eq(campaigns.user_id, userId));
 *
 * // Insert
 * await db.insert(campaigns).values({
 *   name: 'New Campaign',
 *   user_id: userId,
 *   // ... other fields
 * });
 *
 * // Relational queries (schema includes relations)
 * const campaignWithCharacters = await db.query.campaigns.findFirst({
 *   where: eq(campaigns.id, campaignId),
 *   with: {
 *     characters: true,
 *   },
 * });
 * ```
 */
export const db = drizzle(sql, { schema });

/**
 * Type helper for Drizzle database instance
 */
export type DrizzleDb = typeof db;
