/**
 * User subscription plan resolution.
 *
 * Split out of lib/auth.js: routes that need a fail-closed plan lookup import
 * from here, because tests mock lib/auth.js wholesale and a new named import
 * from it would break every such mock (the mock lacks the export).
 */

import { sql } from './db.js';
import { logger } from './logger.js';
import { UserPlanCache } from './user-plan-cache.js';

/**
 * Resolve user's subscription plan from database, failing closed on a DB error.
 *
 * Unlike resolveUserPlan, a database error is thrown, never silently 'free' —
 * callers that must not serve a wrong plan (GET /v1/llm/quota, #1344) use this
 * so a DB blip surfaces as a 503 instead of a Free gate. A missing users row
 * is not an error and still resolves to 'free'.
 */
export async function resolveUserPlanStrict(userId: string): Promise<string> {
  // ⚡ Bolt: Check in-memory cache first to avoid redundant O(1) query per request
  const cachedPlan = UserPlanCache.get(userId);
  if (cachedPlan) return cachedPlan;

  const rows = await sql`SELECT plan FROM users WHERE id = ${userId} LIMIT 1`;
  if (rows?.[0]?.plan) {
    const plan = String(rows[0].plan).toLowerCase();
    // ⚡ Bolt: Cache the result for 5 minutes
    UserPlanCache.set(userId, plan);
    return plan;
  }
  return 'free';
}

/**
 * Resolve user's subscription plan from database.
 *
 * Lenient: a database error logs a warning and resolves to 'free', as before.
 * Callers that must fail closed on a lookup error use resolveUserPlanStrict.
 */
export async function resolveUserPlan(userId: string): Promise<string> {
  try {
    return await resolveUserPlanStrict(userId);
  } catch (e) {
    logger.warn({ error: e }, 'Failed to resolve user plan from database:');
    return 'free';
  }
}
