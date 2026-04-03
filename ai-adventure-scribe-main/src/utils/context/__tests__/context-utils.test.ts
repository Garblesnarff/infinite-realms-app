/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  enhanceCampaignContext,
  enhanceMemoryContext,
  buildEnhancedGameContext,
} from '../contextEnhancement';
import {
  validateCampaignSetting,
  validateThematicElements,
  sortMemoriesByRelevance,
  validateGameContext,
} from '../contextValidation';

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Context Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('contextValidation', () => {
    describe('validateCampaignSetting', () => {
      it('should return default values for null/undefined/non-object input', () => {
        expect(validateCampaignSetting(null)).toEqual({
          era: 'unspecified',
          location: 'unknown',
          atmosphere: 'neutral',
        });
        expect(validateCampaignSetting(undefined)).toEqual({
          era: 'unspecified',
          location: 'unknown',
          atmosphere: 'neutral',
        });
        expect(validateCampaignSetting('string')).toEqual({
          era: 'unspecified',
          location: 'unknown',
          atmosphere: 'neutral',
        });
      });

      it('should return provided values for valid input', () => {
        const input = {
          era: 'Modern',
          location: 'New York',
          atmosphere: 'Tense',
        };
        expect(validateCampaignSetting(input)).toEqual(input);
      });

      it('should fallback for partial or invalid type fields', () => {
        const input = {
          era: 'Modern',
          location: 123, // invalid type
        };
        expect(validateCampaignSetting(input)).toEqual({
          era: 'Modern',
          location: 'unknown',
          atmosphere: 'neutral',
        });
      });
    });

    describe('validateThematicElements', () => {
      it('should return empty arrays for null/undefined input', () => {
        const expected = {
          mainThemes: [],
          recurringMotifs: [],
          keyLocations: [],
          importantNPCs: [],
        };
        expect(validateThematicElements(null)).toEqual(expected);
        expect(validateThematicElements(undefined)).toEqual(expected);
      });

      it('should filter non-string values from arrays', () => {
        const input = {
          mainThemes: ['Honor', 123, null, 'Betrayal'],
          recurringMotifs: 'not an array',
        };
        expect(validateThematicElements(input)).toEqual({
          mainThemes: ['Honor', 'Betrayal'],
          recurringMotifs: [],
          keyLocations: [],
          importantNPCs: [],
        });
      });
    });

    describe('sortMemoriesByRelevance', () => {
      it('should sort memories by importance descending', () => {
        const memories: any[] = [
          { id: '1', importance: 5 },
          { id: '2', importance: 10 },
          { id: '3', importance: 1 },
        ];
        const sorted = sortMemoriesByRelevance(memories);
        expect(sorted[0].id).toBe('2');
        expect(sorted[1].id).toBe('1');
        expect(sorted[2].id).toBe('3');
      });

      it('should handle memories with missing importance', () => {
        const memories: any[] = [
          { id: '1', importance: 5 },
          { id: '2' },
          { id: '3', importance: 8 },
        ];
        const sorted = sortMemoriesByRelevance(memories);
        expect(sorted[0].id).toBe('3');
        expect(sorted[1].id).toBe('1');
        expect(sorted[2].id).toBe('2');
      });
    });

    describe('validateGameContext', () => {
      it('should return true for a valid context', () => {
        const context: any = {
          campaign: {
            basic: { name: 'Campaign Name' },
            setting: {},
            thematicElements: {},
          },
          memories: {
            recent: [],
          },
        };
        expect(validateGameContext(context)).toBe(true);
      });

      it('should return false if campaign name is missing', () => {
        const context: any = {
          campaign: {
            basic: {},
            setting: {},
            thematicElements: {},
          },
        };
        expect(validateGameContext(context)).toBe(false);
      });

      it('should return false if character data is incomplete', () => {
        const context: any = {
          campaign: {
            basic: { name: 'Name' },
            setting: {},
            thematicElements: {},
          },
          character: {
            basic: { name: 'Hero' }, // missing class/race
          },
          memories: { recent: [] },
        };
        expect(validateGameContext(context)).toBe(false);

        const context2: any = {
          campaign: {
            basic: { name: 'Name' },
            setting: {},
            thematicElements: {},
          },
          character: {
            basic: { name: 'Hero', class: 'Fighter', race: 'Human' },
            stats: {}, // missing health
          },
          memories: { recent: [] },
        };
        expect(validateGameContext(context2)).toBe(false);
      });

      it('should return false if setting or thematicElements are missing', () => {
        const context: any = {
          campaign: {
            basic: { name: 'Name' },
          },
        };
        expect(validateGameContext(context)).toBe(false);

        const context2: any = {
          campaign: {
            basic: { name: 'Name' },
            setting: {},
          },
        };
        expect(validateGameContext(context2)).toBe(false);
      });

      it('should return false if memories array is missing', () => {
        const context: any = {
          campaign: {
            basic: { name: 'Name' },
            setting: {},
            thematicElements: {},
          },
        };
        expect(validateGameContext(context)).toBe(false);
      });
    });
  });

  describe('contextEnhancement', () => {
    describe('enhanceCampaignContext', () => {
      it('should enhance raw campaign data', () => {
        const rawCampaign: any = {
          name: 'Test',
          description: 'Desc',
          genre: 'Fantasy',
          setting: { era: 'Ancient' },
          thematic_elements: { mainThemes: ['Magic'] },
        };
        const enhanced = enhanceCampaignContext(rawCampaign);
        expect(enhanced.basic.name).toBe('Test');
        expect(enhanced.setting.era).toBe('Ancient');
        expect(enhanced.themes.mainThemes).toEqual(['Magic']);
        expect(enhanced.basic.status).toBe('active');
      });
    });

    describe('enhanceMemoryContext', () => {
      it('should enhance importance and categorize memories', () => {
        const memories: any[] = [
          { type: 'location', importance: 5, metadata: { significance: 3 } }, // importance 8
          { type: 'character', importance: 4 }, // importance 4
          { type: 'plot', importance: 9 }, // importance 9
          { type: 'event', importance: 1 }, // importance 1
        ];
        const enhanced = enhanceMemoryContext(memories);
        expect(enhanced.important).toHaveLength(2); // 8 and 9
        expect(enhanced.locations).toHaveLength(1);
        expect(enhanced.characters).toHaveLength(1);
        expect(enhanced.plot).toHaveLength(1);
        expect(enhanced.recent[0].importance).toBe(9);
      });

      it('should cap importance at 10', () => {
        const memories: any[] = [
          { importance: 8, metadata: { significance: 5 } },
        ];
        const enhanced = enhanceMemoryContext(memories);
        expect(enhanced.recent[0].importance).toBe(10);
      });
    });

    describe('buildEnhancedGameContext', () => {
      it('should build full game context', () => {
        const campaign: any = { name: 'World' };
        const character: any = {
          name: 'Hero',
          race: 'Elf',
          class: 'Wizard',
          level: 5,
          stats: { hp: 30 },
          equipment: [{ name: 'Staff', type: 'weapon', equipped: true }],
        };
        const memories: any[] = [{ type: 'plot', importance: 1 }];
        const quests: any[] = [
          { title: 'Save the King', status: 'active' },
          { title: 'Find Gold', status: 'completed' },
        ];

        const fullContext = buildEnhancedGameContext(campaign, character, memories, quests);

        expect(fullContext.campaign.basic.name).toBe('World');
        expect(fullContext.character?.basic.name).toBe('Hero');
        expect(fullContext.character?.equipment).toHaveLength(1);
        expect(fullContext.memories.plot).toHaveLength(1);
        expect(fullContext.activeQuests).toHaveLength(1);
        expect(fullContext.activeQuests?.[0].title).toBe('Save the King');
      });

      it('should handle missing optional data', () => {
        const campaign: any = { name: 'World' };
        const fullContext = buildEnhancedGameContext(campaign);
        expect(fullContext.character).toBeUndefined();
        expect(fullContext.activeQuests).toBeUndefined();
        expect(fullContext.memories.recent).toEqual([]);
      });

      it('should handle malformed character data', () => {
        const campaign: any = { name: 'World' };
        const character: any = {
          name: 123, // invalid type
          equipment: 'not an array',
        };
        const fullContext = buildEnhancedGameContext(campaign, character);
        expect(fullContext.character?.basic.name).toBe('Unknown');
        expect(fullContext.character?.equipment).toEqual([]);
      });

      it('should filter invalid equipment', () => {
        const campaign: any = { name: 'World' };
        const character: any = {
          name: 'Hero',
          equipment: [
            { name: 'Sword', type: 'weapon', equipped: true },
            { name: 'Broken' }, // missing fields
            null,
          ],
        };
        const fullContext = buildEnhancedGameContext(campaign, character);
        expect(fullContext.character?.equipment).toHaveLength(1);
      });

      it('should handle malformed quest data', () => {
        const campaign: any = { name: 'World' };
        const quests: any[] = [
          { title: 'Valid', status: 'active' },
          { title: 'Invalid' }, // missing status
          null,
          'string',
        ];
        const fullContext = buildEnhancedGameContext(campaign, undefined, [], quests);
        expect(fullContext.activeQuests).toHaveLength(1);
      });
    });
  });
});
