import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryService } from '../MemoryService';
import * as featureFlags from '@/config/featureFlags';
import type { MemoryType } from '@/types/memory';
import { llmApiClient } from '@/infrastructure/api';

// MemoryRepository (src/agents/services/memory/MemoryRepository.ts) was migrated from
// supabase.from('memories')...insert() and supabase.rpc() to
// userDataApi.createMemories()/listMemories()/matchMemories() (real fetch() calls to the
// Bun server). Only invokeEmbedding() (still supabase.functions.invoke('generate-embedding'))
// remains on supabase. The mocks below cover the userDataApi/supabase surface actually
// exercised by MemoryService.saveMemories()/extractMemories() in the tests that remain here.
const { mockInsert: baseMockInsert, mockFunctionsInvoke: baseMockFunctionsInvoke } = vi.hoisted(
  () => ({
    mockInsert: vi.fn(async () => []),
    mockFunctionsInvoke: vi.fn(),
  }),
);

// Mock Supabase client (only functions.invoke is still used by MemoryRepository)
vi.mock('@/integrations/supabase/client', () => {
  return {
    supabase: {
      from: vi.fn(() => ({
        insert: vi.fn(async () => ({ data: null, error: null })),
      })),
      functions: {
        invoke: baseMockFunctionsInvoke,
      },
    },
  };
});

// Mock userDataApi - MemoryRepository's real backing store as of the REST API
// migration (see src/agents/services/memory/MemoryRepository.ts).
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    createMemories: baseMockInsert,
  },
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock importance calculation
vi.mock('@/utils/memory/importance', () => ({
  calculateImportance: vi.fn(({ type }) => {
    // Return different importances based on type
    const importanceMap: Record<string, number> = {
      quest: 5,
      plot_point: 5,
      foreshadowing: 4,
      npc: 4,
      location: 3,
      dialogue_gem: 3,
      event: 3,
      general: 2,
    };
    return importanceMap[type as string] || 2;
  }),
}));

// Mock LLM API Client
vi.mock('@/infrastructure/api', () => ({
  llmApiClient: {
    generateText: vi.fn().mockResolvedValue('Mock response'),
    extractMemories: vi.fn().mockResolvedValue(
      JSON.stringify({
        memories: [
          {
            session_id: 'session-123',
            type: 'quest',
            category: 'main_quest',
            content: 'Find the Dragon Scroll',
            importance: 5,
            emotional_tone: 'intense',
            metadata: {},
          },
        ],
      }),
    ),
  },
}));

describe('Memory Service Integration', () => {
  let mockInsert: any;
  let mockFunctionsInvoke: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(featureFlags, 'isSemanticMemoriesEnabled').mockReturnValue(true);

    mockInsert = baseMockInsert;
    mockFunctionsInvoke = baseMockFunctionsInvoke;
    vi.mocked(llmApiClient.extractMemories).mockResolvedValue(
      JSON.stringify({
        memories: [
          {
            session_id: 'session-123',
            type: 'quest',
            category: 'main_quest',
            content: 'Find the Dragon Scroll',
            importance: 5,
            emotional_tone: 'intense',
            metadata: {},
          },
        ],
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Memory Importance Scoring', () => {
    it('should normalize importance to 1-5 range', async () => {
      mockFunctionsInvoke.mockResolvedValue({
        data: { embedding: JSON.stringify(Array(1536).fill(0.5)) },
        error: null,
      });

      mockInsert.mockResolvedValue({
        data: null,
        error: null,
      });

      // Mock saveMemories to test normalization
      const memories = [
        {
          session_id: 'session-123',
          type: 'quest' as MemoryType,
          content: 'Quest memory',
          importance: 10, // Should be normalized to 5
          metadata: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
        {
          session_id: 'session-123',
          type: 'general' as MemoryType,
          content: 'General memory',
          importance: 0, // Should be normalized to 1
          metadata: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ];

      await MemoryService.saveMemories(memories);

      const insertCalls = mockInsert.mock.calls;
      expect(insertCalls[0][0][0].importance).toBeLessThanOrEqual(5);
      expect(insertCalls[0][0][1].importance).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Memory Extraction from Conversation', () => {
    it('should extract memories from conversation context', async () => {
      mockFunctionsInvoke.mockResolvedValue({
        data: { embedding: JSON.stringify(Array(1536).fill(0.5)) },
        error: null,
      });

      mockInsert.mockResolvedValue({
        data: null,
        error: null,
      });

      const context = {
        sessionId: 'session-123',
        campaignId: 'campaign-456',
        characterId: 'char-789',
        currentLocation: 'Ancient Temple',
        activeNPCs: ['High Priest'],
        activeQuests: ['Find the Sacred Relic'],
        currentMessage: 'I enter the temple',
        recentMessages: ['You approach the ancient temple'],
      };

      const result = await MemoryService.extractMemories(
        context,
        'I search for the sacred relic',
        'The high priest reveals a hidden chamber containing the relic',
      );

      expect(result.memories).toBeInstanceOf(Array);
      expect(result.memories.length).toBeGreaterThan(0);
      expect(result.memories[0]).toHaveProperty('type');
      expect(result.memories[0]).toHaveProperty('content');
      expect(result.memories[0]).toHaveProperty('importance');
    });

    it('normalizes compound extractor types before they are written', async () => {
      vi.mocked(llmApiClient.extractMemories).mockResolvedValue(
        JSON.stringify({
          memories: [
            {
              session_id: 'session-123',
              type: 'event|npc|combat',
              content: 'The guard joined the battle.',
              importance: 4,
              metadata: {},
            },
            {
              session_id: 'session-123',
              type: 'unknown|event',
              content: 'An unrecognized category.',
              importance: 2,
              metadata: {},
            },
          ],
        }),
      );

      const result = await MemoryService.extractMemories(
        {
          sessionId: 'session-123',
          campaignId: 'campaign-456',
          characterId: 'char-789',
          currentMessage: 'The guard attacks',
          recentMessages: [],
        },
        'I draw my sword',
        'The guard joins the fight.',
      );

      expect(result.memories.map((memory) => memory.type)).toEqual(['event', 'general']);
    });

    it('normalizes types again at the memory write boundary', async () => {
      mockFunctionsInvoke.mockResolvedValue({
        data: { embedding: JSON.stringify(Array(1536).fill(0.5)) },
        error: null,
      });

      await MemoryService.saveMemories([
        {
          session_id: 'session-123',
          type: 'event|npc|combat' as unknown as MemoryType,
          content: 'The guard joined the battle.',
          importance: 4,
          metadata: {},
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ]);

      expect(mockInsert).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ type: 'event' })]),
      );
    });

    it('should save extracted memories with embeddings', async () => {
      mockFunctionsInvoke.mockResolvedValue({
        data: { embedding: JSON.stringify(Array(1536).fill(0.5)) },
        error: null,
      });

      mockInsert.mockResolvedValue({
        data: null,
        error: null,
      });

      const context = {
        sessionId: 'session-123',
        campaignId: 'campaign-456',
        characterId: 'char-789',
        currentMessage: 'I attack the dragon',
        recentMessages: ['A dragon appears'],
      };

      const result = await MemoryService.extractMemories(
        context,
        'I attack with my sword',
        'You strike the dragon!',
      );

      if (result.memories.length > 0) {
        await MemoryService.saveMemories(result.memories);
        expect(mockInsert).toHaveBeenCalled();
      }
    });
  });
});
