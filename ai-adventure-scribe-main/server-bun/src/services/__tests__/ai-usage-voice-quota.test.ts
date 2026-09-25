/**
 * Voice quota counts characters, not calls (#2160).
 * DB is forced to fail so these cases use the in-memory store.
 * Paid limits are the old per-call caps times 100 (one unit per 100 characters).
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

  it('scales pro and enterprise per-call caps by 100 characters per unit', async () => {
    const cases = [
      { plan: 'pro', limit: 200 * 100 },
      { plan: 'enterprise', limit: 2000 * 100 },
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
