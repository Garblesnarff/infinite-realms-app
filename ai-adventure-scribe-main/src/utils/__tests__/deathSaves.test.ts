/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { needsDeathSaves, rollDeathSave, stabilizeParticipant } from '../combat/deathSaves';
import { combatReducer } from '@/contexts/combat/combat-reducer';

import type { CombatParticipant } from '@/types/combat';

import { d20 } from '@/utils/diceRolls';

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
    const result = combatReducer({
      activeEncounter: {
        currentTurnParticipantId: 'active',
        currentRound: 1,
        participants: [makeParticipant('active', 10), makeParticipant('down', 0), makeParticipant('next', 8)],
      },
    } as any, { type: 'NEXT_TURN' });

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

  describe('rollDeathSave', () => {
    it('should return 1 HP and become stable on natural 20', () => {
      (d20 as any).mockReturnValue(20);
      const { updatedParticipant, roll } = rollDeathSave(mockParticipant);

      expect(updatedParticipant.currentHitPoints).toBe(1);
      expect(updatedParticipant.isStable).toBe(true);
      expect(updatedParticipant.isUnconscious).toBe(false);
      expect(updatedParticipant.deathSaves).toEqual({ successes: 0, failures: 0 });
      expect(roll.naturalRoll).toBe(20);
      expect(roll.critical).toBe(true);
    });

    it('should add 2 failures on natural 1', () => {
      (d20 as any).mockReturnValue(1);
      const { updatedParticipant } = rollDeathSave(mockParticipant);

      expect(updatedParticipant.deathSaves?.failures).toBe(2);
      expect(updatedParticipant.isDead).toBe(false); // Only 2 failures
    });

    it('should add 1 success on 10-19', () => {
      (d20 as any).mockReturnValue(10);
      const { updatedParticipant } = rollDeathSave(mockParticipant);
      expect(updatedParticipant.deathSaves?.successes).toBe(1);

      (d20 as any).mockReturnValue(19);
      const { updatedParticipant: updated2 } = rollDeathSave(mockParticipant);
      expect(updated2.deathSaves?.successes).toBe(1);
    });

    it('should add 1 failure on 2-9', () => {
      (d20 as any).mockReturnValue(2);
      const { updatedParticipant } = rollDeathSave(mockParticipant);
      expect(updatedParticipant.deathSaves?.failures).toBe(1);

      (d20 as any).mockReturnValue(9);
      const { updatedParticipant: updated2 } = rollDeathSave(mockParticipant);
      expect(updated2.deathSaves?.failures).toBe(1);
    });

    it('should become stable after 3 successes', () => {
      mockParticipant.deathSaves = { successes: 2, failures: 0 };
      (d20 as any).mockReturnValue(10);

      const { updatedParticipant } = rollDeathSave(mockParticipant);
      expect(updatedParticipant.deathSaves?.successes).toBe(3);
      expect(updatedParticipant.isStable).toBe(true);
      expect(updatedParticipant.isUnconscious).toBe(true); // Still unconscious
    });

    it('should become dead after 3 failures', () => {
      mockParticipant.deathSaves = { successes: 0, failures: 2 };
      (d20 as any).mockReturnValue(5);

      const { updatedParticipant } = rollDeathSave(mockParticipant);
      expect(updatedParticipant.deathSaves?.failures).toBe(3);
      expect(updatedParticipant.isDead).toBe(true);
    });

    it('should handle natural 1 when already at 2 failures', () => {
      mockParticipant.deathSaves = { successes: 0, failures: 2 };
      (d20 as any).mockReturnValue(1);

      const { updatedParticipant } = rollDeathSave(mockParticipant);
      expect(updatedParticipant.deathSaves?.failures).toBe(4);
      expect(updatedParticipant.isDead).toBe(true);
    });

    it('should return current participant if death saves not needed', () => {
      mockParticipant.currentHitPoints = 10;
      const { updatedParticipant, roll } = rollDeathSave(mockParticipant);

      expect(updatedParticipant).toEqual(mockParticipant);
      expect(roll.total).toBe(0);
    });

    it('should handle missing deathSaves object on participant', () => {
      const p = { ...mockParticipant };
      delete p.deathSaves;
      (d20 as any).mockReturnValue(10);

      const { updatedParticipant } = rollDeathSave(p);
      expect(updatedParticipant.deathSaves?.successes).toBe(1);
    });
  });

  describe('stabilizeParticipant', () => {
    it('should set isStable to true and reset deathSaves', () => {
      mockParticipant.deathSaves = { successes: 2, failures: 1 };
      const updated = stabilizeParticipant(mockParticipant);

      expect(updated.isStable).toBe(true);
      expect(updated.deathSaves).toEqual({ successes: 0, failures: 0 });
    });
  });
});
