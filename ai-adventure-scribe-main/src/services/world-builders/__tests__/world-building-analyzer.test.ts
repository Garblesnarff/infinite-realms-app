import { describe, it, expect } from 'vitest';

import { WorldBuildingAnalyzer } from '../world-building-analyzer';

import type { WorldBuildingContext } from '../types';
import type { Memory } from '@/types/memory';

describe('WorldBuildingAnalyzer', () => {
  describe('analyzeBuildingNeeds', () => {
    const baseContext: WorldBuildingContext = {
      campaignId: 'campaign-123',
      sessionId: 'session-456',
      characterId: 'char-789',
      playerAction: 'I walk down the street',
      recentMemories: [],
    };

    it('should identify location building triggers', async () => {
      const context: WorldBuildingContext = {
        ...baseContext,
        playerAction: 'I want to enter the mysterious tower',
      };

      const result = await WorldBuildingAnalyzer.analyzeBuildingNeeds(context);

      expect(result.confidence).toBeGreaterThanOrEqual(0.3);
      expect(result.suggestions.locations).toBeDefined();
      expect(result.suggestions.locations?.[0]).toContain('location');
    });

    it('should identify NPC building triggers', async () => {
      const context: WorldBuildingContext = {
        ...baseContext,
        playerAction: 'I talk to the hooded figure',
      };

      const result = await WorldBuildingAnalyzer.analyzeBuildingNeeds(context);

      expect(result.confidence).toBeGreaterThanOrEqual(0.3);
      expect(result.suggestions.npcs).toBeDefined();
      expect(result.suggestions.npcs?.[0]).toContain('NPC');
    });

    it('should identify quest building triggers', async () => {
      const context: WorldBuildingContext = {
        ...baseContext,
        playerAction: 'I look for some work or a job to do',
      };

      const result = await WorldBuildingAnalyzer.analyzeBuildingNeeds(context);

      expect(result.confidence).toBeGreaterThanOrEqual(0.3);
      expect(result.suggestions.quests).toBeDefined();
      expect(result.suggestions.quests?.[0]).toContain('quest');
    });

    it('should combine multiple triggers and increase confidence', async () => {
      const context: WorldBuildingContext = {
        ...baseContext,
        playerAction: 'I go to the tavern to find someone who needs help',
      };

      const result = await WorldBuildingAnalyzer.analyzeBuildingNeeds(context);

      // location (0.3) + npc (0.3) + quest (0.3) = 0.9
      expect(result.confidence).toBeCloseTo(0.9);
      expect(result.suggestions.locations).toBeDefined();
      expect(result.suggestions.npcs).toBeDefined();
      expect(result.suggestions.quests).toBeDefined();
    });

    it('should consider memories and increase confidence', async () => {
      const recentMemories: Memory[] = [
        {
          id: 'mem-1',
          type: 'quest',
          content: 'Some quest',
          importance: 5,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          metadata: null,
        },
      ];

      const context: WorldBuildingContext = {
        ...baseContext,
        recentMemories,
      };

      const result = await WorldBuildingAnalyzer.analyzeBuildingNeeds(context);
      expect(result.confidence).toBeGreaterThanOrEqual(0.2);
    });

    it('should identify opportunities from memory content', async () => {
      const recentMemories: Memory[] = [
        {
          id: 'mem-1',
          type: 'general',
          content: 'A mysterious shadow',
          importance: 5,
          created_at: '',
          updated_at: '',
          metadata: null,
        },
        {
          id: 'mem-2',
          type: 'general',
          content: 'An unresolved conflict',
          importance: 5,
          created_at: '',
          updated_at: '',
          metadata: null,
        },
      ];

      const context: WorldBuildingContext = {
        ...baseContext,
        recentMemories,
      };

      const result = await WorldBuildingAnalyzer.analyzeBuildingNeeds(context);
      expect(result.confidence).toBeGreaterThanOrEqual(0.2);
    });

    it('should return type player_action for most triggers', async () => {
      const context: WorldBuildingContext = {
        ...baseContext,
        playerAction: 'I enter the shop',
      };

      const result = await WorldBuildingAnalyzer.analyzeBuildingNeeds(context);
      expect(result.type).toBe('player_action');
    });

    it('should return type memory_based when many memories are present', async () => {
      const recentMemories: Memory[] = [
        { id: '1', type: 'quest', content: 'q1', importance: 1, created_at: '', updated_at: '', metadata: null },
        { id: '2', type: 'npc', content: 'n1', importance: 1, created_at: '', updated_at: '', metadata: null },
        { id: '3', type: 'location', content: 'l1', importance: 1, created_at: '', updated_at: '', metadata: null },
      ];

      const context: WorldBuildingContext = {
        ...baseContext,
        recentMemories,
      };

      const result = await WorldBuildingAnalyzer.analyzeBuildingNeeds(context);
      expect(result.type).toBe('memory_based');
    });

    it('should return type random_event for low confidence', async () => {
      const context: WorldBuildingContext = {
        ...baseContext,
        playerAction: 'I wait',
      };

      const result = await WorldBuildingAnalyzer.analyzeBuildingNeeds(context);
      expect(result.type).toBe('random_event');
      expect(result.confidence).toBeLessThan(0.2);
    });

    it('should cap confidence at 1.0', async () => {
      const recentMemories: Memory[] = [
        { id: '1', type: 'quest', content: 'q1', importance: 1, created_at: '', updated_at: '', metadata: null },
      ];

      const context: WorldBuildingContext = {
        ...baseContext,
        playerAction: 'I go to talk to someone about a quest in a mysterious location',
        recentMemories,
      };

      const result = await WorldBuildingAnalyzer.analyzeBuildingNeeds(context);
      // location (0.3) + npc (0.3) + quest (0.3) + memory (0.2) = 1.1 -> capped at 1.0
      expect(result.confidence).toBe(1.0);
    });
  });

  describe('inferQuestTypeFromAction', () => {
    it('should infer investigation type', () => {
      expect(WorldBuildingAnalyzer.inferQuestTypeFromAction('I want to investigate the murder')).toBe('investigation');
      expect(WorldBuildingAnalyzer.inferQuestTypeFromAction('Let us solve the mystery')).toBe('investigation');
    });

    it('should infer social type', () => {
      expect(WorldBuildingAnalyzer.inferQuestTypeFromAction('I talk to the king')).toBe('social');
      expect(WorldBuildingAnalyzer.inferQuestTypeFromAction('Try to negotiate with them')).toBe('social');
      expect(WorldBuildingAnalyzer.inferQuestTypeFromAction('I will convince the guards')).toBe('social');
    });

    it('should infer fetch type', () => {
      expect(WorldBuildingAnalyzer.inferQuestTypeFromAction('Find the lost amulet')).toBe('fetch');
      expect(WorldBuildingAnalyzer.inferQuestTypeFromAction('Get some herbs for the potion')).toBe('fetch');
      expect(WorldBuildingAnalyzer.inferQuestTypeFromAction('Bring me the head of the dragon')).toBe('fetch');
    });

    it('should infer kill type', () => {
      expect(WorldBuildingAnalyzer.inferQuestTypeFromAction('I will kill the monster')).toBe('kill');
      expect(WorldBuildingAnalyzer.inferQuestTypeFromAction('Defeat the goblin army')).toBe('kill');
      expect(WorldBuildingAnalyzer.inferQuestTypeFromAction('Time to fight')).toBe('kill');
    });

    it('should infer escort type', () => {
      expect(WorldBuildingAnalyzer.inferQuestTypeFromAction('Escort the caravan')).toBe('escort');
      expect(WorldBuildingAnalyzer.inferQuestTypeFromAction('Protect the princess')).toBe('escort');
      expect(WorldBuildingAnalyzer.inferQuestTypeFromAction('Guard the gate')).toBe('escort');
    });

    it('should infer exploration type', () => {
      expect(WorldBuildingAnalyzer.inferQuestTypeFromAction('Explore the cave')).toBe('exploration');
      expect(WorldBuildingAnalyzer.inferQuestTypeFromAction('Discover new lands')).toBe('exploration');
      expect(WorldBuildingAnalyzer.inferQuestTypeFromAction('Map the territory')).toBe('exploration');
    });

    it('should return side for unknown actions', () => {
      expect(WorldBuildingAnalyzer.inferQuestTypeFromAction('I sleep')).toBe('side');
    });
  });
});
