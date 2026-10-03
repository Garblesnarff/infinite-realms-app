/**
 * Plan message/image caps (#2510; free image/voice caps originally #2159).
 * DB is forced to fail so these cases exercise the in-memory quota store,
 * not a live Postgres SUM().
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

const { AIUsageService, voiceQuotaUnits } = await import('../ai-usage-service.js');

const consume = (userId: string, plan: string, type: 'llm' | 'image' | 'voice', units = 1) =>
  AIUsageService.checkQuotaAndConsume({ userId, plan, type, units });

describe('AIUsageService plan quotas (#2510)', () => {
  it("refuses a free user's 16th message of the day", async () => {
    const userId = 'free-llm-user';
    for (let i = 0; i < 15; i += 1) {
      expect((await consume(userId, 'free', 'llm')).allowed).toBe(true);
    }
    const sixteenth = await consume(userId, 'free', 'llm');
    expect(sixteenth.allowed).toBe(false);
    expect(sixteenth.remaining).toBe(0);
  });

  it("refuses a pro user's 41st message of the day", async () => {
    const userId = 'pro-llm-user';
    for (let i = 0; i < 40; i += 1) {
      expect((await consume(userId, 'pro', 'llm')).allowed).toBe(true);
    }
    const fortyFirst = await consume(userId, 'pro', 'llm');
    expect(fortyFirst.allowed).toBe(false);
    expect(fortyFirst.remaining).toBe(0);
  });

  it('hits the free image limit on call 2 (1 a day)', async () => {
    const userId = 'free-image-user';

    const first = await consume(userId, 'free', 'image');
    const second = await consume(userId, 'free', 'image');

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    expect(second.remaining).toBe(0);
  });

  it("refuses a pro user's 3rd image of the day", async () => {
    const userId = 'pro-image-user';

    expect((await consume(userId, 'pro', 'image')).allowed).toBe(true);
    expect((await consume(userId, 'pro', 'image')).allowed).toBe(true);
    const third = await consume(userId, 'pro', 'image');
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
  });

  it('hits the voice limit on call 1 for free (voice stays 0)', async () => {
    const result = await consume('free-voice-user', 'free', 'voice');

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('reports remaining counts for messages, images and voice characters', async () => {
    const userId = 'pro-display-user';
    // Spend through the real producers' unit shapes: 1 per message/image
    // (llm.ts / images.ts), voiceQuotaUnits per voice call (tts.ts).
    await consume(userId, 'pro', 'llm');
    await consume(userId, 'pro', 'llm');
    await consume(userId, 'pro', 'image');
    // 250 characters of premium narration, charged as ceil(250/100) units.
    expect((await consume(userId, 'pro', 'voice', voiceQuotaUnits(250))).allowed).toBe(true);

    const all = await AIUsageService.getAllQuotaStatuses({ userId, plan: 'pro' });

    expect(all.quotas.llm).toEqual({ limit: 40, usage: 2, remaining: 38 });
    expect(all.quotas.image).toEqual({ limit: 2, usage: 1, remaining: 1 });
    // Voice displays in characters: stored units × VOICE_CHARS_PER_UNIT.
    // Absolute numbers pin the conversion so this test fails if the ×100
    // is dropped: 20 stored units are 2,000 characters; 3 spent units are 300.
    expect(all.quotas.voice).toEqual({
      limit: 2_000,
      usage: 300,
      remaining: 1_700,
    });
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
