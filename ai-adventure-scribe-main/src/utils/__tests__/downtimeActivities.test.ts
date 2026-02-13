/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';


import {
  calculateDowntimeCost,
  canAffordDowntimeActivity,
  checkDowntimePrerequisites,
  getAvailableDowntimeActivities,
  performDowntimeActivity
} from '../downtimeActivities';

import type { Character } from '@/types/character';
import type { DowntimeActivity } from '@/types/downtimeActivities';

import * as diceUtils from '@/utils/diceUtils';

vi.mock('@/utils/diceUtils', () => ({
  rollDice: vi.fn(),
  rollAttack: vi.fn(),
  rollDamage: vi.fn(),
  calculateDamage: vi.fn(),
  rollSavingThrow: vi.fn(),
  rollAbilityCheck: vi.fn(),
  rollInitiative: vi.fn(),
  rollGroupInitiative: vi.fn(),
  rerollInitiative: vi.fn(),
  parseDiceString: vi.fn(),
}));

describe('downtimeActivities', () => {
  const mockCharacter: Partial<Character> = {
    id: 'char-123',
    name: 'Test Character',
    level: 5,
    class: { name: 'Wizard', level: 5 } as any,
    gold: 100,
    experience: 1000,
    inventory: [
      { itemId: "smith's tools", equipped: true } as any,
    ],
    skillProficiencies: ['Arcana', 'Investigation'],
    abilityScores: {
      intelligence: { score: 18, modifier: 4 },
      dexterity: { score: 14, modifier: 2 },
      charisma: { score: 10, modifier: 0 },
      strength: { score: 12, modifier: 1 },
    } as any,
  };

  const mockActivity: DowntimeActivity = {
    id: 'test-activity',
    name: 'Test Activity',
    type: 'research',
    description: 'A test activity',
    daysRequired: 5,
    goldCost: 50,
    materialCost: 20,
    successDC: 15,
    outcomes: [
      {
        type: 'success',
        description: 'Success outcome',
        experienceGained: 100,
      } as any,
      {
        type: 'failure',
        description: 'Failure outcome',
        goldRecovery: 10,
      } as any,
    ],
    repeatable: true,
    requiresSupplies: true,
  } as DowntimeActivity;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkDowntimePrerequisites', () => {
    it('should return true if all prerequisites are met', () => {
      const result = checkDowntimePrerequisites(mockCharacter as Character, mockActivity);
      expect(result.canPerform).toBe(true);
    });

    it('should return false if level requirement is not met', () => {
      const activityWithLevel = { ...mockActivity, levelRequirement: 10 };
      const result = checkDowntimePrerequisites(mockCharacter as Character, activityWithLevel);
      expect(result.canPerform).toBe(false);
      expect(result.reason).toContain('Requires level 10');
    });

    it('should return false if class requirement is not met', () => {
      const activityWithClass = { ...mockActivity, classRequirement: 'Fighter' };
      const result = checkDowntimePrerequisites(mockCharacter as Character, activityWithClass);
      expect(result.canPerform).toBe(false);
      expect(result.reason).toContain('Requires Fighter class');
    });

    it('should return false if gold cost is not met', () => {
      const poorCharacter = { ...mockCharacter, gold: 10 };
      const result = checkDowntimePrerequisites(poorCharacter as Character, mockActivity);
      expect(result.canPerform).toBe(false);
      expect(result.reason).toContain('Requires 50 gold');
    });

    it('should handle zero gold correctly in prerequisites', () => {
        const noGoldCharacter = { ...mockCharacter, gold: 0 };
        const result = checkDowntimePrerequisites(noGoldCharacter as Character, mockActivity);
        expect(result.canPerform).toBe(false);
        expect(result.reason).toContain('Requires 50 gold');
    });

    it('should return false if tool requirements are not met', () => {
      const activityWithTools = { ...mockActivity, toolRequirements: ["Alchemist's supplies"] };
      const result = checkDowntimePrerequisites(mockCharacter as Character, activityWithTools);
      expect(result.canPerform).toBe(false);
      expect(result.reason).toContain("Requires tools: Alchemist's supplies");
    });

    it('should return false if skill requirements are not met', () => {
      const activityWithSkills = { ...mockActivity, skillRequirements: ['Athletics'] };
      const result = checkDowntimePrerequisites(mockCharacter as Character, activityWithSkills);
      expect(result.canPerform).toBe(false);
      expect(result.reason).toContain('Requires skills: Athletics');
    });
  });

  describe('performDowntimeActivity', () => {
    it('should handle successful activity performance', () => {
      vi.mocked(diceUtils.rollDice).mockReturnValue({ total: 20 } as any);

      const result = performDowntimeActivity(mockCharacter as Character, mockActivity);

      expect(result.success).toBe(true);
      expect(result.activityCompleted).toBe(true);
      expect(result.goldSpent).toBe(50);
      expect(result.materialsUsed).toBe(20);
      expect(result.outcome?.type).toBe('success');
    });

    it('should handle failed activity performance', () => {
      vi.mocked(diceUtils.rollDice).mockReturnValue({ total: 5 } as any);

      const result = performDowntimeActivity(mockCharacter as Character, mockActivity);

      expect(result.success).toBe(false);
      expect(result.activityCompleted).toBe(true);
      expect(result.outcome?.type).toBe('failure');
    });

    it('should return failure if prerequisites are not met', () => {
      const poorCharacter = { ...mockCharacter, gold: 10 };
      const result = performDowntimeActivity(poorCharacter as Character, mockActivity);

      expect(result.success).toBe(false);
      expect(result.activityCompleted).toBe(false);
      expect(result.message).toContain('Cannot perform activity');
    });

    it('should handle activities with no success DC', () => {
      const easyActivity = { ...mockActivity, successDC: undefined };
      const result = performDowntimeActivity(mockCharacter as Character, easyActivity);

      expect(result.success).toBe(true);
      expect(result.activityCompleted).toBe(true);
    });

    it('should use correct ability modifiers for different activity types', () => {
      vi.mocked(diceUtils.rollDice).mockReturnValue({ total: 20 } as any);

      // Crafting (Int)
      performDowntimeActivity(mockCharacter as Character, { ...mockActivity, type: 'crafting', successDC: 10 });
      expect(diceUtils.rollDice).toHaveBeenCalledWith(20, 1, 4);

      // Crime (Dex)
      performDowntimeActivity(mockCharacter as Character, { ...mockActivity, type: 'crime', successDC: 10 });
      expect(diceUtils.rollDice).toHaveBeenCalledWith(20, 1, 2);

      // Gambling (Cha)
      performDowntimeActivity(mockCharacter as Character, { ...mockActivity, type: 'gambling', successDC: 10 });
      expect(diceUtils.rollDice).toHaveBeenCalledWith(20, 1, 0);

      // Working (Max of Str/Dex)
      performDowntimeActivity(mockCharacter as Character, { ...mockActivity, type: 'working', successDC: 10 });
      expect(diceUtils.rollDice).toHaveBeenCalledWith(20, 1, 2); // Dex 2 > Str 1
    });

    it('should return 0 modifier if ability scores are missing', () => {
      vi.mocked(diceUtils.rollDice).mockReturnValue({ total: 20 } as any);
      const characterNoStats = { ...mockCharacter, abilityScores: undefined };

      performDowntimeActivity(characterNoStats as any, mockActivity);
      expect(diceUtils.rollDice).toHaveBeenCalledWith(20, 1, 0);
    });

    it('should return 0 modifier for unknown activity types', () => {
      vi.mocked(diceUtils.rollDice).mockReturnValue({ total: 20 } as any);

      performDowntimeActivity(mockCharacter as Character, { ...mockActivity, type: 'relaxation' as any, successDC: 10 });
      expect(diceUtils.rollDice).toHaveBeenCalledWith(20, 1, 0);
    });

    it('should apply gold recovery on failure', () => {
        vi.mocked(diceUtils.rollDice).mockReturnValue({ total: 5 } as any);
        const result = performDowntimeActivity(mockCharacter as Character, mockActivity);
        expect(result.success).toBe(false);
        expect(result.outcome?.goldRecovery).toBe(10);
    });

    it('should add items to inventory if specified in outcome', () => {
      vi.mocked(diceUtils.rollDice).mockReturnValue({ total: 20 } as any);
      const activityWithItems = {
        ...mockActivity,
        outcomes: [
          {
            type: 'success',
            description: 'Got an item',
            itemsGained: [{ itemId: 'magic-sword', equipped: false } as any],
          } as any,
        ],
      };

      const result = performDowntimeActivity(mockCharacter as Character, activityWithItems);
      expect(result.outcome?.itemsGained?.length).toBe(1);
      expect(result.outcome?.itemsGained?.[0].itemId).toBe('magic-sword');
    });

    it('should cover all activity types in modifier calculation', () => {
      vi.mocked(diceUtils.rollDice).mockReturnValue({ total: 20 } as any);

      // Training
      performDowntimeActivity(mockCharacter as Character, { ...mockActivity, type: 'training', successDC: 10 });
      // Research
      performDowntimeActivity(mockCharacter as Character, { ...mockActivity, type: 'research', successDC: 10 });
      // Carousing
      performDowntimeActivity(mockCharacter as Character, { ...mockActivity, type: 'carousing', successDC: 10 });

      expect(diceUtils.rollDice).toHaveBeenCalled();
    });
  });

  describe('calculateDowntimeCost', () => {
    it('should correctly sum gold and material costs', () => {
      expect(calculateDowntimeCost(mockActivity)).toBe(70);
    });

    it('should handle missing costs', () => {
        const freeActivity = { ...mockActivity, goldCost: undefined, materialCost: undefined } as any;
        expect(calculateDowntimeCost(freeActivity)).toBe(0);
    });
  });

  describe('canAffordDowntimeActivity', () => {
    it('should return true if character has enough gold', () => {
      expect(canAffordDowntimeActivity(mockCharacter as Character, mockActivity)).toBe(true);
    });

    it('should return false if character is too poor', () => {
      const poorCharacter = { ...mockCharacter, gold: 50 };
      expect(canAffordDowntimeActivity(poorCharacter as Character, mockActivity)).toBe(false);
    });

    it('should handle exactly enough gold', () => {
        const exactCharacter = { ...mockCharacter, gold: 70 };
        expect(canAffordDowntimeActivity(exactCharacter as Character, mockActivity)).toBe(true);
    });

    it('should handle zero gold correctly in affordability check', () => {
        const noGoldCharacter = { ...mockCharacter, gold: 0 };
        expect(canAffordDowntimeActivity(noGoldCharacter as Character, mockActivity)).toBe(false);
    });
  });

  describe('getAvailableDowntimeActivities', () => {
    it('should filter activities based on prerequisites', () => {
      const activities = [
        mockActivity,
        { ...mockActivity, id: 'hard-activity', levelRequirement: 20 } as any
      ];
      const result = getAvailableDowntimeActivities(mockCharacter as Character, activities);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('test-activity');
    });
  });
});
