import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryService } from '../MemoryService';
import * as featureFlags from '@/config/featureFlags';
import type { MemoryType } from '@/types/memory';
import { llmApiClient } from '@/infrastructure/api';

// MemoryRepository (src/agents/services/memory/MemoryRepository.ts) was migrated from
// supabase.from('memories')...insert()/update()/select() and supabase.rpc() to
// userDataApi.createMemories()/updateMemoryScores()/listMemories()/getMemory()/
// matchMemories() (real fetch() calls to the Bun server). Only invokeEmbedding()
// (still supabase.functions.invoke('generate-embedding')) remains on supabase. The
// mocks below were updated to match the current call sites; a
// `queryResult`-style helper (`setQueryResult`) is kept so the many call sites below
// didn't need renaming, but it now backs userDataApi.listMemories/getMemory rather than
// a supabase query builder.
const {
  mockInsert: baseMockInsert,
  mockUpdate: baseMockUpdate,
  mockListMemories: baseMockListMemories,
  mockGetMemory: baseMockGetMemory,
  mockFunctionsInvoke: baseMockFunctionsInvoke,
  setQueryResult,
} = vi.hoisted(() => {
  // Shared result queue used by both listMemories() and getMemory() - tests call
  // setQueryResult() before invoking the code under test to control what the "backend"
  // returns next, mirroring the old supabase query-builder `queryResult` pattern.
  let queryResult: any = [];

  const insert = vi.fn(async () => []);
  const update = vi.fn(async () => undefined);
  const listMemories = vi.fn(async () => queryResult);
  const getMemory = vi.fn(async () => queryResult);
  const functionsInvoke = vi.fn();

  return {
    mockInsert: insert,
    mockUpdate: update,
    mockListMemories: listMemories,
    mockGetMemory: getMemory,
    mockFunctionsInvoke: functionsInvoke,
    setQueryResult: (result: { data: any; error: any }) => {
      queryResult = result.data;
    },
  };
});

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
    updateMemoryScores: baseMockUpdate,
    listMemories: baseMockListMemories,
    getMemory: baseMockGetMemory,
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
  let mockUpdate: any;
  let mockFunctionsInvoke: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(featureFlags, 'isSemanticMemoriesEnabled').mockReturnValue(true);

    mockInsert = baseMockInsert;
    mockUpdate = baseMockUpdate;
    mockFunctionsInvoke = baseMockFunctionsInvoke;
    setQueryResult({ data: [], error: null });
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

  describe('Memory Reinforcement', () => {
    it('should boost memory importance when reinforced', async () => {
      const mockMemory = {
        id: 'memory-123',
        importance: 3,
        narrative_weight: 5,
      };

      setQueryResult({
        data: mockMemory,
        error: null,
      });

      mockUpdate.mockResolvedValue({
        data: null,
        error: null,
      });

      await MemoryService.reinforceMemory('memory-123', 1);

      // repository.updateMemoryScores() now calls userDataApi.updateMemoryScores(memoryId,
      // updates) - the memoryId is a separate first argument, not folded into the update
      // payload (see MemoryRepository.updateMemoryScores).
      expect(mockUpdate).toHaveBeenCalledWith('memory-123', {
        importance: 4,
        narrative_weight: 6,
      });
    });

    it('should cap importance at 5', async () => {
      const mockMemory = {
        id: 'memory-123',
        importance: 5,
        narrative_weight: 10,
      };

      setQueryResult({
        data: mockMemory,
        error: null,
      });

      mockUpdate.mockResolvedValue({
        data: null,
        error: null,
      });

      await MemoryService.reinforceMemory('memory-123', 2);

      expect(mockUpdate).toHaveBeenCalledWith('memory-123', {
        importance: 5, // Should not exceed 5
        narrative_weight: 10, // Should not exceed 10
      });
    });

    it('should handle non-existent memory gracefully', async () => {
      setQueryResult({
        data: null,
        error: null,
      });

      await expect(MemoryService.reinforceMemory('non-existent', 1)).resolves.not.toThrow();

      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('Fiction-Ready Memories', () => {
    it('should retrieve memories with high narrative weight', async () => {
      const mockMemories = [
        {
          id: '1',
          type: 'plot_point',
          content: "The hero's secret is revealed",
          importance: 5,
          narrative_weight: 9,
          session_id: 'session-123',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          metadata: null,
        },
        {
          id: '2',
          type: 'character_moment',
          content: 'A moment of great sacrifice',
          importance: 5,
          narrative_weight: 8,
          session_id: 'session-123',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          metadata: null,
        },
      ];

      setQueryResult({
        data: mockMemories,
        error: null,
      });

      const results = await MemoryService.getFictionReadyMemories('session-123', 6);

      expect(results).toHaveLength(2);
      expect(results.every((m) => (m as any).narrative_weight >= 6)).toBe(true);
    });
  });
});
