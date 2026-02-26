/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as diceUtils from '../diceUtils';

import {
  detectHazard,
  interactWithHazard,
  calculateHazardDamage,
  checkHazardImmunities,
  applyHazardEffects,
} from '../environmentalHazards';

// Mock diceUtils
vi.mock('../diceUtils', () => ({
  rollDice: vi.fn(),
  rollSavingThrow: vi.fn(),
  calculateDamage: vi.fn(),
}));

describe('environmentalHazards utility', () => {
  const mockCharacter: any = {
    id: 'char-1',
    name: 'Test Hero',
    level: 1,
    abilityScores: {
      strength: { modifier: 2 },
      dexterity: { modifier: 3 },
      constitution: { modifier: 2 },
      intelligence: { modifier: 1 },
      wisdom: { modifier: 0 },
      charisma: { modifier: -1 },
    },
    skillProficiencies: ['Perception'],
    hitPoints: { current: 20, max: 20 },
  };

  const mockHazard: any = {
    id: 'hazard-1',
    name: 'Hidden Pit',
    isHidden: true,
    detectDC: 15,
    detectSkill: 'perception',
    saveDC: 12,
    saveAbility: 'dex',
    damage: {
      dice: '2d6',
      type: 'piercing',
      onFail: 'full',
      onSuccess: 'half',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('detectHazard', () => {
    it('should automatically detect unhidden hazards', () => {
      const unhiddenHazard = { ...mockHazard, isHidden: false };
      const result = detectHazard(mockCharacter, unhiddenHazard);
      expect(result.detected).toBe(true);
      expect(result.description).toContain('You notice');
    });

    it('should return false if no detection DC or skill is provided', () => {
      const noDC = { ...mockHazard, detectDC: undefined };
      const result = detectHazard(mockCharacter, noDC);
      expect(result.detected).toBe(false);
    });

    it('should detect hidden hazard on successful roll (Perception)', () => {
      (diceUtils.rollDice as any).mockReturnValue({ total: 16 });
      const result = detectHazard(mockCharacter, mockHazard);

      expect(diceUtils.rollDice).toHaveBeenCalledWith(20, 1, 2); // Wisdom 0 + Prof 2
      expect(result.detected).toBe(true);
      expect(result.rollResult).toBe(16);
    });

    it('should fail to detect hidden hazard on low roll', () => {
      (diceUtils.rollDice as any).mockReturnValue({ total: 10 });
      const result = detectHazard(mockCharacter, mockHazard);
      expect(result.detected).toBe(false);
    });

    it('should use Investigation if specified', () => {
      const investigationHazard = { ...mockHazard, detectSkill: 'investigation' };
      (diceUtils.rollDice as any).mockReturnValue({ total: 15 });
      detectHazard(mockCharacter, investigationHazard);

      // intelligence 1 + no prof = 1
      expect(diceUtils.rollDice).toHaveBeenCalledWith(20, 1, 1);
    });

    it('should use Survival if specified', () => {
      const survivalHazard = { ...mockHazard, detectSkill: 'survival' };
      (diceUtils.rollDice as any).mockReturnValue({ total: 15 });
      detectHazard(mockCharacter, survivalHazard);

      // wisdom 0 + no prof = 0
      expect(diceUtils.rollDice).toHaveBeenCalledWith(20, 1, 0);
    });

    it('should handle unknown detect skill', () => {
      const unknownSkillHazard = { ...mockHazard, detectSkill: 'unknown' as any };
      (diceUtils.rollDice as any).mockReturnValue({ total: 15 });
      detectHazard(mockCharacter, unknownSkillHazard);
      expect(diceUtils.rollDice).toHaveBeenCalledWith(20, 1, 0);
    });

    it('should correctly calculate proficiency bonus at level 1', () => {
      (diceUtils.rollDice as any).mockReturnValue({ total: 15 });
      detectHazard({ ...mockCharacter, level: 1 }, mockHazard);
      expect(diceUtils.rollDice).toHaveBeenCalledWith(20, 1, 2); // 0 + 2
    });

    it('should correctly calculate proficiency bonus at level 4 (CATCH BUG)', () => {
      (diceUtils.rollDice as any).mockReturnValue({ total: 15 });
      detectHazard({ ...mockCharacter, level: 4 }, mockHazard);
      // BUG: Level 4 should have +2 proficiency, but current code gives +3
      expect(diceUtils.rollDice).toHaveBeenCalledWith(20, 1, 2); // 0 + 2
    });

    it('should correctly calculate proficiency bonus at level 5', () => {
      (diceUtils.rollDice as any).mockReturnValue({ total: 15 });
      detectHazard({ ...mockCharacter, level: 5 }, mockHazard);
      expect(diceUtils.rollDice).toHaveBeenCalledWith(20, 1, 3); // 0 + 3
    });
  });

  describe('interactWithHazard', () => {
    it('should automatically affect if no save DC or ability', () => {
      const noSave = { ...mockHazard, saveDC: undefined };
      (diceUtils.rollDice as any).mockReturnValue({ total: 7 }); // For damage
      const result = interactWithHazard(mockCharacter, noSave);

      expect(result.saved).toBe(false);
      expect(result.damageTaken).toBe(7);
    });

    it('should return saved: true on successful saving throw (as Monk)', () => {
      const monkChar = { ...mockCharacter, class: { name: 'Monk' } };
      (diceUtils.rollSavingThrow as any).mockReturnValue({ total: 15 });
      (diceUtils.rollDice as any).mockReturnValue({ total: 10 }); // Damage

      const result = interactWithHazard(monkChar, mockHazard);

      expect(diceUtils.rollSavingThrow).toHaveBeenCalledWith(3, 2); // Dex 3 + Level 1 prof 2
      expect(result.saved).toBe(true);
      expect(result.damageTaken).toBe(5); // Half of 10
    });

    it('should return saved: true on successful saving throw (without proficiency)', () => {
      (diceUtils.rollSavingThrow as any).mockReturnValue({ total: 15 });
      (diceUtils.rollDice as any).mockReturnValue({ total: 10 }); // Damage

      const result = interactWithHazard(mockCharacter, mockHazard);

      expect(diceUtils.rollSavingThrow).toHaveBeenCalledWith(3, 0); // Dex 3 + 0 prof
      expect(result.saved).toBe(true);
    });

    it('should return saved: false on failed saving throw', () => {
      (diceUtils.rollSavingThrow as any).mockReturnValue({ total: 5 });
      (diceUtils.rollDice as any).mockReturnValue({ total: 10 }); // Damage

      const result = interactWithHazard(mockCharacter, mockHazard);

      expect(result.saved).toBe(false);
      expect(result.damageTaken).toBe(10); // Full damage
    });

    it('should apply special bonuses for Monks on Dex saves', () => {
      const monkChar = { ...mockCharacter, class: { name: 'Monk' } };
      (diceUtils.rollSavingThrow as any).mockReturnValue({ total: 15 });
      interactWithHazard(monkChar, mockHazard);

      // Dex 3 + Prof 2 (base) + Prof 2 (Monk bonus in code) = 7?
      // Wait, let's check code: saveBonus += proficiencyBonus;
      // proficiencyBonus is calculated separately.
      expect(diceUtils.rollSavingThrow).toHaveBeenCalledWith(3, 2);
      // Actually, looking at the code:
      // let saveBonus = 0;
      // if (monk && dex) saveBonus += proficiencyBonus;
      // rollSavingThrow(abilityModifier, saveBonus);
      // So dex modifier is 3, saveBonus is 2.
    });

    it('should apply special bonuses for Barbarians on Con saves', () => {
      const barbChar = { ...mockCharacter, class: { name: 'Barbarian' } };
      const conHazard = { ...mockHazard, saveAbility: 'con' };
      (diceUtils.rollSavingThrow as any).mockReturnValue({ total: 15 });
      interactWithHazard(barbChar, conHazard);

      expect(diceUtils.rollSavingThrow).toHaveBeenCalledWith(2, 2); // Con 2 + Prof 2
    });

    it('should handle other save abilities', () => {
      const intHazard = { ...mockHazard, saveAbility: 'int' };
      (diceUtils.rollSavingThrow as any).mockReturnValue({ total: 15 });
      interactWithHazard(mockCharacter, intHazard);
      expect(diceUtils.rollSavingThrow).toHaveBeenCalledWith(1, 0);

      const wisHazard = { ...mockHazard, saveAbility: 'wis' };
      interactWithHazard(mockCharacter, wisHazard);
      expect(diceUtils.rollSavingThrow).toHaveBeenCalledWith(0, 0);

      const strHazard = { ...mockHazard, saveAbility: 'str' };
      interactWithHazard(mockCharacter, strHazard);
      expect(diceUtils.rollSavingThrow).toHaveBeenCalledWith(2, 0);

      const chaHazard = { ...mockHazard, saveAbility: 'cha' };
      interactWithHazard(mockCharacter, chaHazard);
      expect(diceUtils.rollSavingThrow).toHaveBeenCalledWith(-1, 0);
    });

    it('should apply conditions on failed save', () => {
      const conditionHazard = {
        ...mockHazard,
        conditions: [{ name: 'prone', duration: 1 }],
      };
      (diceUtils.rollSavingThrow as any).mockReturnValue({ total: 5 });
      const result = interactWithHazard(mockCharacter, conditionHazard);

      expect(result.conditionsApplied).toContain('prone');
    });

    it('should apply exhaustion on failed save', () => {
      const exhaustionHazard = { ...mockHazard, exhaustionLevel: 1 };
      (diceUtils.rollSavingThrow as any).mockReturnValue({ total: 5 });
      const result = interactWithHazard(mockCharacter, exhaustionHazard);

      expect(result.exhaustionApplied).toBe(1);
    });
  });

  describe('calculateHazardDamage', () => {
    it('should return 0 if no damage info', () => {
      expect(calculateHazardDamage({ ...mockHazard, damage: undefined }, false)).toBe(0);
    });

    it('should return full damage on failed save', () => {
      (diceUtils.rollDice as any).mockReturnValue({ total: 12 });
      const damage = calculateHazardDamage(mockHazard, false);
      expect(damage).toBe(12);
    });

    it('should return half damage on failed save (if onFail: half)', () => {
      const halfOnFail = {
        ...mockHazard,
        damage: { ...mockHazard.damage, onFail: 'half' },
      };
      (diceUtils.rollDice as any).mockReturnValue({ total: 12 });
      const damage = calculateHazardDamage(halfOnFail, false);
      expect(damage).toBe(6);
    });

    it('should return half damage on successful save (if onSuccess: half)', () => {
      (diceUtils.rollDice as any).mockReturnValue({ total: 12 });
      const damage = calculateHazardDamage(mockHazard, true);
      expect(damage).toBe(6);
    });

    it('should return no damage on successful save (if onSuccess: none)', () => {
      const noneOnSuccess = {
        ...mockHazard,
        damage: { ...mockHazard.damage, onSuccess: 'none' },
      };
      (diceUtils.rollDice as any).mockReturnValue({ total: 12 });
      const damage = calculateHazardDamage(noneOnSuccess, true);
      expect(damage).toBe(0);
    });
  });

  describe('checkHazardImmunities', () => {
    it('should correctly identify immunities', () => {
      const immuneChar = { ...mockCharacter, damageImmunities: ['piercing'] };
      const result = checkHazardImmunities(immuneChar, mockHazard);
      expect(result.immune).toBe(true);
      expect(result.resistant).toBe(false);
      expect(result.vulnerable).toBe(false);
    });

    it('should correctly identify resistances', () => {
      const resistantChar = { ...mockCharacter, damageResistances: ['piercing'] };
      const result = checkHazardImmunities(resistantChar, mockHazard);
      expect(result.immune).toBe(false);
      expect(result.resistant).toBe(true);
    });

    it('should correctly identify vulnerabilities', () => {
      const vulnerableChar = { ...mockCharacter, damageVulnerabilities: ['piercing'] };
      const result = checkHazardImmunities(vulnerableChar, mockHazard);
      expect(result.vulnerable).toBe(true);
    });
  });

  describe('applyHazardEffects', () => {
    it('should reduce character HP', () => {
      const saveResult = { saved: false, damageTaken: 10 };
      const updated = applyHazardEffects(mockCharacter, mockHazard, saveResult);
      expect(updated.hitPoints.current).toBe(10);
    });

    it('should not reduce HP below 0', () => {
      const saveResult = { saved: false, damageTaken: 30 };
      const updated = applyHazardEffects(mockCharacter, mockHazard, saveResult);
      expect(updated.hitPoints.current).toBe(0);
    });

    it('should handle character without hitPoints property', () => {
      const noHPChar = { id: 'char-2', name: 'No HP' };
      const saveResult = { saved: false, damageTaken: 10 };
      const updated = applyHazardEffects(noHPChar as any, mockHazard, saveResult);
      expect(updated).toEqual(noHPChar);
    });

    it('should cover condition application block', () => {
      const saveResult = { saved: false, conditionsApplied: ['prone'] as any };
      // This block is currently a no-op but we can call it for coverage
      const updated = applyHazardEffects(mockCharacter, mockHazard, saveResult);
      expect(updated.hitPoints.current).toBe(20);
    });

    it('should cover exhaustion application block', () => {
      const saveResult = { saved: false, exhaustionApplied: 1 };
      // This block is currently a no-op but we can call it for coverage
      const updated = applyHazardEffects(mockCharacter, mockHazard, saveResult);
      expect(updated.hitPoints.current).toBe(20);
    });
  });
});
