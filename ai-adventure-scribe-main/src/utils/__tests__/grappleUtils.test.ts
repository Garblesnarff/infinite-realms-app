/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  canAttemptGrapple,
  calculateGrappleDC,
  rollGrappleCheck,
  createGrappledCondition,
  canBeGrappled,
  canMaintainGrapple,
  escapeGrapple,
  getGrappleActionDescription,
} from '../grappleUtils';

import * as diceUtils from '@/utils/diceUtils';

vi.mock('@/utils/diceUtils', () => ({
  rollDice: vi.fn(),
}));

describe('grappleUtils', () => {
  let mockParticipant: any;
  let mockTarget: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockParticipant = {
      id: 'p1',
      name: 'Grappler',
      level: 5,
      conditions: [],
      abilityScores: { strength: { modifier: 4 } },
      mainHandWeapon: {
        properties: {
          twoHanded: false,
        },
      },
    };
    mockTarget = {
      id: 't1',
      name: 'Target',
      level: 5,
      conditions: [],
      abilityScores: { strength: { modifier: -1 } },
    };
  });

  describe('canAttemptGrapple', () => {
    it('should return true for a healthy participant with a one-handed weapon', () => {
      expect(canAttemptGrapple(mockParticipant)).toBe(true);
    });

    it('should return false if the participant is incapacitated', () => {
      const incapacitatedConditions = ['stunned', 'paralyzed', 'unconscious', 'petrified'];

      for (const condition of incapacitatedConditions) {
        mockParticipant.conditions = [{ name: condition }];
        expect(canAttemptGrapple(mockParticipant)).toBe(false);
      }
    });

    it('should return false if the participant has a two-handed weapon', () => {
      mockParticipant.mainHandWeapon.properties.twoHanded = true;
      expect(canAttemptGrapple(mockParticipant)).toBe(false);
    });

    it('should return true if mainHandWeapon is undefined', () => {
      delete mockParticipant.mainHandWeapon;
      expect(canAttemptGrapple(mockParticipant)).toBe(true);
    });
  });

  describe('calculateGrappleDC', () => {
    it('should calculate the correct DC based on level', () => {
      expect(calculateGrappleDC(mockParticipant)).toBe(15);

      // level 1: prof bonus is 2. base 8 + prof 2 + str 3 = 13
      mockParticipant.level = 1;
      expect(calculateGrappleDC(mockParticipant)).toBe(14);

      // level 12: prof bonus is 4. base 8 + prof 4 + str 3 = 15
      mockParticipant.level = 12;
      expect(calculateGrappleDC(mockParticipant)).toBe(16);
    });

    it('should use level 1 if level is missing', () => {
      delete mockParticipant.level;
      expect(calculateGrappleDC(mockParticipant)).toBe(14);
    });
  });

  describe('rollGrappleCheck', () => {
    it('should return success when roll is high enough', () => {
      const mockRoll = { total: 15, naturalRoll: 12 };
      (diceUtils.rollDice as any).mockReturnValue(mockRoll);

      const result = rollGrappleCheck(mockParticipant, mockTarget);

      expect(result.success).toBe(true);
      expect(result.dc).toBe(15);
      expect(result.roll).toBe(mockRoll);
      expect(diceUtils.rollDice).toHaveBeenCalledWith(20, 1, 7);
    });

    it('should return failure when roll is too low', () => {
      const mockRoll = { total: 10, naturalRoll: 4 };
      (diceUtils.rollDice as any).mockReturnValue(mockRoll);

      const result = rollGrappleCheck(mockParticipant, mockTarget);

      expect(result.success).toBe(false);
    });

    it('should use level 1 for participant if level is missing', () => {
      delete mockParticipant.level;
      const mockRoll = { total: 10, naturalRoll: 4 };
      (diceUtils.rollDice as any).mockReturnValue(mockRoll);

      rollGrappleCheck(mockParticipant, mockTarget);
      expect(diceUtils.rollDice).toHaveBeenCalledWith(20, 1, 6);
    });
  });

  describe('createGrappledCondition', () => {
    it('should create a grappled condition with correct DC', () => {
      const condition = createGrappledCondition('p1', 14);
      expect(condition.name).toBe('grappled');
      expect(condition.saveDC).toBe(14);
      expect(condition.duration).toBe(-1);
      expect(condition.saveAbility).toBe('str');
    });
  });

  describe('canBeGrappled', () => {
    it('should return true for a target that is not grappled', () => {
      expect(canBeGrappled(mockTarget)).toBe(true);
    });

    it('should return false if the target is already grappled', () => {
      mockTarget.conditions = [{ name: 'grappled' }];
      expect(canBeGrappled(mockTarget)).toBe(false);
    });
  });

  describe('canMaintainGrapple', () => {
    it('should return true if the grappler is healthy', () => {
      expect(canMaintainGrapple(mockParticipant, 't1')).toBe(true);
    });

    it('should return false if the grappler is incapacitated', () => {
      mockParticipant.conditions = [{ name: 'stunned' }];
      expect(canMaintainGrapple(mockParticipant, 't1')).toBe(false);
    });
  });

  describe('escapeGrapple', () => {
    it('should return success when escape roll is high enough', () => {
      const mockRoll = { total: 15, naturalRoll: 12 };
      (diceUtils.rollDice as any).mockReturnValue(mockRoll);

      const result = escapeGrapple(mockTarget, mockParticipant);

      expect(result.success).toBe(true);
      expect(diceUtils.rollDice).toHaveBeenCalledWith(20, 1, 2);
    });

    it('should return failure when escape roll is too low', () => {
      const mockRoll = { total: 10, naturalRoll: 4 };
      (diceUtils.rollDice as any).mockReturnValue(mockRoll);

      const result = escapeGrapple(mockTarget, mockParticipant);

      expect(result.success).toBe(false);
    });

    it('should use level 1 for target if level is missing', () => {
      delete mockTarget.level;
      const mockRoll = { total: 15, naturalRoll: 12 };
      (diceUtils.rollDice as any).mockReturnValue(mockRoll);

      escapeGrapple(mockTarget, mockParticipant);
      expect(diceUtils.rollDice).toHaveBeenCalledWith(20, 1, 1);
    });
  });

  describe('getGrappleActionDescription', () => {
    it('should return success message when success is true', () => {
      const description = getGrappleActionDescription(mockParticipant, mockTarget, true);
      expect(description).toBe('Grappler successfully grapples Target!');
    });

    it('should return failure message when success is false', () => {
      const description = getGrappleActionDescription(mockParticipant, mockTarget, false);
      expect(description).toBe('Grappler fails to grapple Target.');
    });
  });
});
