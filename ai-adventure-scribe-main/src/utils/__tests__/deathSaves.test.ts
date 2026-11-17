/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { needsDeathSaves } from '../combat/deathSaves';

import type { CombatParticipant } from '@/types/combat';

import { combatReducer } from '@/contexts/combat/combat-reducer';

// Mock d20
vi.mock('@/utils/diceRolls', () => ({
  d20: vi.fn(),
  rollDie: vi.fn(),
}));

describe('deathSaves', () => {
  it('skips an unconscious combatant when advancing the turn', () => {
    const makeParticipant = (id: string, hp: number) => ({
      id,
      currentHitPoints: hp,
      isDead: hp <= 0,
      isUnconscious: hp <= 0,
      deathSaves: { successes: 0, failures: 0 },
      reactionOpportunities: [],
    });
    const result = combatReducer(
      {
        activeEncounter: {
          currentTurnParticipantId: 'active',
          currentRound: 1,
          participants: [
            makeParticipant('active', 10),
            makeParticipant('down', 0),
            makeParticipant('next', 8),
          ],
        },
      } as any,
      { type: 'NEXT_TURN' },
    );

    expect(result.activeEncounter?.currentTurnParticipantId).toBe('next');
  });
  let mockParticipant: CombatParticipant;

  beforeEach(() => {
    vi.clearAllMocks();
    mockParticipant = {
      id: 'test-id',
      name: 'Test Character',
      currentHitPoints: 0,
      maxHitPoints: 20,
      isStable: false,
      isDead: false,
      isUnconscious: true,
      deathSaves: { successes: 0, failures: 0 },
      conditions: [],
    } as any;
  });

  describe('needsDeathSaves', () => {
    it('should return true if HP is 0 and not stable or dead', () => {
      expect(needsDeathSaves(mockParticipant)).toBe(true);
    });

    it('should return false if HP is greater than 0', () => {
      mockParticipant.currentHitPoints = 1;
      expect(needsDeathSaves(mockParticipant)).toBe(false);
    });

    it('should return false if already stable', () => {
      mockParticipant.isStable = true;
      expect(needsDeathSaves(mockParticipant)).toBe(false);
    });

    it('should return false if already dead', () => {
      mockParticipant.isDead = true;
      expect(needsDeathSaves(mockParticipant)).toBe(false);
    });

    it('should handle missing currentHitPoints as 0', () => {
      const p = { ...mockParticipant };
      delete (p as any).currentHitPoints;
      expect(needsDeathSaves(p)).toBe(true);
    });
  });
});
