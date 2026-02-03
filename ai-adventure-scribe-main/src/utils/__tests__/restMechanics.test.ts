/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as classFeatures from '../classFeatures';
import * as diceRolls from '../diceRolls';
import {
  calculateMaxHitDice,
  rollHitDice,
  recoverHitDice,
  recoverSpellSlotsShortRest,
  restoreClassFeaturesOnRest,
  recoverExhaustion,
  processShortRest,
  processLongRest,
  processShortRestCombat,
  processLongRestCombat,
} from '../restMechanics';
import * as spellManagement from '../spell-management';

vi.mock('../diceRolls', () => ({
  rollDie: vi.fn(),
}));

vi.mock('../classFeatures', () => ({
  restoreClassFeatures: vi.fn((feats, res) => ({ features: feats, resources: res })),
  getCharacterResources: vi.fn(() => ({})),
}));

vi.mock('../spell-management', () => ({
  restoreSpellSlots: vi.fn((char) => char),
}));

describe('restMechanics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateMaxHitDice', () => {
    it('should calculate hit dice for a single class character', () => {
      const character: any = {
        classLevels: [{ className: 'Fighter', level: 5 }],
      };
      // 5 / 2 = 2.5 -> floor(2.5) = 2
      expect(calculateMaxHitDice(character)).toBe(2);
    });

    it('should calculate hit dice for a multiclass character', () => {
      const character: any = {
        classLevels: [
          { className: 'Fighter', level: 5 },
          { className: 'Rogue', level: 3 },
        ],
      };
      // (5 + 3) / 2 = 4
      expect(calculateMaxHitDice(character)).toBe(4);
    });

    it('should return minimum 1 for a character with levels', () => {
      const character: any = {
        classLevels: [{ className: 'Fighter', level: 1 }],
      };
      // 1 / 2 = 0.5 -> floor(0.5) = 0, but max(1, 0) = 1
      expect(calculateMaxHitDice(character)).toBe(1);
    });

    it('should handle character with no class levels using total level', () => {
      const character: any = {
        level: 4,
        classLevels: [],
      };
      // 4 / 2 = 2
      expect(calculateMaxHitDice(character)).toBe(2);
    });

    it('should handle character with no class levels and no total level', () => {
      const character: any = {};
      expect(calculateMaxHitDice(character)).toBe(0);
    });
  });

  describe('rollHitDice', () => {
    let character: any;

    beforeEach(() => {
      character = {
        hitPoints: { current: 10, maximum: 50, temporary: 0 },
        hitDice: { total: 5, remaining: 3, type: 'd10' },
        abilityScores: {
          constitution: { modifier: 2 },
        },
      };
    });

    it('should recover hit points and reduce remaining dice', () => {
      vi.mocked(diceRolls.rollDie).mockReturnValue(5);

      const result = rollHitDice(character, 1);

      expect(result.hitPointsRecovered).toBe(7); // 5 (roll) + 2 (con) = 7
      expect(result.updatedCharacter.hitPoints.current).toBe(17);
      expect(result.updatedCharacter.hitDice.remaining).toBe(2);
    });

    it('should respect "minimum 1 HP recovered" rule', () => {
      const poorConCharacter: any = {
        ...character,
        abilityScores: { constitution: { modifier: -5 } },
      };
      vi.mocked(diceRolls.rollDie).mockReturnValue(2);

      const result = rollHitDice(poorConCharacter, 1);

      expect(result.hitPointsRecovered).toBe(1); // 2 - 5 = -3, but min is 1
      expect(result.updatedCharacter.hitPoints.current).toBe(11);
    });

    it('should not recover more than maximum HP', () => {
      const nearMaxCharacter: any = {
        ...character,
        hitPoints: { current: 48, maximum: 50, temporary: 0 },
      };
      vi.mocked(diceRolls.rollDie).mockReturnValue(10);

      const result = rollHitDice(nearMaxCharacter, 1);

      expect(result.hitPointsRecovered).toBe(12); // 10 + 2 = 12
      expect(result.updatedCharacter.hitPoints.current).toBe(50);
    });

    it('should handle rolling multiple dice', () => {
      vi.mocked(diceRolls.rollDie).mockReturnValue(5);

      const result = rollHitDice(character, 2);

      expect(result.hitPointsRecovered).toBe(14); // (5+2) + (5+2) = 14
      expect(result.updatedCharacter.hitDice.remaining).toBe(1);
    });

    it('should not roll more dice than remaining', () => {
      vi.mocked(diceRolls.rollDie).mockReturnValue(5);

      const result = rollHitDice(character, 5);

      expect(result.hitPointsRecovered).toBe(21); // 3 dice * (5+2) = 21
      expect(result.updatedCharacter.hitDice.remaining).toBe(0);
    });

    it('should return 0 recovered if no dice remain', () => {
      const noDiceCharacter: any = {
        ...character,
        hitDice: { total: 5, remaining: 0, type: 'd10' },
      };

      const result = rollHitDice(noDiceCharacter, 1);

      expect(result.hitPointsRecovered).toBe(0);
      expect(result.updatedCharacter).toEqual(noDiceCharacter);
    });

    it('should return 0 recovered if hitDice property is missing', () => {
      const noHitDicePropertyChar: any = {
        hitPoints: { current: 10, maximum: 50 },
      };
      const result = rollHitDice(noHitDicePropertyChar, 1);
      expect(result.hitPointsRecovered).toBe(0);
    });
  });

  describe('recoverHitDice', () => {
    it('should recover half of max hit dice on long rest', () => {
      const character: any = {
        classLevels: [{ level: 10 }],
        hitDice: { total: 10, remaining: 2, type: 'd10' },
      };
      // max hit dice = 10 / 2 = 5
      // remaining = 2 + 5 = 7
      const updated = recoverHitDice(character);
      expect(updated.hitDice.remaining).toBe(7);
    });

    it('should not exceed total hit dice', () => {
      const character: any = {
        classLevels: [{ level: 10 }],
        hitDice: { total: 10, remaining: 8, type: 'd10' },
      };
      // max hit dice = 5
      // 8 + 5 = 13 -> cap at 10
      const updated = recoverHitDice(character);
      expect(updated.hitDice.remaining).toBe(10);
    });

    it('should recover at least 1 hit die', () => {
      const character: any = {
        classLevels: [{ level: 1 }],
        hitDice: { total: 1, remaining: 0, type: 'd10' },
      };
      // max hit dice = 0.5 -> floor(0.5) = 0, but min 1
      const updated = recoverHitDice(character);
      expect(updated.hitDice.remaining).toBe(1);
    });

    it('should return character as is if hitDice is missing', () => {
      const character: any = { name: 'Test' };
      expect(recoverHitDice(character)).toEqual(character);
    });
  });

  describe('recoverSpellSlotsShortRest', () => {
    it('should handle Wizard Arcane Recovery', () => {
      const character: any = {
        spellSlots: {
          1: { max: 4, current: 2 },
          2: { max: 3, current: 1 },
        },
      };
      // Wizard level 5 -> max recovery level ceil(5/2) = 3
      // Should try to recover highest level possible (2)
      const updated = recoverSpellSlotsShortRest(character, 'Wizard', 5);
      expect(updated.spellSlots[2].current).toBe(2);
      expect(updated.spellSlots[1].current).toBe(2); // Level 1 remains the same
    });

    it('should handle Wizard with no spellSlots property', () => {
      const character: any = { name: 'Wizard' };
      const updated = recoverSpellSlotsShortRest(character, 'Wizard', 5);
      expect(updated).toEqual(character);
    });

    it('should handle Warlock slot recovery', () => {
      const character: any = {
        spellSlots: {
          1: { max: 2, current: 0 },
        },
      };
      vi.mocked(spellManagement.restoreSpellSlots).mockImplementation((char: any) => ({
        ...char,
        spellSlots: { 1: { max: 2, current: 2 } },
      }));

      const updated = recoverSpellSlotsShortRest(character, 'Warlock', 1);
      expect(updated.spellSlots[1].current).toBe(2);
      expect(spellManagement.restoreSpellSlots).toHaveBeenCalled();
    });

    it('should do nothing for other classes', () => {
      const character: any = {
        spellSlots: {
          1: { max: 4, current: 2 },
        },
      };
      const updated = recoverSpellSlotsShortRest(character, 'Fighter', 5);
      expect(updated).toEqual(character);
    });
  });

  describe('restoreClassFeaturesOnRest', () => {
    it('should restore class features', () => {
      const character: any = {
        classFeatures: { rage: { name: 'rage' } },
        class: { name: 'Barbarian' },
        level: 5,
      };
      const updated = restoreClassFeaturesOnRest(character, 'long');
      expect(classFeatures.restoreClassFeatures).toHaveBeenCalled();
      expect(updated).toBeDefined();
    });

    it('should return character as is if no classFeatures', () => {
      const character: any = { name: 'Test' };
      const updated = restoreClassFeaturesOnRest(character, 'short');
      expect(updated).toEqual(character);
    });
  });

  describe('recoverExhaustion', () => {
    it('should remove one level of exhaustion if character had food and water', () => {
      const character: any = {
        conditions: [{ name: 'exhaustion', level: 2 }],
      };
      const updated = recoverExhaustion(character, true);
      expect(updated.conditions[0].level).toBe(1);
    });

    it('should remove exhaustion condition if level reaches 0', () => {
      const character: any = {
        conditions: [{ name: 'exhaustion', level: 1 }],
      };
      const updated = recoverExhaustion(character, true);
      expect(updated.conditions.length).toBe(0);
    });

    it('should not remove exhaustion if character did not have food and water', () => {
      const character: any = {
        conditions: [{ name: 'exhaustion', level: 2 }],
      };
      const updated = recoverExhaustion(character, false);
      expect(updated.conditions[0].level).toBe(2);
    });

    it('should return character as is if no exhaustion condition exists', () => {
      const character: any = {
        conditions: [{ name: 'blinded' }],
      };
      const updated = recoverExhaustion(character, true);
      expect(updated).toEqual(character);
    });

    it('should return character as is if no conditions property', () => {
      const character: any = { name: 'Test' };
      const updated = recoverExhaustion(character, true);
      expect(updated).toEqual(character);
    });
  });

  describe('processShortRest', () => {
    it('should orchestrate short rest recovery', () => {
      const character: any = {
        class: { name: 'Fighter' },
        hitPoints: { current: 10, maximum: 50 },
        hitDice: { total: 5, remaining: 3, type: 'd10' },
        abilityScores: { constitution: { modifier: 2 } },
      };
      vi.mocked(diceRolls.rollDie).mockReturnValue(5);

      const result = processShortRest(character, 1);

      expect(result.hitPointsRecovered).toBe(7);
      expect(result.character.hitPoints.current).toBe(17);
    });
  });

  describe('processLongRest', () => {
    it('should recover all HP, hit dice, and spell slots', () => {
      const character: any = {
        hitPoints: { current: 10, maximum: 50 },
        hitDice: { total: 10, remaining: 2, type: 'd10' },
        classLevels: [{ level: 10 }],
        spellSlots: { 1: { max: 4, current: 0 } },
      };

      vi.mocked(spellManagement.restoreSpellSlots).mockImplementation((char: any) => ({
        ...char,
        spellSlots: { 1: { max: 4, current: 4 } },
      }));

      const result = processLongRest(character);

      expect(result.character.hitPoints.current).toBe(50);
      expect(result.character.hitDice.remaining).toBe(7); // 2 + 5
      expect(result.character.spellSlots[1].current).toBe(4);
    });

    it('should track exhaustion removal', () => {
      const character: any = {
        hitPoints: { current: 50, maximum: 50 },
        hitDice: { total: 10, remaining: 10, type: 'd10' },
        classLevels: [{ level: 10 }],
        conditions: [{ name: 'exhaustion', level: 1 }],
      };

      const result = processLongRest(character, true);
      expect(result.exhaustionRemoved).toBe(1);
    });
  });

  describe('Combat Participant Rest Functions', () => {
    it('processShortRestCombat should recover HP and reduce dice', () => {
      const participant: any = {
        maxHitPoints: 50,
        currentHitPoints: 10,
        hitDice: { max: 5, current: 3 },
      };
      vi.mocked(diceRolls.rollDie).mockReturnValue(5);

      const updated = processShortRestCombat(participant, 1);

      expect(updated.currentHitPoints).toBe(15); // 10 + 5 (no CON mod in simplified combat rest)
      expect(updated.hitDice.current).toBe(2);
    });

    it('processLongRestCombat should restore everything', () => {
      const participant: any = {
        maxHitPoints: 50,
        currentHitPoints: 10,
        hitDice: { max: 5, current: 0 },
        spellSlots: { 1: { max: 4, current: 0 } },
        actionTaken: true,
      };

      const updated = processLongRestCombat(participant);

      expect(updated.currentHitPoints).toBe(50);
      expect(updated.hitDice.current).toBe(5);
      expect(updated.spellSlots[1].current).toBe(4);
      expect(updated.actionTaken).toBe(false);
    });

    it('processLongRestCombat should handle missing hitDice and spellSlots', () => {
      const participant: any = {
        maxHitPoints: 50,
        currentHitPoints: 10,
      };

      const updated = processLongRestCombat(participant);

      expect(updated.currentHitPoints).toBe(50);
      expect(updated.hitDice).toBeUndefined();
      expect(updated.spellSlots).toBeUndefined();
    });
  });
});
