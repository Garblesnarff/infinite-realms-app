/**
 * Voice quota counts characters, not calls (#2160).
 * Paid limits are in units (pro 20, enterprise 2000), one unit per 100 characters (#2508).
 * Free voice stays 0 (#2178).
 *
 * The DB is forced to fail here. The cap assertions moved to media-quota-failure.real-db.test.ts,
 * which runs against real Postgres (#2673 step 3b). What stays: the unit conversion, and the
 * refusal of voice while the DB is down.
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
});
