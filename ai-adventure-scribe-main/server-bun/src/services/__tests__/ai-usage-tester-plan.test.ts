/**
 * #2474: the `tester` plan's quotas. The DB is forced to fail for the limit reads, which
 * come from config and do not touch the database. The tester llm cap moved to
 * media-quota-failure.real-db.test.ts (#2673 step 3b). Voice is monthly (#58),
 * so its cap lives under `monthly`, not `daily`.
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

const limitsFor = async (plan: string) =>
  (await AIUsageService.getQuotaStatus({ userId: `limits-${plan}`, plan, type: 'llm' })).limits;

describe('AIUsageService tester plan quotas (#2474)', () => {
  it('gives a tester the issue limits', async () => {
    expect((await limitsFor('tester')).daily).toEqual({
      llm: 500,
      llm_system: 5000,
      image: 50,
    });
    expect((await limitsFor('tester')).monthly.voice).toBe(6000);
    expect((await limitsFor('pro')).monthly.voice).toBe(540);
  });

  it('matches the plan name case-insensitively, like every other plan', async () => {
    expect(await limitsFor('Tester')).toEqual(await limitsFor('tester'));
  });

  it('still falls back to free for an unknown plan', async () => {
    expect((await limitsFor('platinum')).daily).toEqual((await limitsFor('free')).daily);
    expect((await limitsFor('platinum')).daily.llm).toBe(15);
  });

  it('leaves free and pro limits at the #2510 values', async () => {
    expect((await limitsFor('free')).daily).toEqual({ llm: 15, llm_system: 500, image: 1 });
    expect((await limitsFor('free')).monthly).toEqual({ voice: 0 });
    expect((await limitsFor('pro')).daily).toMatchObject({ llm: 40, llm_system: 1000, image: 2 });
  });
});
