/**
 * #2474: the `tester` plan's daily quotas. The DB is forced to fail for the limit reads, which
 * come from config and do not touch the database. The tester llm cap moved to
 * media-quota-failure.real-db.test.ts (#2673 step 3b).
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
  (await AIUsageService.getQuotaStatus({ userId: `limits-${plan}`, plan, type: 'llm' })).limits
    .daily;

describe('AIUsageService tester plan quotas (#2474)', () => {
  it('gives a tester the issue limits', async () => {
    expect(await limitsFor('tester')).toEqual({
      llm: 500,
      llm_system: 5000,
      image: 50,
      voice: 200,
    });
    expect((await limitsFor('tester')).voice).toBe(200);
    expect((await limitsFor('pro')).voice).toBe(20);
  });

  it('matches the plan name case-insensitively, like every other plan', async () => {
    expect(await limitsFor('Tester')).toEqual(await limitsFor('tester'));
  });

  it('still falls back to free for an unknown plan', async () => {
    expect(await limitsFor('platinum')).toEqual(await limitsFor('free'));
    expect((await limitsFor('platinum')).llm).toBe(15);
  });

  it('leaves free and pro limits at the #2510 values', async () => {
    expect(await limitsFor('free')).toEqual({ llm: 15, llm_system: 500, image: 1, voice: 0 });
    expect(await limitsFor('pro')).toMatchObject({ llm: 40, llm_system: 1000, image: 2 });
  });
});
