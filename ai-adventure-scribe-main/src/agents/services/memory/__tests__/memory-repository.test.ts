import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRepository } from '../MemoryRepository';
import * as featureFlags from '@/config/featureFlags';
import { MEMORY_SELECT_COLUMNS } from '@/types/memory';

// Mock Supabase client
vi.mock('@/integrations/supabase/client', () => {
  return {
    supabase: {
      from: vi.fn(() => ({
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
      })),
      rpc: vi.fn(),
      functions: {
        invoke: vi.fn(),
      },
    },
  };
});

vi.mock('@/services/user-data-api', async () => {
  const { supabase } = await import('@/integrations/supabase/client');
  return {
    userDataApi: {
      createMemories: async (records: unknown[]) => {
        const { data, error } = await supabase.from('memories').insert(records);
        if (error) throw error;
        return data || [];
      },
      listMemories: async (sessionId: string, options: any = {}) => {
        let query = supabase
          .from('memories')
          .select(MEMORY_SELECT_COLUMNS)
          .eq('session_id', sessionId);
        if (options.category) query = query.eq('metadata->category', options.category);
        if (options.recentMinutes) {
          query = query.gte(
            'created_at',
            new Date(Date.now() - options.recentMinutes * 60_000).toISOString(),
          );
        }
        if (options.minNarrativeWeight) {
          query = query.gte('narrative_weight', options.minNarrativeWeight);
        }
        query = options.top
          ? query
              .order('importance', { ascending: false })
              .order('created_at', { ascending: false })
          : query.order('created_at', { ascending: Boolean(options.minNarrativeWeight) });
        if (options.limit) query = query.limit(options.limit);
        const { data, error } = await query;
        if (error) throw error;
        return data || [];
      },
      matchMemories: async (
        sessionId: string,
        embedding: string,
        limit: number,
        threshold: number,
      ) => {
        const { data, error } = await supabase.rpc('match_memories', {
          query_embedding: embedding,
          session_id: sessionId,
          match_threshold: threshold,
          match_count: limit,
        });
        if (error) throw error;
        return data || [];
      },
    },
  };
});

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocking
import { supabase } from '@/integrations/supabase/client';

describe('Memory Repository', () => {
  let repository: MemoryRepository;
  let mockInsert: any;
  let mockSelect: any;
  let mockUpdate: any;
  let mockEq: any;
  let mockOrder: any;
  let mockLimit: any;
  let mockGte: any;
  let mockSingle: any;
  let mockRpc: any;
  let mockFunctionsInvoke: any;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new MemoryRepository();

    // Setup mock functions
    mockInsert = vi.fn();
    mockSelect = vi.fn();
    mockUpdate = vi.fn();
    mockEq = vi.fn();
    mockOrder = vi.fn();
    mockLimit = vi.fn();
    mockGte = vi.fn();
    mockSingle = vi.fn();
    mockRpc = vi.fn();
    mockFunctionsInvoke = vi.fn();

    // Setup default mock chains
    mockSelect.mockReturnThis();
    mockEq.mockReturnThis();
    mockOrder.mockReturnThis();
    mockLimit.mockReturnThis();
    mockGte.mockReturnThis();
    mockSingle.mockReturnThis();
    mockUpdate.mockReturnValue({
      eq: mockEq.mockReturnThis(),
    });

    vi.mocked(supabase.from).mockReturnValue({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
      eq: mockEq,
      order: mockOrder,
      limit: mockLimit,
      gte: mockGte,
      single: mockSingle,
    } as any);
    vi.mocked(supabase.rpc).mockImplementation(mockRpc as any);
    vi.mocked(supabase.functions.invoke).mockImplementation(mockFunctionsInvoke as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Database Operations', () => {
    describe('insertMemories', () => {
      it('should insert single memory successfully', async () => {
        mockInsert.mockResolvedValue({
          data: null,
          error: null,
        });

        vi.mocked(supabase.from).mockReturnValue({
          insert: mockInsert,
        } as any);

        const memory = {
          session_id: 'session-123',
          type: 'quest',
          content: 'Find the ancient artifact',
          importance: 5,
          embedding: JSON.stringify(Array(1536).fill(0.5)),
          metadata: { category: 'main_quest' },
        };

        await repository.insertMemories([memory]);

        expect(mockInsert).toHaveBeenCalledWith([memory]);
      });

      it('should insert multiple memories in batch', async () => {
        mockInsert.mockResolvedValue({
          data: null,
          error: null,
        });

        const memories = Array(10)
          .fill(null)
          .map((_, i) => ({
            session_id: 'session-123',
            type: 'event',
            content: `Event ${i}`,
            importance: 3,
            embedding: JSON.stringify(Array(1536).fill(0.5)),
            metadata: null,
          }));

        await repository.insertMemories(memories);

        expect(mockInsert).toHaveBeenCalledWith(memories);
      });

      it('should handle empty array gracefully', async () => {
        await repository.insertMemories([]);

        expect(mockInsert).not.toHaveBeenCalled();
      });

      it('should throw error on insert failure', async () => {
        mockInsert.mockResolvedValue({
          data: null,
          error: { message: 'Insert failed', code: '23505' },
        });

        const memory = {
          session_id: 'session-123',
          type: 'quest',
          content: 'Test',
          importance: 3,
          embedding: null,
          metadata: null,
        };

        await expect(repository.insertMemories([memory])).rejects.toThrow();
      });

      it('should handle constraint violations', async () => {
        mockInsert.mockResolvedValue({
          data: null,
          error: {
            message: 'duplicate key value violates unique constraint',
            code: '23505',
          },
        });

        const memory = {
          session_id: 'session-123',
          type: 'quest',
          content: 'Duplicate content',
          importance: 3,
          embedding: null,
          metadata: null,
        };

        await expect(repository.insertMemories([memory])).rejects.toThrow();
      });
    });

    describe('loadTopMemories', () => {
      it('should load memories ordered by importance', async () => {
        const mockMemories = [
          {
            id: '1',
            session_id: 'session-123',
            type: 'quest',
            content: 'High importance',
            importance: 5,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
            metadata: null,
          },
          {
            id: '2',
            session_id: 'session-123',
            type: 'event',
            content: 'Medium importance',
            importance: 3,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
            metadata: null,
          },
        ];

        mockLimit.mockResolvedValue({
          data: mockMemories,
          error: null,
        });

        const results = await repository.loadTopMemories('session-123', 10);

        expect(results).toEqual(mockMemories);
        expect(mockOrder).toHaveBeenCalledWith('importance', { ascending: false });
        expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: false });
      });

      it('should respect limit parameter', async () => {
        const mockMemories = Array(20)
          .fill(null)
          .map((_, i) => ({
            id: `${i}`,
            session_id: 'session-123',
            type: 'event',
            content: `Memory ${i}`,
            importance: 5 - Math.floor(i / 4),
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
            metadata: null,
          }));

        mockLimit.mockResolvedValue({
          data: mockMemories.slice(0, 15),
          error: null,
        });

        await repository.loadTopMemories('session-123', 15);

        expect(mockLimit).toHaveBeenCalledWith(15);
      });
    });
  });

  describe('RPC Function Calls', () => {
    beforeEach(() => {
      vi.spyOn(featureFlags, 'isSemanticMemoriesEnabled').mockReturnValue(true);
    });

    it('should call match_memories RPC with correct parameters', async () => {
      const mockEmbedding = JSON.stringify(Array(1536).fill(0.5));
      mockRpc.mockResolvedValue({
        data: [],
        error: null,
      });

      await repository.matchMemories('session-123', mockEmbedding, 10, 0.7);

      expect(mockRpc).toHaveBeenCalledWith('match_memories', {
        query_embedding: mockEmbedding,
        session_id: 'session-123',
        match_threshold: 0.7,
        match_count: 10,
      });
    });

    it('should return data from RPC call', async () => {
      const mockMemories = [
        {
          id: '1',
          content: 'Test memory',
          similarity: 0.9,
          session_id: 'session-123',
          type: 'event',
          importance: 3,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          metadata: null,
        },
      ];

      mockRpc.mockResolvedValue({
        data: mockMemories,
        error: null,
      });

      const results = await repository.matchMemories('session-123', 'embedding', 10, 0.7);

      expect(results).toEqual(mockMemories);
    });

    it('should handle null data from RPC', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: null,
      });

      const results = await repository.matchMemories('session-123', 'embedding', 10, 0.7);

      expect(results).toEqual([]);
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors', async () => {
      mockInsert.mockRejectedValue(new Error('Connection timeout'));

      const memory = {
        session_id: 'session-123',
        type: 'event',
        content: 'Test',
        importance: 3,
        embedding: null,
        metadata: null,
      };

      await expect(repository.insertMemories([memory])).rejects.toThrow('Connection timeout');
    });

    it('should handle malformed data errors', async () => {
      mockInsert.mockResolvedValue({
        data: null,
        error: {
          message: 'invalid input syntax for type json',
          code: '22P02',
        },
      });

      const memory = {
        session_id: 'session-123',
        type: 'event',
        content: 'Test',
        importance: 3,
        embedding: 'invalid json',
        metadata: null,
      };

      await expect(repository.insertMemories([memory])).rejects.toThrow();
    });

    it('should handle foreign key constraint violations', async () => {
      mockInsert.mockResolvedValue({
        data: null,
        error: {
          message: 'insert or update on table "memories" violates foreign key constraint',
          code: '23503',
        },
      });

      const memory = {
        session_id: 'non-existent-session',
        type: 'event',
        content: 'Test',
        importance: 3,
        embedding: null,
        metadata: null,
      };

      await expect(repository.insertMemories([memory])).rejects.toThrow();
    });

    it('should handle RPC function not found errors gracefully', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: {
          code: '42883',
          message: 'function match_memories does not exist',
        },
      });

      const results = await repository.matchMemories('session-123', 'embedding', 10, 0.7);

      expect(results).toEqual([]);
    });

    it('should throw on unexpected RPC errors', async () => {
      vi.spyOn(featureFlags, 'isSemanticMemoriesEnabled').mockReturnValue(true);

      mockRpc.mockResolvedValue({
        data: null,
        error: {
          code: 'UNEXPECTED',
          message: 'Something went wrong',
        },
      });

      vi.mocked(supabase.rpc).mockImplementation(mockRpc as any);

      await expect(repository.matchMemories('session-123', 'embedding', 10, 0.7)).rejects.toThrow();
    });
  });

  describe('Transaction Handling', () => {
    it('should handle successful batch insert as transaction', async () => {
      mockInsert.mockResolvedValue({
        data: null,
        error: null,
      });

      const memories = Array(100)
        .fill(null)
        .map((_, i) => ({
          session_id: 'session-123',
          type: 'event',
          content: `Memory ${i}`,
          importance: 3,
          embedding: JSON.stringify(Array(1536).fill(0.5)),
          metadata: null,
        }));

      await repository.insertMemories(memories);

      // All memories should be inserted in one call (transaction)
      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockInsert).toHaveBeenCalledWith(memories);
    });

    it('should rollback on partial insert failure', async () => {
      mockInsert.mockResolvedValue({
        data: null,
        error: {
          message: 'Partial insert failed',
          code: '23505',
        },
      });

      const memories = Array(50)
        .fill(null)
        .map((_, i) => ({
          session_id: 'session-123',
          type: 'event',
          content: `Memory ${i}`,
          importance: 3,
          embedding: null,
          metadata: null,
        }));

      await expect(repository.insertMemories(memories)).rejects.toThrow();
    });
  });
});
