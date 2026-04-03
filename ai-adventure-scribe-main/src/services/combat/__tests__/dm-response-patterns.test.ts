import { describe, it, expect } from 'vitest';

import {
  detectsDirectDamage,
  detectsCombatStart,
  detectsAttackRequest,
  detectsSkillCheck,
  detectsDamageRequest,
  containsAC,
  containsDC,
  containsModifier,
} from '../dm-response-patterns';

describe('dm-response-patterns', () => {
  describe('detectsDirectDamage', () => {
    it('should detect standard dice damage formulas', () => {
      expect(detectsDirectDamage('Roll 2d6+3 for damage')).toBe(true);
      expect(detectsDirectDamage('Take 1d8 damage')).toBe(true);
      expect(detectsDirectDamage('The dragon deals 4d10+5 fire damage')).toBe(true);
    });

    it('should detect damage requests without specific dice', () => {
      expect(detectsDirectDamage('Please roll damage for your attack')).toBe(true);
    });

    it('should handle variations in spacing and case', () => {
      expect(detectsDirectDamage('ROLL   DAMAGE')).toBe(true);
      expect(detectsDirectDamage('1D12    DAMAGE')).toBe(true);
    });

    it('should detect dice formulas with subtraction', () => {
      // CURRENT BUG: This might fail because regex only looks for +
      expect(detectsDirectDamage('The weak goblin deals 1d4-1 damage')).toBe(true);
    });

    it('should detect plain numbers as damage', () => {
      // CURRENT BUG: This might fail because regex only looks for d notation
      expect(detectsDirectDamage('You take 10 damage from the fall')).toBe(true);
      expect(detectsDirectDamage('The trap deals 5 damage')).toBe(true);
    });
  });

  describe('detectsCombatStart', () => {
    it('should detect phrases that start combat', () => {
      expect(detectsCombatStart('Combat begins!')).toBe(true);
      expect(detectsCombatStart('Roll for initiative!')).toBe(true);
      expect(detectsCombatStart('Initiative! Everyone roll.')).toBe(true);
      expect(detectsCombatStart('The battle starts now.')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(detectsCombatStart('COMBAT BEGINS')).toBe(true);
      expect(detectsCombatStart('initiative')).toBe(true);
    });
  });

  describe('detectsAttackRequest', () => {
    it('should detect requests for attack rolls', () => {
      expect(detectsAttackRequest('Make an attack roll')).toBe(true);
      expect(detectsAttackRequest('Roll to attack the orc')).toBe(true);
      expect(detectsAttackRequest('Give me an attack roll')).toBe(true);
    });
  });

  describe('detectsSkillCheck', () => {
    it('should detect simple skill checks', () => {
      expect(detectsSkillCheck('Make a Perception check')).toBe(true);
      expect(detectsSkillCheck('Roll a Stealth check')).toBe(true);
      expect(detectsSkillCheck('Athletics check, please')).toBe(true);
    });

    it('should detect multi-word skill checks', () => {
      // CURRENT BUG: \w+ only matches one word
      expect(detectsSkillCheck('Make a Sleight of Hand check')).toBe(true);
      expect(detectsSkillCheck('Roll an Animal Handling check')).toBe(true);
    });

    it('should detect skill checks with ability scores in parentheses', () => {
      // CURRENT BUG: \w+ doesn't match parentheses
      expect(detectsSkillCheck('Make a Wisdom (Perception) check')).toBe(true);
      expect(detectsSkillCheck('Roll a Strength (Athletics) check')).toBe(true);
    });
  });

  describe('detectsDamageRequest', () => {
    it('should detect damage requests', () => {
      expect(detectsDamageRequest('roll damage')).toBe(true);
      expect(detectsDamageRequest('roll 2d6 for damage')).toBe(true);
    });
  });

  describe('containsAC', () => {
    it('should detect Armor Class mentions', () => {
      expect(containsAC('The orc has AC 15')).toBe(true);
      expect(containsAC('Your armor class 18 is too high')).toBe(true);
    });

    it('should handle colons and other separators', () => {
      // CURRENT BUG: \s+ doesn't match :
      expect(containsAC('AC: 12')).toBe(true);
      expect(containsAC('Armor Class: 14')).toBe(true);
    });
  });

  describe('containsDC', () => {
    it('should detect Difficulty Class mentions', () => {
      expect(containsDC('The DC is 12')).toBe(true);
      expect(containsDC('Difficulty class 15 perception check')).toBe(true);
    });

    it('should handle colons', () => {
      // CURRENT BUG: \s+ doesn't match :
      expect(containsDC('DC: 10')).toBe(true);
    });
  });

  describe('containsModifier', () => {
    it('should detect positive modifiers', () => {
      expect(containsModifier('Roll +STR')).toBe(true);
      expect(containsModifier('Add +3 to your roll')).toBe(true);
      expect(containsModifier('Bonus: +dex')).toBe(true);
    });

    it('should detect negative modifiers', () => {
      // CURRENT BUG: Regex only looks for +
      expect(containsModifier('Roll -1 for your low strength')).toBe(true);
      expect(containsModifier('Penalty: -wis')).toBe(true);
    });
  });
});
