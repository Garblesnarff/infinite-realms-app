import { describe, it, expect } from 'vitest';

import {
  getExhaustionLevel,
  applyExhaustion,
  addExhaustionLevel,
  removeExhaustionLevel,
  hasDisadvantageOnAbilityChecks,
  hasSpeedHalved,
  hasDisadvantageOnAttacksAndSaves,
  hasHitPointMaxHalved,
  hasSpeedReducedToZero,
  shouldDieFromExhaustion,
  getModifiedHitPointMax,
  processLongRestExhaustionRecovery,
  getExhaustionDescription,
  getActiveExhaustionEffects
} from '../exhaustionUtils';

import type { CombatParticipant, Condition } from '@/types/combat';

describe('exhaustionUtils', () => {
  const mockParticipant: CombatParticipant = {
    id: 'test-id',
    name: 'Test Character',
    participantType: 'player',
    maxHitPoints: 100,
    currentHitPoints: 100,
    temporaryHitPoints: 0,
    armorClass: 15,
    initiative: 10,
    speed: 30,
    actionTaken: false,
    bonusActionTaken: false,
    reactionTaken: false,
    movementUsed: 0,
    movementRemaining: 30,
    conditions: [],
    deathSaves: { successes: 0, failures: 0 },
    reactionOpportunities: [],
    damageResistances: [],
    damageImmunities: [],
    damageVulnerabilities: []
  };

  describe('getExhaustionLevel', () => {
    it('should return 0 when no exhaustion condition is present', () => {
      expect(getExhaustionLevel([])).toBe(0);
      expect(getExhaustionLevel(mockParticipant.conditions)).toBe(0);
    });

    it('should return the correct level when exhaustion condition is present', () => {
      const conditions: Condition[] = [
        { name: 'exhaustion', level: 3, description: 'Level 3', duration: -1 }
      ];
      expect(getExhaustionLevel(conditions)).toBe(3);
    });
  });

  describe('applyExhaustion', () => {
    it('should add exhaustion condition if not present', () => {
      const result = applyExhaustion(mockParticipant, 1);
      expect(getExhaustionLevel(result.conditions)).toBe(1);
      expect(result.conditions.some(c => c.name === 'exhaustion')).toBe(true);
    });

    it('should update exhaustion level if already present', () => {
      const participantWithExhaustion = applyExhaustion(mockParticipant, 1);
      const result = applyExhaustion(participantWithExhaustion, 2);
      expect(getExhaustionLevel(result.conditions)).toBe(2);
    });

    it('should remove exhaustion condition if level set to 0', () => {
      const participantWithExhaustion = applyExhaustion(mockParticipant, 1);
      const result = applyExhaustion(participantWithExhaustion, 0);
      expect(getExhaustionLevel(result.conditions)).toBe(0);
      expect(result.conditions.some(c => c.name === 'exhaustion')).toBe(false);
    });

    it('should clamp exhaustion level between 0 and 6', () => {
      const highLevel = applyExhaustion(mockParticipant, 10);
      expect(getExhaustionLevel(highLevel.conditions)).toBe(6);

      const lowLevel = applyExhaustion(mockParticipant, -5);
      expect(getExhaustionLevel(lowLevel.conditions)).toBe(0);
    });
  });

  describe('addExhaustionLevel', () => {
    it('should increment exhaustion level', () => {
      let participant = addExhaustionLevel(mockParticipant);
      expect(getExhaustionLevel(participant.conditions)).toBe(1);

      participant = addExhaustionLevel(participant);
      expect(getExhaustionLevel(participant.conditions)).toBe(2);
    });

    it('should not exceed level 6', () => {
      let participant = applyExhaustion(mockParticipant, 6);
      participant = addExhaustionLevel(participant);
      expect(getExhaustionLevel(participant.conditions)).toBe(6);
    });
  });

  describe('removeExhaustionLevel', () => {
    it('should decrement exhaustion level', () => {
      let participant = applyExhaustion(mockParticipant, 2);
      participant = removeExhaustionLevel(participant);
      expect(getExhaustionLevel(participant.conditions)).toBe(1);
    });

    it('should remove condition when decrementing from level 1', () => {
      let participant = applyExhaustion(mockParticipant, 1);
      participant = removeExhaustionLevel(participant);
      expect(getExhaustionLevel(participant.conditions)).toBe(0);
      expect(participant.conditions.some(c => c.name === 'exhaustion')).toBe(false);
    });

    it('should not go below level 0', () => {
      const participant = removeExhaustionLevel(mockParticipant);
      expect(getExhaustionLevel(participant.conditions)).toBe(0);
    });
  });

  describe('Exhaustion Effects', () => {
    it('should identify disadvantage on ability checks starting at level 1', () => {
      expect(hasDisadvantageOnAbilityChecks(mockParticipant)).toBe(false);
      expect(hasDisadvantageOnAbilityChecks(applyExhaustion(mockParticipant, 1))).toBe(true);
      expect(hasDisadvantageOnAbilityChecks(applyExhaustion(mockParticipant, 6))).toBe(true);
    });

    it('should identify speed halved starting at level 2', () => {
      expect(hasSpeedHalved(applyExhaustion(mockParticipant, 1))).toBe(false);
      expect(hasSpeedHalved(applyExhaustion(mockParticipant, 2))).toBe(true);
      expect(hasSpeedHalved(applyExhaustion(mockParticipant, 6))).toBe(true);
    });

    it('should identify disadvantage on attacks and saves starting at level 3', () => {
      expect(hasDisadvantageOnAttacksAndSaves(applyExhaustion(mockParticipant, 2))).toBe(false);
      expect(hasDisadvantageOnAttacksAndSaves(applyExhaustion(mockParticipant, 3))).toBe(true);
      expect(hasDisadvantageOnAttacksAndSaves(applyExhaustion(mockParticipant, 6))).toBe(true);
    });

    it('should identify HP max halved starting at level 4', () => {
      expect(hasHitPointMaxHalved(applyExhaustion(mockParticipant, 3))).toBe(false);
      expect(hasHitPointMaxHalved(applyExhaustion(mockParticipant, 4))).toBe(true);
      expect(hasHitPointMaxHalved(applyExhaustion(mockParticipant, 6))).toBe(true);
    });

    it('should identify speed reduced to zero starting at level 5', () => {
      expect(hasSpeedReducedToZero(applyExhaustion(mockParticipant, 4))).toBe(false);
      expect(hasSpeedReducedToZero(applyExhaustion(mockParticipant, 5))).toBe(true);
      expect(hasSpeedReducedToZero(applyExhaustion(mockParticipant, 6))).toBe(true);
    });

    it('should identify death starting at level 6', () => {
      expect(shouldDieFromExhaustion(applyExhaustion(mockParticipant, 5))).toBe(false);
      expect(shouldDieFromExhaustion(applyExhaustion(mockParticipant, 6))).toBe(true);
    });
  });

  describe('getModifiedHitPointMax', () => {
    it('should return full HP when level < 4', () => {
      const participant = applyExhaustion(mockParticipant, 3);
      expect(getModifiedHitPointMax(participant)).toBe(100);
    });

    it('should return halved HP when level >= 4', () => {
      const participant = applyExhaustion(mockParticipant, 4);
      expect(getModifiedHitPointMax(participant)).toBe(50);

      const oddHPParticipant = { ...mockParticipant, maxHitPoints: 11 };
      const exhaustedOddHP = applyExhaustion(oddHPParticipant, 4);
      expect(getModifiedHitPointMax(exhaustedOddHP)).toBe(5); // Math.floor(11/2)
    });
  });

  describe('processLongRestExhaustionRecovery', () => {
    it('should reduce exhaustion level by 1 if had food and drink', () => {
      const exhausted = applyExhaustion(mockParticipant, 2);
      const result = processLongRestExhaustionRecovery(exhausted, true);
      expect(getExhaustionLevel(result.conditions)).toBe(1);
    });

    it('should not reduce exhaustion level if missing food and drink', () => {
      const exhausted = applyExhaustion(mockParticipant, 2);
      const result = processLongRestExhaustionRecovery(exhausted, false);
      expect(getExhaustionLevel(result.conditions)).toBe(2);
    });

    it('should default to having food and drink', () => {
      const exhausted = applyExhaustion(mockParticipant, 2);
      const result = processLongRestExhaustionRecovery(exhausted);
      expect(getExhaustionLevel(result.conditions)).toBe(1);
    });
  });

  describe('getExhaustionDescription', () => {
    it('should return descriptions for valid levels', () => {
      expect(getExhaustionDescription(1)).toBe('Disadvantage on ability checks');
      expect(getExhaustionDescription(6)).toBe('Death');
    });

    it('should return "No exhaustion" for invalid levels', () => {
      expect(getExhaustionDescription(0)).toBe('No exhaustion');
      expect(getExhaustionDescription(7)).toBe('No exhaustion');
    });
  });

  describe('getActiveExhaustionEffects', () => {
    it('should return null if no exhaustion', () => {
      expect(getActiveExhaustionEffects(mockParticipant)).toBeNull();
    });

    it('should return effect object for valid level', () => {
      const exhausted = applyExhaustion(mockParticipant, 1);
      const effects = getActiveExhaustionEffects(exhausted);
      expect(effects).not.toBeNull();
      expect(effects?.level).toBe(1);
      expect(effects?.effect.disadvantageOnAbilityChecks).toBe(true);
    });
  });
});
