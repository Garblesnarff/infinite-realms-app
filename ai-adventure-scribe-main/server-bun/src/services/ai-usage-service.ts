/**
 * AI Usage Service for Bun/Elysia
 *
 * Manages AI usage quotas and consumption tracking for different plan types.
 * Uses postgres.js for database queries.
 *
 * Ported from /server/src/services/ai-usage-service.ts
 */

import { getModelPricing } from './model-pricing.js';
import { sql } from '../lib/db.js';
import { logger } from '../lib/logger.js';

export type UsageType = 'llm' | 'llm_system' | 'image' | 'voice';

export type QuotaConfig = {
  daily: Record<UsageType, number>;
};

export class AIUsageService {
  static async recordProviderUsage(opts: {
    userId: string;
    orgId?: string | null;
    /** The game session a DM turn belongs to (#2218), so "did the DM reply?" is one query. */
    sessionId?: string | null;
    plan: string;
    type: UsageType;
    provider: string;
    model?: string;
    inputTokens: number;
    outputTokens: number;
  }): Promise<void> {
    const model = opts.model || 'unknown';
    const pricing = getModelPricing(model);
    if (!pricing) {
      logger.warn({
        msg: 'AI_USAGE_UNKNOWN_MODEL_PRICING',
        provider: opts.provider,
        model,
      });
    }
    const inputTokens = Math.max(0, Math.floor(opts.inputTokens));
    const outputTokens = Math.max(0, Math.floor(opts.outputTokens));
    const costUsd =
      (inputTokens * (pricing?.input ?? 0) + outputTokens * (pricing?.output ?? 0)) / 1_000_000;
    const period = AIUsageService.periodKey();

    try {
      await AIUsageService.ensureTable();

      await sql`
        INSERT INTO ai_usage (
          org_id, user_id, plan, type, units, period_start,
          provider, model, input_tokens, output_tokens, total_tokens, cost_usd, session_id
        ) VALUES (
          ${opts.orgId || null}, ${opts.userId}, ${opts.plan}, ${opts.type}, 0, ${period},
          ${opts.provider}, ${model}, ${inputTokens}, ${outputTokens}, ${inputTokens + outputTokens}, ${costUsd},
          ${opts.sessionId || null}
        )
      `;
      const totals = await sql`
        SELECT COALESCE(SUM(cost_usd), 0) AS cost_usd
        FROM ai_usage WHERE user_id = ${opts.userId} AND period_start = ${period}
      `;
      logger.info({
        msg: 'AI_USAGE_DAILY_COST',
        userId: opts.userId,
        period,
        costUsd: Number(totals[0]?.cost_usd || 0),
      });
    } catch (error) {
      // Was previously swallowed with no severity guarantee: if this insert fails
      // (e.g. the ai_usage table is missing the provider/model/token/cost columns
      // it writes to) usage tracking silently stops. Always surface at >= warn.
      logger.warn({
        msg: 'AI_USAGE_DETAIL_DB_ERROR',
        error: error instanceof Error ? error.message : error,
        userId: opts.userId,
        orgId: opts.orgId || null,
        provider: opts.provider,
        model,
      });
    }
  }

  private static readonly DEFAULT_QUOTAS: Record<string, QuotaConfig> = {
    free: {
      // llm: User-initiated chat messages (30/day)
      // llm_system: Background tasks like memory extraction, world building (500/day - generous for side effects)
      // image 3: character avatar + design sheet + campaign cover still fit
      // on a free onboarding. voice 0: ElevenLabs is off; browser/Kokoro only.
      daily: { llm: 30, llm_system: 500, image: 3, voice: 0 },
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
   * Ensure the ai_usage table exists and has all columns written by both
   * recordProviderUsage() (provider/model/token/cost detail columns) and
   * checkQuotaAndConsume() (quota-only columns). Idempotent and run at most
   * once per process; safe to call from either write path.
   */
  private static async ensureTable(): Promise<void> {
    if (AIUsageService.dbInitialized) return;

    await sql`
      CREATE TABLE IF NOT EXISTS ai_usage (
        org_id TEXT,
        user_id TEXT,
        plan TEXT,
        type TEXT,
        units INTEGER NOT NULL,
        period_start DATE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        provider TEXT,
        model TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        cost_usd NUMERIC
      )
    `;

    // Patch environments where the table pre-dates the provider/model/token/cost
    // columns that recordProviderUsage() writes to. Without these, every
    // detailed-usage insert throws and used to be swallowed silently.
    await sql`ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS provider TEXT`;
    await sql`ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS model TEXT`;
    await sql`ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS input_tokens INTEGER`;
    await sql`ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS output_tokens INTEGER`;
    await sql`ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS total_tokens INTEGER`;
    await sql`ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS cost_usd NUMERIC`;
    await sql`ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS session_id TEXT`;

    AIUsageService.dbInitialized = true;
  }

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
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0),
    ).toISOString();
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
      await AIUsageService.ensureTable();

      // TOCTOU fix: the guarded INSERT...SELECT below only checks the SUM()
      // against `limit` at statement time. Under concurrency, two requests can
      // both read the same pre-insert SUM(), both pass the WHERE guard, and
      // both insert - overrunning the daily quota. Serialize per-user (scoped
      // by org when present) with a transaction-scoped Postgres advisory lock
      // so concurrent requests for the same scope queue instead of racing.
      // The lock key is built in JS (not `orgId || null` concatenated in SQL)
      // so a null orgId can't collapse the hashtext() input to SQL NULL.
      const lockScope = `${orgId || ''}:${userId}`;

      const outcome = await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtext(${lockScope}))`;

        // ⚡ Bolt: Consolidated SELECT and INSERT into a single atomic query to reduce round-trips from 2 to 1.
        // This uses a subquery to verify quota availability before inserting, returning the new total on success.
        // Now safe under concurrency because the advisory lock above serializes
        // same-scope transactions.
        const result = await tx`
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
          return { allowed: true, remaining: Math.max(0, limit - usedAfter) };
        }

        // Quota exceeded: Fall back to a simple SELECT to get the current usage for the response
        const rows = await tx`
          SELECT COALESCE(SUM(units), 0) AS total
          FROM ai_usage
          WHERE (org_id = ${orgId || null} OR user_id = ${userId})
            AND type = ${type}
            AND period_start = ${pkey}
        `;
        const used = Number(rows?.[0]?.total || 0);
        return { allowed: false, remaining: Math.max(0, limit - used) };
      });

      return { ...outcome, resetAt };
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
  }): Promise<{
    plan: string;
    limits: { daily: Record<UsageType, number> };
    usage: number;
    remaining: number;
    resetAt: string;
  }> {
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
