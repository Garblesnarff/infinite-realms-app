/**
 * AI Usage Service for Bun/Elysia
 *
 * Manages AI usage quotas and consumption tracking for different plan types.
 * Uses postgres.js for database queries.
 *
 * Ported from /server/src/services/ai-usage-service.ts
 */

import { sql } from '../lib/db.js';
import { logger } from '../lib/logger.js';

export type UsageType = 'llm' | 'llm_system' | 'image' | 'voice';

export type QuotaConfig = {
  daily: Record<UsageType, number>;
};

export class AIUsageService {
  private static readonly DEFAULT_QUOTAS: Record<string, QuotaConfig> = {
    free: {
      // llm: User-initiated chat messages (30/day)
      // llm_system: Background tasks like memory extraction, world building (500/day - generous for side effects)
      daily: { llm: 30, llm_system: 500, image: 20, voice: 10 },
    },
    pro: {
      daily: { llm: 100, llm_system: 1000, image: 50, voice: 200 },
    },
    enterprise: {
      daily: { llm: 1000, llm_system: 5000, image: 500, voice: 2000 },
    },
  };

  // In-memory fallback store for development/tests
  private static readonly memTotals = new Map<string, { units: number; period: string }>();

  // Track if DB table has been initialized in this process
  private static dbInitialized = false;

  /**
   * Get quota configuration for a plan
   */
  private static getPlanQuota(plan: string): QuotaConfig {
    const p = (plan || 'free').toLowerCase();
    const quota = AIUsageService.DEFAULT_QUOTAS[p];
    return quota || AIUsageService.DEFAULT_QUOTAS['free']!;
  }

  /**
   * Generate period key for current UTC date (YYYY-MM-DD)
   */
  private static periodKey(now = new Date()): string {
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * Get reset time (next UTC midnight)
   */
  private static getResetAt(): string {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0)).toISOString();
  }

  /**
   * Check quota availability and consume units if allowed
   */
  static async checkQuotaAndConsume(opts: {
    orgId?: string | null;
    userId: string;
    plan: string;
    type: UsageType;
    units?: number;
  }): Promise<{ allowed: boolean; remaining: number; resetAt: string }> {
    const { userId, orgId, plan, type } = opts;
    const units = Math.max(1, Math.floor(opts.units ?? 1));
    const quota = AIUsageService.getPlanQuota(plan);
    const limit = quota.daily[type];
    const pkey = AIUsageService.periodKey();
    const scope = orgId || userId;
    const key = `${scope}:${type}:${pkey}`;
    const resetAt = AIUsageService.getResetAt();

    // Try Postgres
    try {
      // ⚡ Bolt: Only run CREATE TABLE once per process lifetime to remove redundant round-trip overhead.
      if (!AIUsageService.dbInitialized) {
        await sql`
          CREATE TABLE IF NOT EXISTS ai_usage (
            org_id TEXT,
            user_id TEXT,
            plan TEXT,
            type TEXT,
            units INTEGER NOT NULL,
            period_start DATE NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
          )
        `;
        AIUsageService.dbInitialized = true;
      }

      // ⚡ Bolt: Consolidated SELECT and INSERT into a single atomic query to reduce round-trips from 2 to 1.
      // This uses a subquery to verify quota availability before inserting, returning the new total on success.
      const result = await sql`
        INSERT INTO ai_usage (org_id, user_id, plan, type, units, period_start)
        SELECT ${orgId || null}, ${userId}, ${plan}, ${type}, ${units}, ${pkey}
        WHERE (
          SELECT COALESCE(SUM(units), 0)
          FROM ai_usage
          WHERE (org_id = ${orgId || null} OR user_id = ${userId})
            AND type = ${type}
            AND period_start = ${pkey}
        ) + ${units} <= ${limit}
        RETURNING (
          SELECT COALESCE(SUM(units), 0)
          FROM ai_usage
          WHERE (org_id = ${orgId || null} OR user_id = ${userId})
            AND type = ${type}
            AND period_start = ${pkey}
        ) AS total
      `;

      if (result.length > 0) {
        const usedAfter = Number(result[0].total || 0);
        return { allowed: true, remaining: Math.max(0, limit - usedAfter), resetAt };
      }

      // Quota exceeded: Fall back to a simple SELECT to get the current usage for the response
      const rows = await sql`
        SELECT COALESCE(SUM(units), 0) AS total
        FROM ai_usage
        WHERE (org_id = ${orgId || null} OR user_id = ${userId})
          AND type = ${type}
          AND period_start = ${pkey}
      `;
      const used = Number(rows?.[0]?.total || 0);
      return { allowed: false, remaining: Math.max(0, limit - used), resetAt };
    } catch (error) {
      logger.error({ msg: 'AI_USAGE_DB_ERROR', error, fallback: 'memory' });
    }

    // Memory fallback
    const cur = AIUsageService.memTotals.get(key);
    const used = cur && cur.period === pkey ? cur.units : 0;
    if (used + units > limit) {
      return { allowed: false, remaining: Math.max(0, limit - used), resetAt };
    }
    AIUsageService.memTotals.set(key, { units: used + units, period: pkey });
    const remaining = Math.max(0, limit - (used + units));
    return { allowed: true, remaining, resetAt };
  }

  /**
   * Get current quota status without consuming units
   */
  static async getQuotaStatus(opts: {
    orgId?: string | null;
    userId: string;
    plan: string;
    type: UsageType;
  }): Promise<{ plan: string; limits: { daily: Record<UsageType, number> }; usage: number; remaining: number; resetAt: string }> {
    const { userId, orgId, plan, type } = opts;
    const quota = AIUsageService.getPlanQuota(plan);
    const limit = quota.daily[type];
    const pkey = AIUsageService.periodKey();
    const scope = orgId || userId;
    const key = `${scope}:${type}:${pkey}`;
    const resetAt = AIUsageService.getResetAt();

    let used = 0;

    // Try Postgres
    try {
      const rows = await sql`
        SELECT COALESCE(SUM(units), 0) AS total
        FROM ai_usage
        WHERE (org_id = ${orgId || null} OR user_id = ${userId})
          AND type = ${type}
          AND period_start = ${pkey}
      `;
      used = Number(rows?.[0]?.total || 0);
    } catch (error) {
      logger.error({ msg: 'AI_USAGE_DB_READ_ERROR', error, fallback: 'memory' });
      // Memory fallback
      const cur = AIUsageService.memTotals.get(key);
      used = cur && cur.period === pkey ? cur.units : 0;
    }

    const remaining = Math.max(0, limit - used);
    return {
      plan,
      limits: quota,
      usage: used,
      remaining,
      resetAt,
    };
  }
}
