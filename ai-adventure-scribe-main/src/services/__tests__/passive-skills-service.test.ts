/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  calculatePassiveSkill,
  calculatePassivePerception,
  calculatePassiveInsight,
  calculatePassiveInvestigation,
  checkPassivePerception,
  checkPassiveInsight,
  checkPassiveInvestigation,
  evaluatePassiveChecks,
  getPassiveCheckNarration,
  getCharacterPassiveScores,
  PassiveSkillsService,
} from '../passive-skills-service';
import { getProficiencyBonus } from '@/data/levelProgression';

// Mock levelProgression to have stable proficiency bonuses for tests
vi.mock('@/data/levelProgression', () => ({
  getProficiencyBonus: vi.fn((level: number) => {
    if (level >= 17) return 6;
    if (level >= 13) return 5;
    if (level >= 9) return 4;
    if (level >= 5) return 3;
    return 2;
  }),
}));

describe('PassiveSkillsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculatePassiveSkill', () => {
    it('should calculate passive skill correctly without proficiency', () => {
      // 10 + floor((14-10)/2) + 0 = 10 + 2 + 0 = 12
      expect(calculatePassiveSkill(14, 2, false)).toBe(12);
    });

    it('should calculate passive skill correctly with proficiency', () => {
      // 10 + floor((14-10)/2) + 2 = 10 + 2 + 2 = 14
      expect(calculatePassiveSkill(14, 2, true)).toBe(14);
    });

    it('should handle negative modifiers correctly', () => {
      // 10 + floor((8-10)/2) + 0 = 10 + (-1) + 0 = 9
      expect(calculatePassiveSkill(8, 2, false)).toBe(9);
    });

    it('should handle high ability scores and proficiency bonuses', () => {
      // 10 + floor((20-10)/2) + 6 = 10 + 5 + 6 = 21
      expect(calculatePassiveSkill(20, 6, true)).toBe(21);
    });

    it('should calculate ability modifiers according to D&D 5E rules', () => {
      // Test the formula: (ability score - 10) / 2, rounded down
      const testCases = [
        { score: 1, expectedMod: -5 },
        { score: 8, expectedMod: -1 },
        { score: 9, expectedMod: -1 },
        { score: 10, expectedMod: 0 },
        { score: 11, expectedMod: 0 },
        { score: 12, expectedMod: 1 },
        { score: 13, expectedMod: 1 },
        { score: 14, expectedMod: 2 },
        { score: 15, expectedMod: 2 },
        { score: 16, expectedMod: 3 },
        { score: 18, expectedMod: 4 },
        { score: 20, expectedMod: 5 },
      ];

      testCases.forEach(({ score, expectedMod }) => {
        const passive = calculatePassiveSkill(score, 0, false);
        expect(passive).toBe(10 + expectedMod);
      });
    });
  });

  const mockCharacter: any = {
    id: 'char-1',
    name: 'Test Rogue',
    level: 5,
    abilityScores: {
      wisdom: { score: 14 },
      intelligence: { score: 12 },
    },
    skillProficiencies: ['Perception', 'Investigation'],
  };

  describe('calculatePassivePerception', () => {
    it('should calculate passive Perception for a character', () => {
      // Wisdom 14 (+2), Level 5 (PB +3), Proficient in Perception (+3)
      // 10 + 2 + 3 = 15
      expect(calculatePassivePerception(mockCharacter)).toBe(15);
      expect(getProficiencyBonus).toHaveBeenCalledWith(5);
    });

    it('should return 10 if character data is incomplete', () => {
      expect(calculatePassivePerception({} as any)).toBe(10);
    });
  });

  describe('calculatePassiveInsight', () => {
    it('should calculate passive Insight for a character', () => {
      // Wisdom 14 (+2), Level 5 (PB +3), NOT Proficient in Insight
      // 10 + 2 + 0 = 12
      expect(calculatePassiveInsight(mockCharacter)).toBe(12);
    });

    it('should return 10 if character data is incomplete', () => {
      expect(calculatePassiveInsight({} as any)).toBe(10);
    });
  });

  describe('calculatePassiveInvestigation', () => {
    it('should calculate passive Investigation for a character', () => {
      // Intelligence 12 (+1), Level 5 (PB +3), Proficient in Investigation (+3)
      // 10 + 1 + 3 = 14
      expect(calculatePassiveInvestigation(mockCharacter)).toBe(14);
    });

    it('should return 10 if character data is incomplete', () => {
      expect(calculatePassiveInvestigation({} as any)).toBe(10);
    });
  });

  describe('checkPassiveSkill functions', () => {
    it('should check passive Perception against a DC (success)', () => {
      const result = checkPassivePerception(mockCharacter, 12);
      expect(result.success).toBe(true);
      expect(result.passiveScore).toBe(15);
      expect(result.dc).toBe(12);
      expect(result.margin).toBe(3);
      expect(result.characterName).toBe('Test Rogue');
    });

    it('should check passive Perception against a DC (failure)', () => {
      const result = checkPassivePerception(mockCharacter, 20);
      expect(result.success).toBe(false);
      expect(result.margin).toBe(-5);
    });

    it('should check passive Insight against a DC', () => {
      const result = checkPassiveInsight(mockCharacter, 12);
      expect(result.success).toBe(true);
      expect(result.passiveScore).toBe(12);
    });

    it('should check passive Investigation against a DC', () => {
      const result = checkPassiveInvestigation(mockCharacter, 15);
      expect(result.success).toBe(false);
      expect(result.passiveScore).toBe(14);
    });

    it('should handle characters with missing names or IDs', () => {
      const incompleteChar: any = {
        level: 1,
        abilityScores: {
          wisdom: { score: 10 },
          intelligence: { score: 10 }
        }
      };

      // Test Perception
      let result = checkPassivePerception(incompleteChar, 10);
      expect(result.characterId).toBe('unknown');
      expect(result.characterName).toBe('Unknown Character');

      // Test Insight
      result = checkPassiveInsight(incompleteChar, 10);
      expect(result.characterId).toBe('unknown');
      expect(result.characterName).toBe('Unknown Character');

      // Test Investigation
      result = checkPassiveInvestigation(incompleteChar, 10);
      expect(result.characterId).toBe('unknown');
      expect(result.characterName).toBe('Unknown Character');
    });
  });

  describe('evaluatePassiveChecks', () => {
    const characters = [
      mockCharacter,
      {
        id: 'char-2',
        name: 'Test Wizard',
        level: 5,
        abilityScores: {
          wisdom: { score: 10 },
          intelligence: { score: 18 },
        },
        skillProficiencies: ['Investigation'],
      },
    ];

    it('should evaluate all passive checks for a scene', () => {
      const scene = {
        perceptionDC: 13,
        insightDC: 15,
        investigationDC: 15,
      };

      const results = evaluatePassiveChecks(characters as any, scene);

      // Perception: Rogue (15) Success, Wizard (10) Failure
      expect(results.perception).toHaveLength(2);
      expect(results.perception[0].success).toBe(true);
      expect(results.perception[1].success).toBe(false);

      // Insight: Rogue (12) Failure, Wizard (10) Failure
      expect(results.insight).toHaveLength(2);
      expect(results.insight.every(r => !r.success)).toBe(true);

      // Investigation: Rogue (14) Failure, Wizard (10 + 4 + 3 = 17) Success
      expect(results.investigation).toHaveLength(2);
      expect(results.investigation[0].success).toBe(false);
      expect(results.investigation[1].success).toBe(true);
    });

    it('should return empty arrays for undefined DCs', () => {
      const results = evaluatePassiveChecks(characters as any, {});
      expect(results.perception).toEqual([]);
      expect(results.insight).toEqual([]);
      expect(results.investigation).toEqual([]);
    });
  });

  describe('getPassiveCheckNarration', () => {
    const scene = {
      perceptionDC: 10,
      perceptionDetails: 'You hear a faint ticking behind the wall.',
      insightDetails: 'The merchant seems nervous when mentioning the price.',
      investigationDetails: 'The dust on the floor is undisturbed near the chest.',
    };

    it('should generate narration for successful checks', () => {
      const sceneCheck = {
        perception: [{ success: true, characterName: 'Rogue', passiveScore: 15 } as any],
        insight: [{ success: true, characterName: 'Cleric', passiveScore: 14 } as any],
        investigation: [{ success: true, characterName: 'Wizard', passiveScore: 16 } as any],
      };

      const narrations = getPassiveCheckNarration(sceneCheck, scene);
      expect(narrations).toHaveLength(3);
      expect(narrations[0]).toContain('Rogue');
      expect(narrations[0]).toContain('Passive Perception 15');
      expect(narrations[0]).toContain('ticking');
      expect(narrations[1]).toContain('Cleric');
      expect(narrations[1]).toContain('nervous');
      expect(narrations[2]).toContain('Wizard');
      expect(narrations[2]).toContain('Passive Investigation 16');
      expect(narrations[2]).toContain('dust');
    });

    it('should group names for multiple successful characters', () => {
      const sceneCheck = {
        perception: [
          { success: true, characterName: 'Rogue', passiveScore: 15 } as any,
          { success: true, characterName: 'Fighter', passiveScore: 12 } as any,
        ],
        insight: [],
        investigation: [],
      };

      const narrations = getPassiveCheckNarration(sceneCheck, scene);
      expect(narrations[0]).toContain('Rogue, Fighter');
    });

    it('should return empty array if no checks succeeded', () => {
      const sceneCheck = {
        perception: [{ success: false } as any],
        insight: [{ success: false } as any],
        investigation: [],
      };

      const narrations = getPassiveCheckNarration(sceneCheck, scene);
      expect(narrations).toHaveLength(0);
    });

    it('should return empty array if no details are provided in scene', () => {
      const sceneCheck = {
        perception: [{ success: true, characterName: 'Rogue', passiveScore: 15 } as any],
        insight: [],
        investigation: [],
      };

      const narrations = getPassiveCheckNarration(sceneCheck, {});
      expect(narrations).toHaveLength(0);
    });
  });

  describe('getCharacterPassiveScores', () => {
    it('should return all passive scores for a character', () => {
      const scores = getCharacterPassiveScores(mockCharacter);
      expect(scores).toEqual({
        perception: 15,
        insight: 12,
        investigation: 14,
      });
    });
  });

  describe('PassiveSkillsService object export', () => {
    it('should contain all exported functions', () => {
      expect(PassiveSkillsService.calculatePassiveSkill).toBe(calculatePassiveSkill);
      expect(PassiveSkillsService.evaluatePassiveChecks).toBe(evaluatePassiveChecks);
      expect(PassiveSkillsService.getPassiveCheckNarration).toBe(getPassiveCheckNarration);
    });
  });
});
