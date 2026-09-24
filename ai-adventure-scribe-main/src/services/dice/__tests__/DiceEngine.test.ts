import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DiceEngine } from '../DiceEngine';

import type { Character } from '@/types/character';

import { formatRollBreakdown } from '@/features/game-session/components/dice/format-roll-breakdown';

describe('DiceEngine', () => {
  const mockCharacter: Partial<Character> = {
    level: 5, // Proficiency +3
    abilityScores: {
      strength: { score: 16, modifier: 3 },
      dexterity: { score: 14, modifier: 2 },
      constitution: { score: 12, modifier: 1 },
      intelligence: { score: 10, modifier: 0 },
      wisdom: { score: 8, modifier: -1 },
      charisma: { score: 11, modifier: 0 },
    },
  } as Character;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(new Date('2024-01-01'));
  });

  describe('roll', () => {
    it('should perform a normal d20 roll', () => {
      const result = DiceEngine.roll('1d20+5');
      expect(result.expression).toBe('1d20+5');
      expect(result.total).toBeGreaterThanOrEqual(6);
      expect(result.total).toBeLessThanOrEqual(25);
      expect(result.rolls).toHaveLength(1);
      expect(result.rolls[0].dice).toBe(20);
      expect(result.modifiers).toBe(5);
      expect(result.naturalRoll).toBe(result.rolls[0].value);
      expect(result.total).toBe(result.rolls[0].value + result.modifiers);
    });

    it('separates a 1d20+4 face from its modifier instead of reporting +0', () => {
      const result = DiceEngine.roll('1d20+4');
      expect(result.modifiers).toBe(4);
      expect(result.rolls).toHaveLength(1);
      expect(result.total).toBe((result.naturalRoll ?? 0) + 4);
    });

    it('keeps a negative modifier on the die face', () => {
      const result = DiceEngine.roll('1d20-2');
      expect(result.modifiers).toBe(-2);
      expect(result.total).toBe((result.naturalRoll ?? 0) - 2);
    });

    it('carries a subtracted dice group sign through 1d8+1d6-1d4', () => {
      const result = DiceEngine.roll('1d8+1d6-1d4');
      expect(result.rolls.map((face) => face.sign)).toEqual([1, 1, -1]);
      expect(result.rolls.map((face) => face.dice)).toEqual([8, 6, 4]);
      expect(result.modifiers).toBe(0);
      const [first, second, third] = result.rolls;
      expect(result.total).toBe(first.value + second.value - third.value);
      expect(formatRollBreakdown(result)).toBe(
        `${first.value} + ${second.value} - ${third.value} = ${result.total}`,
      );
    });

    it('should handle advantage on d20 rolls', () => {
      const result = DiceEngine.roll('1d20+5', { advantage: true });
      expect(result.expression).toBe('1d20kh1+5');
      expect(result.advantage).toBe(true);
      expect(!!result.disadvantage).toBe(false);
    });

    it('should handle disadvantage on d20 rolls', () => {
      const result = DiceEngine.roll('1d20+5', { disadvantage: true });
      expect(result.expression).toBe('1d20kl1+5');
      expect(result.disadvantage).toBe(true);
      expect(!!result.advantage).toBe(false);
    });

    it('should cancel out advantage and disadvantage', () => {
      const result = DiceEngine.roll('1d20+5', { advantage: true, disadvantage: true });
      expect(result.expression).toBe('1d20+5');
      expect(!!result.advantage).toBe(false);
      expect(!!result.disadvantage).toBe(false);
    });

    it('should preserve custom purpose and actorId', () => {
      const result = DiceEngine.roll('1d8', { purpose: 'healing', actorId: 'cleric-1' });
      expect(result.purpose).toBe('healing');
      expect(result.actorId).toBe('cleric-1');
    });

    it('should handle advantage on d20 with explicit count', () => {
      const result = DiceEngine.roll('2d20+5', { advantage: true });
      expect(result.expression).toBe('2d20kh1+5');
    });

    it('should handle advantage on d20 with modifier', () => {
      const result = DiceEngine.roll('d20-2', { advantage: true });
      expect(result.expression).toBe('1d20kh1-2');
    });
  });

  describe('findDiceExpressions', () => {
    it('should extract DICE markers from text', () => {
      const text = 'The goblin attacks! [DICE: 1d20+5 attack] and does [DICE: 2d6+3 damage]';
      const matches = DiceEngine.findDiceExpressions(text);

      expect(matches).toHaveLength(2);
      expect(matches[0].expression).toBe('1d20+5');
      expect(matches[0].purpose).toBe('attack');
      expect(matches[0].index).toBe(20);

      expect(matches[1].expression).toBe('2d6+3');
      expect(matches[1].purpose).toBe('damage');
    });

    it('should handle markers without purpose', () => {
      const text = 'Roll [DICE: 1d100]';
      const matches = DiceEngine.findDiceExpressions(text);
      expect(matches).toHaveLength(1);
      expect(matches[0].expression).toBe('1d100');
      expect(matches[0].purpose).toBeUndefined();
    });
  });

  describe('calculateCriticalDamage', () => {
    it('should double the dice count but not the modifiers', () => {
      const result = DiceEngine.calculateCriticalDamage('1d8+3');
      expect(result.expression).toBe('2d8+3');
      expect(result.purpose).toBe('critical damage');
    });

    it('should handle multiple dice types', () => {
      const result = DiceEngine.calculateCriticalDamage('2d6+1d4+2');
      expect(result.expression).toBe('4d6+2d4+2');
    });
  });

  describe('getWeaponDamageFormula', () => {
    it('should return correct formula for standard weapons using strength', () => {
      const formula = DiceEngine.getWeaponDamageFormula('longsword', mockCharacter as Character);
      expect(formula).toBe('1d8+3');
    });

    it('should handle versatile weapons (one-handed default)', () => {
      const formula = DiceEngine.getWeaponDamageFormula('staff', mockCharacter as Character);
      expect(formula).toBe('1d6+3');
    });

    it('should use dexterity for ranged weapons', () => {
      const formula = DiceEngine.getWeaponDamageFormula('shortbow', mockCharacter as Character);
      expect(formula).toBe('1d6+2');
    });

    it('should handle finesse weapons (using better of STR/DEX)', () => {
      const formula = DiceEngine.getWeaponDamageFormula('rapier', mockCharacter as Character);
      expect(formula).toBe('1d8+3'); // STR(3) > DEX(2)
    });

    it('should honor preferredAbility for finesse weapons', () => {
      const formula = DiceEngine.getWeaponDamageFormula(
        'rapier',
        mockCharacter as Character,
        'dex',
      );
      expect(formula).toBe('1d8+2');
    });

    it('should handle negative modifiers', () => {
      const weakChar = {
        abilityScores: { strength: { modifier: -2 } },
      } as Character;
      const formula = DiceEngine.getWeaponDamageFormula('club', weakChar);
      expect(formula).toBe('1d4-2');
    });

    it('should handle zero modifiers', () => {
      const avgChar = {
        abilityScores: { strength: { modifier: 0 } },
      } as Character;
      const formula = DiceEngine.getWeaponDamageFormula('club', avgChar);
      expect(formula).toBe('1d4');
    });

    it('should return default formula for unknown weapons', () => {
      const formula = DiceEngine.getWeaponDamageFormula('frying pan', mockCharacter as Character);
      expect(formula).toBe('1d6+3');
    });

    it('should return default formula using STR for unknown weapons without character', () => {
      const formula = DiceEngine.getWeaponDamageFormula('frying pan');
      expect(formula).toBe('1d6+0');
    });

    it('should handle finesse weapons without character scores', () => {
      const formula = DiceEngine.getWeaponDamageFormula('rapier');
      expect(formula).toBe('1d8');
    });
  });

  describe('createAttackRollRequest', () => {
    it('should include proficiency bonus and ability modifier', () => {
      // Level 5 (+3 prof) + STR (+3) = +6
      const request = DiceEngine.createAttackRollRequest('longsword', mockCharacter as Character);
      expect(request.formula).toBe('1d20+6');
      expect(request.purpose).toBe('Attack roll with longsword');
    });

    it('should use DEX for ranged weapons', () => {
      // Level 5 (+3 prof) + DEX (+2) = +5
      const request = DiceEngine.createAttackRollRequest('shortbow', mockCharacter as Character);
      expect(request.formula).toBe('1d20+5');
    });

    it('should use better modifier for finesse weapons', () => {
      const request = DiceEngine.createAttackRollRequest('rapier', mockCharacter as Character);
      expect(request.formula).toBe('1d20+6'); // STR(3) + Prof(3)
    });

    it('should handle finesse weapons without character scores', () => {
      const request = DiceEngine.createAttackRollRequest('rapier');
      expect(request.formula).toBe('1d20+2'); // default prof 2
    });
  });

  describe('createDamageRollRequest', () => {
    it('should create normal damage request', () => {
      const request = DiceEngine.createDamageRollRequest(
        'longsword',
        false,
        mockCharacter as Character,
      );
      expect(request.formula).toBe('1d8+3');
      expect(request.purpose).toBe('Damage roll for longsword');
    });

    it('should create critical damage request', () => {
      const request = DiceEngine.createDamageRollRequest(
        'longsword',
        true,
        mockCharacter as Character,
      );
      expect(request.formula).toBe('2d8+3');
      expect(request.purpose).toBe('Critical damage roll for longsword');
    });
  });

  describe('isCriticalHit/Miss', () => {
    it('should identify critical hit', () => {
      const mockResult = {
        naturalRoll: 20,
        rolls: [{ dice: 20, value: 20 }],
      } as unknown as Parameters<typeof DiceEngine.isCriticalHit>[0];
      expect(DiceEngine.isCriticalHit(mockResult)).toBe(true);
      expect(DiceEngine.isCriticalMiss(mockResult)).toBe(false);
    });

    it('should identify critical miss', () => {
      const mockResult = {
        naturalRoll: 1,
        rolls: [{ dice: 20, value: 1 }],
      } as unknown as Parameters<typeof DiceEngine.isCriticalMiss>[0];
      expect(DiceEngine.isCriticalHit(mockResult)).toBe(false);
      expect(DiceEngine.isCriticalMiss(mockResult)).toBe(true);
    });

    it('should return false if natural roll is not 20/1 even if some dice is', () => {
      const mockResult = {
        naturalRoll: 19,
        rolls: [
          { dice: 20, value: 19 },
          { dice: 6, value: 6 },
        ],
      } as unknown as Parameters<typeof DiceEngine.isCriticalHit>[0];
      expect(DiceEngine.isCriticalHit(mockResult)).toBe(false);
    });
  });

  describe('resolveAdvantage', () => {
    it('should return advantage when only advantage sources exist', () => {
      const sources = [{ advantage: true, source: 'vow' }];
      const result = DiceEngine.resolveAdvantage(sources);
      expect(result).toEqual({ advantage: true, disadvantage: false, canceledOut: false });
    });

    it('should return disadvantage when only disadvantage sources exist', () => {
      const sources = [{ disadvantage: true, source: 'blind' }];
      const result = DiceEngine.resolveAdvantage(sources);
      expect(result).toEqual({ advantage: false, disadvantage: true, canceledOut: false });
    });

    it('should cancel out when both exist', () => {
      const sources = [
        { advantage: true, source: 'vow' },
        { disadvantage: true, source: 'blind' },
      ];
      const result = DiceEngine.resolveAdvantage(sources);
      expect(result).toEqual({ advantage: false, disadvantage: false, canceledOut: true });
    });
  });
});
