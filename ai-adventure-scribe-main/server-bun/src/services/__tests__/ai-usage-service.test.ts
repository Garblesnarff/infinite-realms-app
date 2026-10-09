/**
 * Plan message/image caps (#2510; free image/voice caps originally #2159).
 *
 * The DB is forced to fail here. Step 3b (#2673) removed the in-memory counter that used to
 * enforce caps in that case, so the cap assertions moved to media-quota-failure.real-db.test.ts,
 * which runs against real Postgres. What stays here: the display config, and the refusal while
 * the DB is down.
 */
import { describe, expect, it, mock } from 'bun:test';

const sql = Object.assign(
  async () => {
    throw new Error('no db in unit test');
  },
  {
    begin: async () => {
      throw new Error('no db in unit test');
    },
  },
);

mock.module('../../lib/db.js', () => ({ sql }));
mock.module('../../lib/logger.js', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

const { AIUsageService } = await import('../ai-usage-service.js');

const consume = (userId: string, plan: string, type: 'llm' | 'image' | 'voice', units = 1) =>
  AIUsageService.checkQuotaAndConsume({ userId, plan, type, units });

describe('AIUsageService plan quotas (#2510)', () => {
  // was "refuses a free user's 16th message of the day" (moved to the real-DB suite)
  it('rejects with QuotaUnavailableError when the DB is down (503 is asserted in quota-db-down.test.ts)', async () => {
    await expect(consume('free-llm-user', 'free', 'llm')).rejects.toThrow('AI quota unavailable');
  });

  it('shows free remaining counts from the same config', async () => {
    const all = await AIUsageService.getAllQuotaStatuses({
      userId: 'free-display-user',
      plan: 'free',
    });

    expect(all.quotas.llm).toEqual({ limit: 15, usage: 0, remaining: 15 });
    expect(all.quotas.image).toEqual({ limit: 1, usage: 0, remaining: 1 });
    expect(all.quotas.voice).toEqual({ limit: 0, usage: 0, remaining: 0 });
  });
});
