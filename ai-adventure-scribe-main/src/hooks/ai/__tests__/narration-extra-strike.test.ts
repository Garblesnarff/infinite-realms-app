import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  engineHitsOnPlayer,
  inventedExtraStrikeClaims,
} from '../../../../shared/narration-extra-strike';
import {
  ENEMY_HITS_PLAYER,
  FIGHT_ROSTER,
  REEVES,
  SCHOLAR,
  attackAction,
} from '../../../../shared/test-fixtures/engine-results';
import { gateInventedExtraStrike, EXTRA_STRIKE_REJECTED_REASON } from '../narration-gate';

import logger from '@/lib/logger';
import { formatCombatEngineParts } from '@/services/combat/combat-outcome-transcript';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/ai-service', () => ({
  AIService: { lastRequestId: vi.fn(() => 'req-1') },
}));

describe('narration-extra-strike', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('engineHitsOnPlayer', () => {
    it('counts one enemy HIT card as 1', () => {
      const parts = formatCombatEngineParts(
        attackAction(REEVES, SCHOLAR),
        ENEMY_HITS_PLAYER,
        FIGHT_ROSTER,
        { targetHp: true, targetMaxHp: 7 },
      );
      const cards = parts.map((p) => p.card);
      expect(engineHitsOnPlayer(cards)).toBe(1);
    });
  });

  describe('inventedExtraStrikeClaims', () => {
    it('flags "A second strike lands across your ribs"', () => {
      const claims = inventedExtraStrikeClaims('A second strike lands across your ribs.', 1);
      expect(claims.length).toBe(1);
    });

    it('flags "The goblin hits you again"', () => {
      const claims = inventedExtraStrikeClaims('The goblin hits you again.', 1);
      expect(claims.length).toBe(1);
    });

    it('does not flag clean prose', () => {
      const claims = inventedExtraStrikeClaims('The goblin snarls and circles.', 1);
      expect(claims.length).toBe(0);
    });

    it('does not flag negated prose', () => {
      const claims = inventedExtraStrikeClaims(
        'Before a second strike can land, you step back.',
        1,
      );
      expect(claims.length).toBe(0);
      const claims2 = inventedExtraStrikeClaims('No second blow lands.', 1);
      expect(claims2.length).toBe(0);
      const claims3 = inventedExtraStrikeClaims('The goblin fails to land a second blow.', 1);
      expect(claims3.length).toBe(0);
      const claims4 = inventedExtraStrikeClaims(
        'He would have landed a second strike, but you parry.',
        1,
      );
      expect(claims4.length).toBe(0);
    });

    it('returns empty when engineHits >= 2', () => {
      const claims = inventedExtraStrikeClaims('A second strike lands across your ribs.', 2);
      expect(claims.length).toBe(0);
    });
  });

  describe('gateInventedExtraStrike', () => {
    it('regenerates once with the note and returns the clean retry', async () => {
      const retry = { text: 'The goblin snarls at you from behind its shield.' };
      const regenerate = vi.fn().mockResolvedValue(retry);
      const narration = { text: 'A second strike lands across your ribs.' };

      const result = await gateInventedExtraStrike({
        narration,
        engineHits: 1,
        sessionId: 's1',
        encounterId: 'e1',
        regenerate,
      });

      expect(regenerate).toHaveBeenCalledTimes(1);
      const violation = regenerate.mock.calls[0][0] as string;
      expect(violation).toContain('engine resolved exactly 1 hit(s) on the player');
      expect(violation).toContain('No second strike landed');
      expect(result).toBe(retry);
      expect(logger.warn).toHaveBeenCalledWith(
        'DM_NARRATION_REJECTED',
        expect.objectContaining({
          reason: EXTRA_STRIKE_REJECTED_REASON,
          attempt: 1,
          claims: expect.arrayContaining([expect.stringMatching(/second strike/i)]),
        }),
      );
    });

    it('strips the sentence on a repeat and logs attempt 2', async () => {
      const retryText = 'A second strike lands across your ribs. The goblin spits in frustration.';
      const regenerate = vi.fn().mockResolvedValue({ text: retryText });
      const narration = { text: 'A second strike lands across your ribs.' };

      const result = await gateInventedExtraStrike({
        narration,
        engineHits: 1,
        sessionId: 's1',
        encounterId: 'e1',
        regenerate,
      });

      expect(regenerate).toHaveBeenCalledTimes(1);
      expect(result.text).not.toContain('second strike');
      expect(result.text).toContain('spits in frustration');
      expect(logger.warn).toHaveBeenLastCalledWith(
        'DM_NARRATION_REJECTED',
        expect.objectContaining({
          reason: EXTRA_STRIKE_REJECTED_REASON,
          attempt: 2,
        }),
      );
    });

    it('passes clean prose through', async () => {
      const narration = { text: 'The goblin circles warily.' };
      const regenerate = vi.fn();
      const result = await gateInventedExtraStrike({
        narration,
        engineHits: 1,
        sessionId: 's1',
        encounterId: 'e1',
        regenerate,
      });
      expect(regenerate).not.toHaveBeenCalled();
      expect(result).toBe(narration);
    });
  });
});
