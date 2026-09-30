import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryService } from '../MemoryService';
import type { MemoryType } from '@/types/memory';
import { llmApiClient } from '@/infrastructure/api';

// MemoryRepository (src/agents/services/memory/MemoryRepository.ts) writes through
// userDataApi.createMemories() (a real fetch() to the Bun server). It no longer touches
// supabase at all: invokeEmbedding() and its 'generate-embedding' edge function call were
// removed in #1822 once the server took ownership of embedding a memory after inserting it.
const { mockInsert: baseMockInsert } = vi.hoisted(() => ({
  mockInsert: vi.fn(async () => []),
}));

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
    submitMemoryExtraction: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('Memory Service Integration', () => {
  let mockInsert: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockInsert = baseMockInsert;
    vi.mocked(llmApiClient.submitMemoryExtraction).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Memory Importance Scoring', () => {
    it('should clamp importance to the 1-10 range', async () => {
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
          importance: 14, // Should be clamped to 10
          metadata: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
        {
          session_id: 'session-123',
          type: 'general' as MemoryType,
          content: 'General memory',
          importance: 0, // Should be clamped to 1
          metadata: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ];

      await MemoryService.saveMemories(memories);

      const insertCalls = mockInsert.mock.calls;
      expect(insertCalls[0][0][0].importance).toBe(10);
      expect(insertCalls[0][0][1].importance).toBe(1);
    });
  });

  describe('Memory Extraction from Conversation', () => {
    it('strips asset markers from the extraction prompt and persisted memory', async () => {
      const input = '[ASSET:npc:sergeant-vance] Sergeant Vance steps forward.';

      MemoryService.extractMemories(
        {
          sessionId: 'session-123',
          campaignId: 'campaign-456',
          characterId: 'char-789',
          currentMessage: 'I look toward the guard',
          recentMessages: [],
        },
        'I look toward the guard',
        input,
      );

      const extractionPrompt = vi.mocked(llmApiClient.submitMemoryExtraction).mock.calls[0]?.[0]
        .prompt as string;
      expect(extractionPrompt).toContain('DM: Sergeant Vance steps forward.');
      expect(extractionPrompt).not.toContain('[ASSET:');

      await MemoryService.saveMemories([
        {
          session_id: 'session-123',
          type: 'npc',
          content: input,
          importance: 4,
          metadata: {},
        },
      ]);

      expect(mockInsert).toHaveBeenLastCalledWith([
        expect.objectContaining({
          content: 'Sergeant Vance steps forward.',
        }),
      ]);
    });

    it('should extract memories from conversation context', async () => {
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

      MemoryService.extractMemories(
        context,
        'I search for the sacred relic',
        'The high priest reveals a hidden chamber containing the relic',
      );

      // The server owns parsing and persistence (#2148); the browser submits one job.
      expect(llmApiClient.submitMemoryExtraction).toHaveBeenCalledTimes(1);
      const job = vi.mocked(llmApiClient.submitMemoryExtraction).mock.calls[0][0];
      expect(job).toMatchObject({
        sessionId: 'session-123',
        characterId: 'char-789',
        kind: 'memories',
        maxTokens: 1000,
      });
      expect(job.prompt).toContain('Location: Ancient Temple');
      expect(job.prompt).toContain('Active NPCs: High Priest');
      expect(job.prompt).toContain('Player: I search for the sacred relic');
    });

    // Compound-type normalization of extracted memories moved to the server with the write
    // (server-bun memory-extraction-job.test.ts). The browser path no longer writes them at all.
    it('writes nothing from the browser for an extraction: the server persists it', async () => {
      MemoryService.extractMemories(
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
      await Promise.resolve();

      expect(llmApiClient.submitMemoryExtraction).toHaveBeenCalledTimes(1);
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('normalizes types again at the memory write boundary', async () => {
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
      // The browser sends content, not vectors (#1822).
      expect(mockInsert.mock.calls[0][0][0]).not.toHaveProperty('embedding');
    });

    it('returns without waiting for the extraction to finish (#2148)', () => {
      // A submit that never settles: extractMemories must still return synchronously.
      vi.mocked(llmApiClient.submitMemoryExtraction).mockReturnValue(new Promise(() => {}));

      const context = {
        sessionId: 'session-123',
        campaignId: 'campaign-456',
        characterId: 'char-789',
        currentMessage: 'I attack the dragon',
        recentMessages: ['A dragon appears'],
      };

      const result = MemoryService.extractMemories(
        context,
        'I attack with my sword',
        'You strike the dragon!',
      );

      expect(result).toBeUndefined();
      expect(llmApiClient.submitMemoryExtraction).toHaveBeenCalledTimes(1);
    });
  });
});
