/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  calculateMovementCost,
  canMoveToPosition,
  doesMovementProvokeOpportunityAttacks,
  processMovementAction
} from '../movementUtils';

import { checkMovementOpportunityAttacks } from '@/utils/reactionTriggers';

vi.mock('@/utils/reactionTriggers', () => ({
  checkMovementOpportunityAttacks: vi.fn()
}));

describe('movementUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateMovementCost', () => {
    it('should calculate base cost for melee to adjacent', () => {
      expect(calculateMovementCost('melee', 'adjacent', 'clear')).toBe(5);
    });

    it('should calculate base cost for adjacent to ranged', () => {
      expect(calculateMovementCost('adjacent', 'ranged', 'clear')).toBe(10);
    });

    it('should calculate base cost for ranged to distant', () => {
      expect(calculateMovementCost('ranged', 'distant', 'clear')).toBe(15);
    });

    it('should apply difficult terrain multiplier', () => {
      expect(calculateMovementCost('melee', 'adjacent', 'difficult')).toBe(10);
    });

    it('should apply rough terrain multiplier', () => {
      expect(calculateMovementCost('melee', 'adjacent', 'rough')).toBe(7.5);
    });

    it('should return 0 for unknown transitions', () => {
      expect(calculateMovementCost('melee', 'ranged', 'clear')).toBe(0);
    });
  });

  describe('canMoveToPosition', () => {
    const mockParticipant: any = {
      id: 'p1'
    };

    it('should return true if available movement is enough', () => {
      expect(canMoveToPosition(mockParticipant, 'melee', 'adjacent', 5)).toBe(true);
      expect(canMoveToPosition(mockParticipant, 'melee', 'adjacent', 10)).toBe(true);
    });

    it('should return false if available movement is not enough', () => {
      expect(canMoveToPosition(mockParticipant, 'melee', 'adjacent', 4)).toBe(false);
    });
  });

  describe('doesMovementProvokeOpportunityAttacks', () => {
    const baseParticipant: any = {
      classFeatures: [],
      speed: { fly: 0 },
      bonusActionTaken: false
    };

    it('should provoke OA when leaving reach', () => {
      expect(doesMovementProvokeOpportunityAttacks(baseParticipant, 'melee', 'ranged')).toBe(true);
      expect(doesMovementProvokeOpportunityAttacks(baseParticipant, 'adjacent', 'ranged')).toBe(true);
    });

    it('should NOT provoke OA when staying within reach', () => {
      expect(doesMovementProvokeOpportunityAttacks(baseParticipant, 'melee', 'adjacent')).toBe(false);
    });

    it('should NOT provoke OA when not moving', () => {
      expect(doesMovementProvokeOpportunityAttacks(baseParticipant, 'melee', 'melee')).toBe(false);
    });

    it('should NOT provoke OA if participant has mobile feature', () => {
      const mobileParticipant = {
        ...baseParticipant,
        classFeatures: [{ name: 'mobile' }]
      };
      expect(doesMovementProvokeOpportunityAttacks(mobileParticipant, 'melee', 'ranged')).toBe(false);
    });

    it('should NOT provoke OA if participant is using disengage (mocked as bonusActionTaken)', () => {
      const disengagedParticipant = {
        ...baseParticipant,
        bonusActionTaken: true
      };
      expect(doesMovementProvokeOpportunityAttacks(disengagedParticipant, 'melee', 'ranged')).toBe(false);
    });

    it('should provoke OA even if flying', () => {
      const flyingParticipant = {
        ...baseParticipant,
        speed: { fly: 30 }
      };
      // Fixed: Flying creatures now correctly provoke OA when leaving reach
      expect(doesMovementProvokeOpportunityAttacks(flyingParticipant, 'melee', 'ranged')).toBe(true);
    });
  });

  describe('processMovementAction', () => {
    const mockEncounter: any = {
      participants: [
        { id: 'p1', name: 'Player' },
        { id: 'p2', name: 'Enemy' }
      ]
    };

    it('should return empty if participant not found', () => {
      const result = processMovementAction('p3', 'melee', 'ranged', mockEncounter);
      expect(result).toEqual([]);
      expect(checkMovementOpportunityAttacks).not.toHaveBeenCalled();
    });

    it('should call checkMovementOpportunityAttacks and return its results', () => {
      const mockOpportunities = [{ id: 'o1' }];
      (checkMovementOpportunityAttacks as any).mockReturnValue(mockOpportunities);

      const result = processMovementAction('p1', 'melee', 'ranged', mockEncounter);

      expect(checkMovementOpportunityAttacks).toHaveBeenCalledWith(
        mockEncounter.participants[0],
        mockEncounter,
        'melee',
        'ranged'
      );
      expect(result).toBe(mockOpportunities);
    });
  });
});
