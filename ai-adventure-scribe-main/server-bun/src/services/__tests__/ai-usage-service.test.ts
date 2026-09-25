/**
 * Free-plan image/voice caps (#2159). DB is forced to fail so these cases
 * exercise the in-memory quota store, not a live Postgres SUM().
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

const consume = (userId: string, plan: string, type: 'image' | 'voice') =>
  AIUsageService.checkQuotaAndConsume({ userId, plan, type, units: 1 });

describe('AIUsageService free-plan image and voice quotas', () => {
  it('hits the image limit on call 4 (avatar + design sheet + campaign cover still fit)', async () => {
    const userId = 'free-image-user';

    const first = await consume(userId, 'free', 'image');
    const second = await consume(userId, 'free', 'image');
    const third = await consume(userId, 'free', 'image');
    const fourth = await consume(userId, 'free', 'image');

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(true);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
  });

  it('hits the voice limit on call 1', async () => {
    const result = await consume('free-voice-user', 'free', 'voice');

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('leaves pro image and voice limits unchanged', async () => {
    const imageUser = 'pro-image-user';
    const results = [];
    for (let i = 0; i < 4; i += 1) {
      results.push(await consume(imageUser, 'pro', 'image'));
    }
    const voice = await consume('pro-voice-user', 'pro', 'voice');

    expect(results.every((row) => row.allowed)).toBe(true);
    expect(voice.allowed).toBe(true);
  });
});
