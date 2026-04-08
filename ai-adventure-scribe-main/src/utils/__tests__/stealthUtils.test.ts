/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as diceUtils from '../diceUtils';
import {
  calculateStealthBonus,
  rollStealthCheck,
  canHide,
  attemptHide,
  stopHiding,
  canRemainHidden,
  applyHiddenCondition,
  removeHiddenCondition,
  canSeeHidden,
  getStealthActionDescription
} from '../stealthUtils';

// Mock diceUtils
vi.mock('../diceUtils', () => ({
  rollDice: vi.fn(),
}));

describe('stealthUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateStealthBonus', () => {
    it('should use stealthCheckBonus if available', () => {
      const participant: any = { level: 1, conditions: [], stealthCheckBonus: 10 };
      expect(calculateStealthBonus(participant)).toBe(10);
    });

    it('should calculate correct bonus for level 1 (prof 2 + hardcoded dex 2)', () => {
      const participant: any = { level: 1, conditions: [] };
      // 2 (dex) + 2 (prof) = 4
      expect(calculateStealthBonus(participant)).toBe(4);
    });

    it('should include naturally_stealthy bonus', () => {
      const participant: any = {
        level: 1,
        conditions: [],
        racialTraits: [{ name: 'naturally_stealthy' }]
      };
      // 2 (dex) + 2 (prof) + 1 (racial) = 5
      expect(calculateStealthBonus(participant)).toBe(5);
    });

    it('should include sneak_attack bonus', () => {
      const participant: any = {
        level: 1,
        conditions: [],
        classFeatures: [{ name: 'sneak_attack' }]
      };
      // 2 (dex) + 2 (prof) + 1 (class) = 5
      expect(calculateStealthBonus(participant)).toBe(5);
    });

    it('should include finesse weapon bonus', () => {
      const participant: any = {
        level: 1,
        conditions: [],
        mainHandWeapon: { properties: { finesse: true } }
      };
      // 2 (dex) + 2 (prof) + 1 (weapon) = 5
      expect(calculateStealthBonus(participant)).toBe(5);
    });

    it('should subtract penalty for prone condition', () => {
      const participant: any = {
        level: 1,
        conditions: [{ name: 'prone' }]
      };
      // 2 (dex) + 2 (prof) - 2 (prone) = 2
      expect(calculateStealthBonus(participant)).toBe(2);
    });
  });

  describe('rollStealthCheck', () => {
    it('should call rollDice with calculated bonus', () => {
      const participant: any = { level: 1, conditions: [] };
      const mockRoll = { total: 15 };
      (diceUtils.rollDice as any).mockReturnValue(mockRoll);

      const result = rollStealthCheck(participant);

      expect(diceUtils.rollDice).toHaveBeenCalledWith(20, 1, 4);
      expect(result).toBe(mockRoll);
    });
  });

  describe('canHide', () => {
    it('should return false if already hidden', () => {
      const participant: any = { isHidden: true, conditions: [] };
      expect(canHide(participant)).toBe(false);
    });

    it('should return false if blinded', () => {
      const participant: any = { isHidden: false, conditions: [{ name: 'blinded' }] };
      expect(canHide(participant)).toBe(false);
    });

    it('should return true if obscured', () => {
      const participant: any = { isHidden: false, conditions: [], obscurement: 'lightly_obscured' };
      expect(canHide(participant)).toBe(true);
    });

    it('should return true if not obscured but has cover (currently hardcoded)', () => {
      const participant: any = { isHidden: false, conditions: [], obscurement: 'clear' };
      expect(canHide(participant)).toBe(true);
    });
  });

  describe('attemptHide', () => {
    it('should return failure if cannot hide', () => {
      const participant: any = { name: 'Grog', isHidden: true, conditions: [] };
      const result = attemptHide(participant);
      expect(result.success).toBe(false);
      expect(result.description).toContain('cannot attempt to hide');
    });

    it('should return success if roll is high enough', () => {
      const participant: any = { name: 'Vax', isHidden: false, conditions: [], level: 1 };
      (diceUtils.rollDice as any).mockReturnValue({ total: 15 });

      const result = attemptHide(participant);
      expect(result.success).toBe(true);
      expect(result.description).toContain('successfully hides');
    });

    it('should return failure if roll is too low', () => {
      const participant: any = { name: 'Vax', isHidden: false, conditions: [], level: 1 };
      (diceUtils.rollDice as any).mockReturnValue({ total: 5 });

      const result = attemptHide(participant);
      expect(result.success).toBe(false);
      expect(result.description).toContain('fails to hide');
    });
  });

  describe('stopHiding and condition helpers', () => {
    it('stopHiding should set isHidden to false', () => {
      const participant: any = { isHidden: true };
      const result = stopHiding(participant);
      expect(result.isHidden).toBe(false);
    });

    it('applyHiddenCondition should set isHidden to true', () => {
      const participant: any = { isHidden: false };
      const result = applyHiddenCondition(participant);
      expect(result.isHidden).toBe(true);
    });

    it('removeHiddenCondition should set isHidden to false', () => {
      const participant: any = { isHidden: true };
      const result = removeHiddenCondition(participant);
      expect(result.isHidden).toBe(false);
    });
  });

  describe('canRemainHidden', () => {
    it('should return false for breaking actions', () => {
      const participant: any = { isHidden: true };
      expect(canRemainHidden(participant, 'attack')).toBe(false);
      expect(canRemainHidden(participant, 'cast_spell')).toBe(false);
      expect(canRemainHidden(participant, 'move')).toBe(false);
    });

    it('should return true for non-breaking actions', () => {
      const participant: any = { isHidden: true };
      expect(canRemainHidden(participant, 'search')).toBe(true);
      expect(canRemainHidden(participant, 'dodge')).toBe(true);
    });
  });

  describe('canSeeHidden', () => {
    it('should return true if participant is not hidden', () => {
      const observer: any = { name: 'Guard' };
      const target: any = { name: 'Thief', isHidden: false };
      const result = canSeeHidden(observer, target);
      expect(result.canSee).toBe(true);
      expect(result.description).toContain('is not hidden');
    });

    it('should return true if observer has blindsight in range', () => {
      const observer: any = {
        name: 'Bat',
        visionTypes: [{ type: 'blindsight', range: 60 }]
      };
      const target: any = { name: 'Thief', isHidden: true };
      const result = canSeeHidden(observer, target, 30);
      expect(result.canSee).toBe(true);
      expect(result.description).toContain('blindsight');
    });

    it('should return true if observer has truesight in range', () => {
      const observer: any = {
        name: 'Angel',
        visionTypes: [{ type: 'truesight', range: 120 }]
      };
      const target: any = { name: 'Thief', isHidden: true };
      const result = canSeeHidden(observer, target, 60);
      expect(result.canSee).toBe(true);
      expect(result.description).toContain('truesight');
    });

    it('should use perception vs stealth if no special vision', () => {
      const observer: any = { name: 'Guard', visionTypes: [] };
      const target: any = { name: 'Thief', isHidden: true, level: 1, conditions: [] };

      // Observer rolls 15 (20, 1, 2)
      // Target rolls 10 (20, 1, 4)
      (diceUtils.rollDice as any)
        .mockReturnValueOnce({ total: 15 }) // Observer perception
        .mockReturnValueOnce({ total: 10 }); // Target stealth

      const result = canSeeHidden(observer, target);
      expect(result.canSee).toBe(true);
      expect(result.description).toContain('spots');
    });

    it('should return false if stealth beats perception', () => {
      const observer: any = { name: 'Guard', visionTypes: [] };
      const target: any = { name: 'Thief', isHidden: true, level: 1, conditions: [] };

      // Observer rolls 10
      // Target rolls 15
      (diceUtils.rollDice as any)
        .mockReturnValueOnce({ total: 10 }) // Observer perception
        .mockReturnValueOnce({ total: 15 }); // Target stealth

      const result = canSeeHidden(observer, target);
      expect(result.canSee).toBe(false);
      expect(result.description).toContain('fails to spot');
    });
  });

  describe('getStealthActionDescription', () => {
    it('should return correct description for success', () => {
      const participant: any = { name: 'Vax' };
      expect(getStealthActionDescription(participant, true)).toContain('successfully hides');
    });

    it('should return correct description for failure', () => {
      const participant: any = { name: 'Vax' };
      expect(getStealthActionDescription(participant, false)).toContain('fails to hide');
    });
  });
});
