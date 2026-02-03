/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  getConditionModifiers,
  applyConditionEffects,
  removeConditionEffects,
  handleConditionSave,
  getExhaustionEffects,
  getConditionDescription,
  getConditionEffects,
  hasCondition,
  CONDITION_EFFECTS
} from '../conditionEffects';
import { d20 } from '../diceRolls';

import type { CombatParticipant, Condition, ConditionName } from '@/types/combat';

// Mock diceRolls
vi.mock('../diceRolls', () => ({
  d20: vi.fn(() => 10),
  rollDie: vi.fn((sides) => Math.floor(sides / 2)),
}));

describe('conditionEffects', () => {
  let mockParticipant: CombatParticipant;

  beforeEach(() => {
    vi.clearAllMocks();
    mockParticipant = {
      id: 'test-id',
      name: 'Test Character',
      participantType: 'player',
      maxHitPoints: 20,
      currentHitPoints: 20,
      temporaryHitPoints: 0,
      armorClass: 15,
      initiative: 10,
      speed: 30,
      actionTaken: false,
      bonusActionTaken: false,
      reactionTaken: false,
      movementUsed: 0,
      movementRemaining: 30,
      reactionOpportunities: [],
      conditions: [],
      deathSaves: { successes: 0, failures: 0 },
      damageResistances: [],
      damageImmunities: [],
      damageVulnerabilities: [],
    } as any;
  });

  describe('getConditionModifiers', () => {
    it('should return default modifiers when no conditions are present', () => {
      const modifiers = getConditionModifiers(mockParticipant, 'attack');
      expect(modifiers).toEqual({
        advantage: false,
        disadvantage: false,
        bonus: 0,
        autoFail: false,
        description: '',
      });
    });

    it('should apply blinded modifiers for attacker', () => {
      mockParticipant.conditions.push({ name: 'blinded' } as any);
      const modifiers = getConditionModifiers(mockParticipant, 'attack');
      expect(modifiers.disadvantage).toBe(true);
      expect(modifiers.description).toContain('Blind');
    });

    it('should apply blinded modifiers for target (advantage for attacker)', () => {
      // Modifiers should be fetched from the participant who has the condition
      mockParticipant.conditions.push({ name: 'blinded' } as any);
      const modifiers = getConditionModifiers(mockParticipant, 'defense');
      expect(modifiers.advantage).toBe(true);
      expect(modifiers.description).toContain('Blind');
    });

    it('should apply invisible modifiers for attacker', () => {
      mockParticipant.conditions.push({ name: 'invisible' } as any);
      const modifiers = getConditionModifiers(mockParticipant, 'attack');
      expect(modifiers.advantage).toBe(true);
      expect(modifiers.description).toContain('Invisible');
    });

    it('should apply invisible modifiers for target (disadvantage for attacker)', () => {
      mockParticipant.conditions.push({ name: 'invisible' } as any);
      const modifiers = getConditionModifiers(mockParticipant, 'defense');
      expect(modifiers.disadvantage).toBe(true);
      expect(modifiers.description).toContain('Invisible');
    });

    it('should apply frightened modifiers', () => {
      mockParticipant.conditions.push({ name: 'frightened' } as any);
      const modifiers = getConditionModifiers(mockParticipant, 'attack');
      expect(modifiers.disadvantage).toBe(true);
      expect(modifiers.description).toContain('Frightened');
    });

    it('should handle exhaustion level 1 (ability check disadvantage)', () => {
      mockParticipant.conditions.push({ name: 'exhaustion', level: 1 } as any);
      const modifiers = getConditionModifiers(mockParticipant, 'ability_check');
      expect(modifiers.disadvantage).toBe(true);
      expect(modifiers.description).toContain('Exhaustion level 1');

      const attackModifiers = getConditionModifiers(mockParticipant, 'attack');
      expect(attackModifiers.disadvantage).toBe(false);
    });

    it('should handle exhaustion level 3 (attack and save disadvantage)', () => {
      mockParticipant.conditions.push({ name: 'exhaustion', level: 3 } as any);
      const attackModifiers = getConditionModifiers(mockParticipant, 'attack');
      expect(attackModifiers.disadvantage).toBe(true);

      const saveModifiers = getConditionModifiers(mockParticipant, 'save');
      expect(saveModifiers.disadvantage).toBe(true);
    });

    it('should handle other conditions', () => {
      const conditions: ConditionName[] = [
        'charmed', 'deafened', 'incapacitated', 'paralyzed',
        'petrified', 'poisoned', 'prone', 'stunned',
        'unconscious', 'surprised'
      ];

      conditions.forEach(name => {
        mockParticipant.conditions = [{ name } as any];
        const modifiers = getConditionModifiers(mockParticipant, 'attack');
        expect(modifiers).toBeDefined();
      });
    });

    it('should handle specific condition effects', () => {
      // Charmed
      mockParticipant.conditions = [{ name: 'charmed' } as any];
      const charmedMods = getConditionModifiers(mockParticipant, 'attack', { participantType: 'player' } as any);
      expect(charmedMods.autoFail).toBe(true);

      // Deafened
      mockParticipant.conditions = [{ name: 'deafened' } as any];
      const deafenedMods = getConditionModifiers(mockParticipant, 'hearing_dependent');
      expect(deafenedMods.autoFail).toBe(true);

      // Paralyzed
      mockParticipant.conditions = [{ name: 'paralyzed' } as any];
      const paralyzedMods = getConditionModifiers(mockParticipant, 'dexterity_save');
      expect(paralyzedMods.autoFail).toBe(true);

      // Prone
      mockParticipant.conditions = [{ name: 'prone' } as any];
      const proneAttackMods = getConditionModifiers(mockParticipant, 'ranged_attack');
      expect(proneAttackMods.disadvantage).toBe(true);
    });

    it('should aggregate multiple conditions', () => {
      mockParticipant.conditions.push({ name: 'blinded' } as any);
      mockParticipant.conditions.push({ name: 'invisible' } as any);
      const modifiers = getConditionModifiers(mockParticipant, 'attack');
      expect(modifiers.advantage).toBe(true);
      expect(modifiers.disadvantage).toBe(true);
      expect(modifiers.description).toContain('Blind');
      expect(modifiers.description).toContain('Invisible');
    });
  });

  describe('applyConditionEffects', () => {
    it('should set speed to 0 for grappled', () => {
      const condition: Condition = { name: 'grappled' } as any;
      const updated = applyConditionEffects(mockParticipant, condition);
      expect(updated.movementUsed).toBe(mockParticipant.speed);
      expect(updated.conditions).toContainEqual(condition);
    });

    it('should set speed to 0 for restrained', () => {
      const condition: Condition = { name: 'restrained' } as any;
      const updated = applyConditionEffects(mockParticipant, condition);
      expect(updated.movementUsed).toBe(mockParticipant.speed);
      expect(updated.conditions).toContainEqual(condition);
    });

    it('should just add condition if no special application logic exists', () => {
      const condition: Condition = { name: 'poisoned' } as any;
      const updated = applyConditionEffects(mockParticipant, condition);
      expect(updated.conditions).toContainEqual(condition);
      expect(updated.movementUsed).toBe(0);
    });
  });

  describe('removeConditionEffects', () => {
    it('should remove condition from participant', () => {
      const condition: Condition = { name: 'poisoned' } as any;
      mockParticipant.conditions.push(condition);
      const updated = removeConditionEffects(mockParticipant, condition);
      expect(updated.conditions).not.toContainEqual(condition);
    });

    it('should call onRemove if it exists', () => {
      const condition: Condition = { name: 'blinded' } as any;
      const original = CONDITION_EFFECTS.blinded.onRemove;
      try {
        CONDITION_EFFECTS.blinded.onRemove = vi.fn((p) => p);
        removeConditionEffects(mockParticipant, condition);
        expect(CONDITION_EFFECTS.blinded.onRemove).toHaveBeenCalled();
      } finally {
        CONDITION_EFFECTS.blinded.onRemove = original;
      }
    });
  });

  describe('handleConditionSave', () => {
    it('should return success when roll + modifier >= DC', () => {
      const condition: Condition = { name: 'poisoned', saveDC: 15 } as any;
      (d20 as any).mockReturnValue(10);
      const result = handleConditionSave(mockParticipant, condition, 5);
      expect(result.success).toBe(true);
      expect(result.roll.total).toBe(15);
    });

    it('should return failure when roll + modifier < DC', () => {
      const condition: Condition = { name: 'poisoned', saveDC: 15 } as any;
      (d20 as any).mockReturnValue(9);
      const result = handleConditionSave(mockParticipant, condition, 5);
      expect(result.success).toBe(false);
      expect(result.roll.total).toBe(14);
    });

    it('should use default DC 10 if not specified', () => {
      const condition: Condition = { name: 'poisoned' } as any;
      (d20 as any).mockReturnValue(10);
      const result = handleConditionSave(mockParticipant, condition, 0);
      expect(result.success).toBe(true);
    });
  });

  describe('getExhaustionEffects', () => {
    it('should return accumulated effects for given level', () => {
      const level1 = getExhaustionEffects(1);
      expect(level1).toEqual(['Disadvantage on ability checks']);

      const level2 = getExhaustionEffects(2);
      expect(level2).toEqual(['Disadvantage on ability checks', 'Speed halved']);

      const level6 = getExhaustionEffects(6);
      expect(level6.length).toBe(6);
      expect(level6).toContain('Death');
    });
  });

  describe('Utility functions', () => {
    it('getConditionDescription should return correct description', () => {
      expect(getConditionDescription('blinded')).toContain("Can't see enemies");
      expect(getConditionDescription('unknown' as any)).toBe('Unknown condition');
    });

    it('getConditionEffects should return correct effects array', () => {
      expect(getConditionEffects('blinded')).toContain('All attacks have disadvantage');
      expect(getConditionEffects('unknown' as any)).toEqual([]);
    });

    it('hasCondition should return true if participant has condition', () => {
      mockParticipant.conditions.push({ name: 'blinded' } as any);
      expect(hasCondition(mockParticipant, 'blinded')).toBe(true);
      expect(hasCondition(mockParticipant, 'poisoned')).toBe(false);
    });
  });
});
