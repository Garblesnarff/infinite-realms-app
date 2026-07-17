/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { MemoryManager } from '../../memory-manager';
import { QuestGenerator } from '../quest-generator';

import { llmApiClient } from '@/infrastructure/api';
import { supabase } from '@/integrations/supabase/client';
import { userDataApi } from '@/services/user-data-api';
import { buildQuestPromptTemplate } from '@/services/world-builders/quest-prompts';
import { getAveragePartyLevel } from '@/utils/character-level-utils';

vi.mock('@/infrastructure/api', () => ({
  llmApiClient: {
    generateText: vi.fn(),
  },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      single: vi.fn(),
    })),
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../memory-manager', () => ({
  MemoryManager: {
    getRelevantMemories: vi.fn(),
  },
}));

vi.mock('@/services/world-builders/quest-prompts', () => ({
  buildQuestPromptTemplate: vi.fn(),
  buildQuestHookPromptTemplate: vi.fn(),
}));

vi.mock('@/utils/character-level-utils', () => ({
  getAveragePartyLevel: vi.fn(),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    createQuest: vi.fn(),
  },
}));

describe('QuestGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateQuest', () => {
    const mockRequest: any = {
      type: 'side',
      difficulty: 'medium',
      urgency: 'soon',
      scope: 'single-session',
      context: {
        campaignId: 'campaign-123',
        characterId: 'char-456',
        genre: 'fantasy',
        currentStory: 'Main arc',
      },
    };

    const mockQuestData = {
      title: 'The Lost Relic',
      description: 'Find the relic in the ruins.',
      type: 'side',
      difficulty: 'medium',
      estimatedTime: '1 session',
      objective: {
        primary: 'Find relic',
        secondary: [],
        hidden: [],
      },
      stages: [],
      rewards: {
        experience: 500,
        gold: 100,
        items: [],
        reputation: [],
        storyImpact: [],
      },
      consequences: {
        success: [],
        failure: [],
        partialSuccess: [],
      },
      lore: '',
      backstory: '',
      connections: {
        npcs: [],
        locations: [],
        otherQuests: [],
        factions: [],
      },
      challenges: {
        combat: [],
        social: [],
        exploration: [],
        puzzles: [],
      },
      hooks: {
        initial: [],
        ongoing: [],
        twists: [],
      },
    };

    it('should generate a quest successfully', async () => {
      vi.mocked(buildQuestPromptTemplate).mockReturnValue('mock-prompt');
      vi.mocked(llmApiClient.generateText).mockResolvedValue(`JSON: ${JSON.stringify(mockQuestData)}`);

      const result = await QuestGenerator.generateQuest(mockRequest);

      expect(result.title).toBe('The Lost Relic');
      expect(result.metadata.campaignId).toBe('campaign-123');
      expect(result.metadata.createdAt).toBeInstanceOf(Date);
      expect(result.metadata.narrativeWeight).toBeGreaterThanOrEqual(5);
    });

    it('should throw error if no JSON is found', async () => {
      vi.mocked(llmApiClient.generateText).mockResolvedValue('No JSON here');

      await expect(QuestGenerator.generateQuest(mockRequest)).rejects.toThrow(/No JSON found/);
    });

    it('should throw error if JSON is invalid', async () => {
      vi.mocked(llmApiClient.generateText).mockResolvedValue('{ invalid json }');

      await expect(QuestGenerator.generateQuest(mockRequest)).rejects.toThrow(/Invalid response format/);
    });

    it('should handle generic errors during generation', async () => {
      vi.mocked(llmApiClient.generateText).mockRejectedValue(new Error('API failure'));

      await expect(QuestGenerator.generateQuest(mockRequest)).rejects.toThrow(/Failed to generate quest: API failure/);
    });

    it('should handle non-Error objects in catch', async () => {
      vi.mocked(llmApiClient.generateText).mockRejectedValue('String error');

      await expect(QuestGenerator.generateQuest(mockRequest)).rejects.toThrow(/Unknown error/);
    });
  });

  describe('calculateNarrativeWeight', () => {
    const baseRequest: any = {
      type: 'fetch',
      scope: 'single-session',
    };

    it('should calculate base weight of 5', () => {
      const weight = (QuestGenerator as any).calculateNarrativeWeight({}, baseRequest);
      expect(weight).toBe(5);
    });

    it('should add weight for main quest type', () => {
      const weight = (QuestGenerator as any).calculateNarrativeWeight({}, { ...baseRequest, type: 'main' });
      expect(weight).toBe(8); // 5 + 3
    });

    it('should add weight for personal quest type', () => {
      const weight = (QuestGenerator as any).calculateNarrativeWeight({}, { ...baseRequest, type: 'personal' });
      expect(weight).toBe(7); // 5 + 2
    });

    it('should add weight for side quest type', () => {
      const weight = (QuestGenerator as any).calculateNarrativeWeight({}, { ...baseRequest, type: 'side' });
      expect(weight).toBe(6); // 5 + 1
    });

    it('should add weight for campaign-arc scope', () => {
      const weight = (QuestGenerator as any).calculateNarrativeWeight({}, { ...baseRequest, scope: 'campaign-arc' });
      expect(weight).toBe(7); // 5 + 2
    });

    it('should add weight for multi-session scope', () => {
      const weight = (QuestGenerator as any).calculateNarrativeWeight({}, { ...baseRequest, scope: 'multi-session' });
      expect(weight).toBe(6); // 5 + 1
    });

    it('should add weight for complex quest structure', () => {
      const complexQuest = {
        stages: [1, 2, 3, 4], // > 3
        connections: { npcs: [1, 2, 3] }, // > 2
        hooks: { twists: [1, 2] }, // > 1
      };
      const weight = (QuestGenerator as any).calculateNarrativeWeight(complexQuest, baseRequest);
      expect(weight).toBe(8); // 5 + 1 + 1 + 1
    });

    it('should cap weight at 10', () => {
      const veryComplexQuest = {
        stages: [1, 2, 3, 4, 5],
        connections: { npcs: [1, 2, 3, 4] },
        hooks: { twists: [1, 2, 3] },
      };
      const request = { ...baseRequest, type: 'main', scope: 'campaign-arc' };
      const weight = (QuestGenerator as any).calculateNarrativeWeight(veryComplexQuest, request);
      // 5 + 3 (main) + 2 (arc) + 1 + 1 + 1 = 13 -> capped at 10
      expect(weight).toBe(10);
    });
  });

  describe('saveQuest', () => {
    it('should save quest successfully through the owned-data API', async () => {
      const mockQuest: any = {
        title: 'Save the King',
        description: 'Rescue the king.',
        type: 'main',
        difficulty: 'hard',
        metadata: { campaignId: 'c1', createdAt: new Date() },
      };

      vi.mocked(userDataApi.createQuest).mockResolvedValue({ id: 'quest-123' } as any);

      const id = await QuestGenerator.saveQuest(mockQuest);
      expect(id).toBe('quest-123');
      expect(userDataApi.createQuest).toHaveBeenCalledWith(expect.objectContaining({
        campaign_id: 'c1',
        title: 'Save the King',
      }));
    });

    it('should rethrow owned-data API failures', async () => {
      const mockQuest: any = {
        title: 'Fail Quest',
        metadata: { createdAt: new Date() },
      };

      vi.mocked(userDataApi.createQuest).mockRejectedValue(new Error('DB Error'));

      await expect(QuestGenerator.saveQuest(mockQuest)).rejects.toThrow('DB Error');
    });
  });

  describe('createQuest', () => {
    it('should generate and save quest', async () => {
      const mockQuestData = { title: 'New Quest', type: 'side' };
      vi.mocked(llmApiClient.generateText).mockResolvedValue(JSON.stringify(mockQuestData));

      vi.mocked(userDataApi.createQuest).mockResolvedValue({ id: 'quest-123' } as any);

      const result = await QuestGenerator.createQuest({ context: { campaignId: 'c1' } } as any);
      expect(result.id).toBe('quest-123');
      expect(result.title).toBe('New Quest');
    });

    it('should return quest even if save fails', async () => {
      vi.mocked(llmApiClient.generateText).mockResolvedValue(JSON.stringify({ title: 'Unsaved Quest' }));
      vi.mocked(userDataApi.createQuest).mockRejectedValue(new Error('Save Error'));

      const result = await QuestGenerator.createQuest({ context: { campaignId: 'c1' } } as any);
      expect(result.title).toBe('Unsaved Quest');
      expect(result.id).toBeUndefined();
    });
  });

  describe('generateMemoryBasedQuest', () => {
    it('should verify campaign ownership and generate quest', async () => {
      const mockFrom = vi.mocked(supabase.from);
      const mockEq = vi.fn().mockReturnThis();
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: mockEq,
        single: vi.fn().mockResolvedValue({ data: { id: 'c1', genre: 'cyberpunk' }, error: null }),
      } as any);

      vi.mocked(MemoryManager.getRelevantMemories).mockResolvedValue([{ content: 'Memory 1' }] as any);
      vi.mocked(getAveragePartyLevel).mockResolvedValue(3);
      vi.mocked(llmApiClient.generateText).mockResolvedValue(JSON.stringify({ title: 'Memory Quest' }));

      vi.mocked(userDataApi.createQuest).mockResolvedValue({ id: 'quest-123' } as any);

      await QuestGenerator.generateMemoryBasedQuest('c1', 's1', 'char1', 'main', 'u1');

      expect(mockEq).toHaveBeenCalledWith('id', 'c1');
      expect(mockEq).toHaveBeenCalledWith('user_id', 'u1');
      expect(MemoryManager.getRelevantMemories).toHaveBeenCalledWith('s1', 'quest opportunities', 5);
    });

    it('should fail closed when userId is missing', async () => {
      await expect(
        QuestGenerator.generateMemoryBasedQuest('c1', 's1', 'char1', 'side', undefined as any),
      ).rejects.toThrow('User ID is required for quest generation');
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('should throw if campaign is not owned by the user', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as any);

      await expect(QuestGenerator.generateMemoryBasedQuest('c1', 's1', 'char1', 'side', 'u1')).rejects.toThrow('Campaign not found or access denied');
    });

    it('should handle campaign lookup errors during memory-based quest generation', async () => {
      vi.mocked(supabase.from).mockImplementation(() => {
        throw new Error('Network error');
      });

      await expect(QuestGenerator.generateMemoryBasedQuest('c1', 's1', 'char1', 'side', 'u1')).rejects.toThrow('Network error');
    });
  });

  describe('generateQuestHook', () => {
    it('should generate a hook successfully', async () => {
      const mockHook = { title: 'Hook Title', hook: 'Hook text', questType: 'side' };
      vi.mocked(llmApiClient.generateText).mockResolvedValue(JSON.stringify(mockHook));

      const result = await QuestGenerator.generateQuestHook('c1', 's1', 'situation');

      expect(result).toEqual(mockHook);
    });

    it('should return fallback if JSON parsing fails', async () => {
      vi.mocked(llmApiClient.generateText).mockResolvedValue('Not JSON');

      const result = await QuestGenerator.generateQuestHook('c1', 's1', 'situation');

      expect(result.title).toBe('Mysterious Opportunity');
    });

    it('should return fallback on error', async () => {
      vi.mocked(llmApiClient.generateText).mockRejectedValue(new Error('API error'));

      const result = await QuestGenerator.generateQuestHook('c1', 's1', 'situation');

      expect(result.title).toBe('Adventure Awaits');
    });
  });
});
