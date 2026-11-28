/**
 * Voice quota counts characters, not calls (#2160).
 * Paid limits are monthly units (#58): pro (Legend) 540 units = 54,000
 * characters = 60 premium minutes a month; tester 6,000, enterprise 60,000
 * (their old daily caps × 30). One unit is 100 characters (#2508).
 * Free voice stays 0 (#2178).
 *
 * The DB is forced to fail here. The cap assertions moved to media-quota-failure.real-db.test.ts,
 * which runs against real Postgres (#2673 step 3b). What stays: the unit conversion, the monthly
 * limits and reset date from config (no DB read), and the refusal of voice while the DB is down.
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

  // was "keeps free voice at 0 after the rebase onto #2178" (the cap part moved to the real-DB
  // suite). The DB is down here, so the answer is a refusal, not a denial from a memory count.
  it('rejects with QuotaUnavailableError when the DB is down (503 is asserted in quota-db-down.test.ts)', async () => {
    await expect(
      AIUsageService.checkQuotaAndConsume({
        userId: 'free-voice-zero',
        plan: 'free',
        type: 'voice',
        units: 1,
      }),
    ).rejects.toThrow('AI quota unavailable');
  });

  // The limits and reset below come from config, so the DB being down does
  // not matter: getQuotaStatus falls back to the memory counter (used 0).
  it('caps Legend (pro) voice at 540 units = 54,000 characters a month (#58)', async () => {
    const status = await AIUsageService.getQuotaStatus({
      userId: 'pro-voice-monthly',
      plan: 'pro',
      type: 'voice',
    });
    expect(status.limits.monthly.voice).toBe(540);
    expect(status.remaining).toBe(540);
    expect(status.remainingCharacters).toBe(54_000);
  });

  it('caps tester and enterprise voice monthly at their daily caps × 30 (#58)', async () => {
    const tester = await AIUsageService.getQuotaStatus({
      userId: 'tester-voice-monthly',
      plan: 'tester',
      type: 'voice',
    });
    expect(tester.limits.monthly.voice).toBe(6000);
    expect(tester.remainingCharacters).toBe(600_000);
    const enterprise = await AIUsageService.getQuotaStatus({
      userId: 'enterprise-voice-monthly',
      plan: 'enterprise',
      type: 'voice',
    });
    expect(enterprise.limits.monthly.voice).toBe(60000);
    expect(enterprise.remainingCharacters).toBe(6_000_000);
  });

  it('resets voice on the 1st of next month, not at midnight (#58)', async () => {
    const status = await AIUsageService.getQuotaStatus({
      userId: 'pro-voice-reset',
      plan: 'pro',
      type: 'voice',
    });
    const reset = new Date(status.resetAt);
    expect(reset.getUTCDate()).toBe(1);
    expect(reset.getUTCHours()).toBe(0);
    expect(Date.parse(status.resetAt)).toBeGreaterThan(Date.now());
    // A daily type still resets at the next UTC midnight.
    const llm = await AIUsageService.getQuotaStatus({
      userId: 'pro-llm-reset',
      plan: 'pro',
      type: 'llm',
    });
    expect(llm.resetAt.endsWith('T00:00:00.000Z')).toBe(true);
  });
});
