import { describe, it, expect } from 'vitest';

import {
  validateDMMessage,
  detectsDamageRequestOnly,
  detectsCombatStart,
  detectsInitiativeRequest,
  detectsAttackRequest,
  detectsSkillCheckOnly,
  detectsSavingThrow,
  detectsDamageRequest,
  containsAC,
  containsDC,
  containsModifier,
  extractAC,
  extractDC,
  suggestCorrection,
} from '../checks';

describe('roll-request/checks', () => {
  describe('validateDMMessage', () => {
    it('should validate a perfect attack message', () => {
      const msg =
        'Make an attack roll with your longsword (1d20+5) against AC 15. Roll 1d8+3 for damage.';
      const result = validateDMMessage(msg);
      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should catch damage without attack context', () => {
      const msg = 'Roll 2d6+3 damage.';
      const result = validateDMMessage(msg);
      expect(result.isValid).toBe(false);
      expect(result.issues[0].type).toBe('missing_attack_roll');
    });

    it('should catch attack without AC', () => {
      const msg = 'Make an attack roll.';
      const result = validateDMMessage(msg);
      expect(result.isValid).toBe(false);
      expect(result.issues[0].type).toBe('missing_ac');
    });

    it('should catch skill check without DC', () => {
      const msg = 'Make a Perception check.';
      const result = validateDMMessage(msg);
      expect(result.isValid).toBe(false);
      expect(result.issues[0].type).toBe('missing_dc');
    });

    it('should catch saving throw without DC', () => {
      const msg = 'Make a Dexterity save.';
      const result = validateDMMessage(msg);
      expect(result.isValid).toBe(false);
      expect(result.issues[0].type).toBe('missing_dc');
    });

    it('should warn about damage without modifier', () => {
      const msg = 'Make an attack roll against AC 15. Roll 1d8 damage.';
      const result = validateDMMessage(msg);
      // It's valid (no critical issues) but has a warning
      expect(result.isValid).toBe(true);
      expect(result.warnings[0].type).toBe('missing_modifier');
    });

    it('should catch combat start without initiative', () => {
      const msg = 'Combat begins! The orc rushes you.';
      const result = validateDMMessage(msg);
      expect(result.isValid).toBe(false);
      expect(result.issues[0].type).toBe('missing_initiative');
    });
  });

  describe('detection helpers', () => {
    it('detectsDamageRequestOnly', () => {
      expect(detectsDamageRequestOnly('roll 2d6 damage')).toBe(true);
      expect(detectsDamageRequestOnly('10 damage')).toBe(true);
      expect(detectsDamageRequestOnly('make an attack roll')).toBe(false);
    });

    it('detectsCombatStart', () => {
      expect(detectsCombatStart('Combat begins')).toBe(true);
      expect(detectsCombatStart('Roll for initiative')).toBe(true);
      expect(detectsCombatStart('The sun is shining')).toBe(false);
    });

    it('detectsInitiativeRequest', () => {
      expect(detectsInitiativeRequest('Roll initiative')).toBe(true);
      expect(detectsInitiativeRequest('Roll for initiative')).toBe(true);
      expect(detectsInitiativeRequest('Roll 1d20+dex')).toBe(true);
    });

    it('detectsAttackRequest', () => {
      expect(detectsAttackRequest('Make an attack roll')).toBe(true);
      expect(detectsAttackRequest('Roll to attack')).toBe(true);
      expect(detectsAttackRequest('1d20+5 to hit')).toBe(true);
    });

    it('detectsSkillCheckOnly', () => {
      expect(detectsSkillCheckOnly('Make a Perception check')).toBe(true);
      expect(detectsSkillCheckOnly('Wisdom (Insight) check')).toBe(true);
      expect(detectsSkillCheckOnly('Make an attack roll')).toBe(false);
    });

    it('detectsSavingThrow', () => {
      expect(detectsSavingThrow('Make a Wisdom save')).toBe(true);
      expect(detectsSavingThrow('Dexterity saving throw')).toBe(true);
    });

    it('detectsDamageRequest', () => {
      expect(detectsDamageRequest('Roll damage')).toBe(true);
      expect(detectsDamageRequest('2d6+3 damage')).toBe(true);
    });
  });

  describe('parameter extraction', () => {
    it('containsAC', () => {
      expect(containsAC('AC 15')).toBe(true);
      expect(containsAC('AC: 12')).toBe(true);
      expect(containsAC('armor class 18')).toBe(true);
      expect(containsAC('AC is 14')).toBe(true);
    });

    it('containsDC', () => {
      expect(containsDC('DC 15')).toBe(true);
      expect(containsDC('DC: 12')).toBe(true);
      expect(containsDC('difficulty class 18')).toBe(true);
      expect(containsDC('DC is 14')).toBe(true);
    });

    it('containsModifier', () => {
      expect(containsModifier('+STR')).toBe(true);
      expect(containsModifier('-2')).toBe(true);
      expect(containsModifier('strength modifier')).toBe(true);
    });

    it('extractAC', () => {
      expect(extractAC('The target has AC 15')).toBe(15);
      expect(extractAC('Armor Class: 18')).toBe(18);
      expect(extractAC('No AC here')).toBe(null);
    });

    it('extractDC', () => {
      expect(extractDC('It is a DC 15 check')).toBe(15);
      expect(extractDC('Difficulty Class: 12')).toBe(12);
      expect(extractDC('No DC here')).toBe(null);
    });

    it('caps oversized extracted AC and DC values', () => {
      const oversized = '7'.repeat(200);
      expect(extractAC(`The target has AC ${oversized}`)).toBe(100);
      expect(extractDC(`The target has DC ${oversized}`)).toBe(100);
    });
  });

  describe('suggestCorrection', () => {
    it('should suggest AC correction', () => {
      const msg = 'Make an attack roll.';
      const result = validateDMMessage(msg);
      const suggestion = suggestCorrection(msg, result);
      expect(suggestion).toContain('against AC [number]');
    });

    it('should suggest DC correction for checks', () => {
      const msg = 'Make a Perception check.';
      const result = validateDMMessage(msg);
      const suggestion = suggestCorrection(msg, result);
      expect(suggestion).toContain('(DC [number])');
    });

    it('should return null for valid messages', () => {
      const msg = 'Perfect message AC 15.';
      const result = validateDMMessage(msg);
      expect(suggestCorrection(msg, result)).toBe(null);
    });
  });
});
