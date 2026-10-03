/**
 * Voice quota counts characters, not calls (#2160).
 * DB is forced to fail so these cases use the in-memory store.
 * Paid limits are in units (pro 20, enterprise 2000), one unit per 100 characters (#2508).
 * Free voice stays 0 (#2178).
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

const { AIUsageService, VOICE_CHARS_PER_UNIT, voiceQuotaUnits } =
  await import('../ai-usage-service.js');

describe('voice quota character units', () => {
  it('charges ceil(characters / 100) units', () => {
    expect(VOICE_CHARS_PER_UNIT).toBe(100);
    expect(voiceQuotaUnits(1)).toBe(1);
    expect(voiceQuotaUnits(100)).toBe(1);
    expect(voiceQuotaUnits(101)).toBe(2);
    expect(voiceQuotaUnits(2500)).toBe(25);
  });

  it('sets pro and enterprise caps in units: pro 2,000 and enterprise 200,000 characters/day', async () => {
    const cases = [
      { plan: 'pro', limit: 20 },
      { plan: 'enterprise', limit: 2000 },
    ];

    for (const { plan, limit } of cases) {
      const within = await AIUsageService.checkQuotaAndConsume({
        userId: `${plan}-within`,
        plan,
        type: 'voice',
        units: limit,
      });
      const over = await AIUsageService.checkQuotaAndConsume({
        userId: `${plan}-over`,
        plan,
        type: 'voice',
        units: limit + 1,
      });

      expect(within.allowed).toBe(true);
      expect(within.remaining).toBe(0);
      expect(over.allowed).toBe(false);
    }
  });

  it('lets a pro user at 1,900 characters send a 100-character line, then refuses at 2,000', async () => {
    const userId = 'pro-chars-boundary';
    const consume = (characters: number) =>
      AIUsageService.checkQuotaAndConsume({
        userId,
        plan: 'pro',
        type: 'voice',
        units: voiceQuotaUnits(characters),
      });

    // 19 lines of 100 characters = 1,900 characters used.
    for (let i = 0; i < 19; i++) expect((await consume(100)).allowed).toBe(true);

    const last = await consume(100);
    expect(last.allowed).toBe(true);
    expect(last.remaining).toBe(0);

    const refused = await consume(100);
    expect(refused.allowed).toBe(false);
  });

  it('reports remaining voice in characters', async () => {
    const userId = 'pro-chars-display';
    await AIUsageService.checkQuotaAndConsume({
      userId,
      plan: 'pro',
      type: 'voice',
      units: voiceQuotaUnits(1_950),
    });
    // 1,950 characters in one call costs ceil(19.5) = 20 units: the whole day.
    const spent = await AIUsageService.getQuotaStatus({ userId, plan: 'pro', type: 'voice' });
    expect(spent.remainingCharacters).toBe(0);

    const fresh = await AIUsageService.getQuotaStatus({
      userId: 'pro-chars-display-fresh',
      plan: 'pro',
      type: 'voice',
    });
    expect(fresh.remainingCharacters).toBe(2_000);

    const partial = 'pro-chars-display-partial';
    await AIUsageService.checkQuotaAndConsume({
      userId: partial,
      plan: 'pro',
      type: 'voice',
      units: voiceQuotaUnits(500),
    });
    const status = await AIUsageService.getQuotaStatus({
      userId: partial,
      plan: 'pro',
      type: 'voice',
    });
    expect(status.remainingCharacters).toBe(1_500);
    expect(status.usage).toBe(5);
    expect(status.remaining).toBe(15);
    expect(status.limits.daily.voice).toBe(20);

    const image = await AIUsageService.getQuotaStatus({
      userId: partial,
      plan: 'pro',
      type: 'image',
    });
    expect(image.remainingCharacters).toBeUndefined();
  });

  it('keeps free voice at 0 after the rebase onto #2178', async () => {
    const denied = await AIUsageService.checkQuotaAndConsume({
      userId: 'free-voice-zero',
      plan: 'free',
      type: 'voice',
      units: 1,
    });
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);

    const status = await AIUsageService.getQuotaStatus({
      userId: 'free-voice-zero-status',
      plan: 'free',
      type: 'voice',
    });
    expect(status.limits.daily.voice).toBe(0);
  });
});
