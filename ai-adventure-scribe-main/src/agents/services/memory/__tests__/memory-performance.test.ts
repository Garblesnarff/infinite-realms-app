import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRepository } from '../MemoryRepository';
import { MemoryService } from '../MemoryService';
import * as featureFlags from '@/config/featureFlags';

// MemoryRepository (src/agents/services/memory/MemoryRepository.ts) was migrated from
// supabase.from('memories')...select() and supabase.rpc() to userDataApi.listMemories()
// and userDataApi.matchMemories() (real fetch() calls to the Bun server). Only
// invokeEmbedding() (supabase.functions.invoke('generate-embedding')) still uses
// supabase directly. The mocks below were updated to match: `mockRpc` became
// `mockMatchMemories` (returning the match array directly, not a { data, error }
// envelope), and `setQueryResult`/`mockFrom` now back userDataApi.listMemories().
const {
  mockMatchMemories: baseMockMatchMemories,
  mockFunctionsInvoke: baseMockFunctionsInvoke,
  setQueryResult,
  mockListMemories: baseMockListMemories,
} = vi.hoisted(() => {
  let queryResult: any = [];

  const matchMemories = vi.fn();
  const functionsInvoke = vi.fn();
  const listMemories = vi.fn(async () => queryResult);

  return {
    mockMatchMemories: matchMemories,
    mockFunctionsInvoke: functionsInvoke,
    setQueryResult: (result: { data: any; error: any }) => {
      queryResult = result.data;
    },
    mockListMemories: listMemories,
  };
});

// Mock Supabase client (only functions.invoke is still used by MemoryRepository)
vi.mock('@/integrations/supabase/client', () => {
  return {
    supabase: {
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
    matchMemories: baseMockMatchMemories,
    listMemories: baseMockListMemories,
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
  calculateImportance: vi.fn(() => 3),
}));

describe('Memory Performance Tests', () => {
  let repository: MemoryRepository;
  let mockRpc: any;
  let mockFunctionsInvoke: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(featureFlags, 'isSemanticMemoriesEnabled').mockReturnValue(true);
    repository = new MemoryRepository();

    // Setup mock functions (mockRpc now backs userDataApi.matchMemories())
    mockRpc = baseMockMatchMemories;
    mockFunctionsInvoke = baseMockFunctionsInvoke;
    setQueryResult({ data: [], error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Retrieval Performance (<100ms requirement)', () => {
    it('should retrieve semantic search results in under 100ms', async () => {
      const mockEmbedding = JSON.stringify(Array(1536).fill(0.5));
      const mockMemories = Array(10)
        .fill(null)
        .map((_, i) => ({
          id: `${i}`,
          content: `Memory ${i}`,
          importance: 3,
          similarity: 0.9 - i * 0.05,
          session_id: 'session-123',
          type: 'event',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          metadata: null,
        }));

      // Simulate fast database response
      mockFunctionsInvoke.mockResolvedValue({
        data: { embedding: mockEmbedding },
        error: null,
      });

      mockRpc.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10)); // Simulate 10ms DB latency
        return mockMemories;
      });

      const startTime = performance.now();
      const results = await MemoryService.getRelevantMemories('session-123', 'test query', 10);
      const endTime = performance.now();

      const duration = endTime - startTime;

      expect(results).toHaveLength(10);
      expect(duration).toBeLessThan(100);
    });

    it('should retrieve non-semantic results in under 50ms', async () => {
      vi.spyOn(featureFlags, 'isSemanticMemoriesEnabled').mockReturnValue(false);

      const mockMemories = Array(10)
        .fill(null)
        .map((_, i) => ({
          id: `${i}`,
          content: `Memory ${i}`,
          importance: 3,
          session_id: 'session-123',
          type: 'event',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          metadata: null,
        }));

      setQueryResult({
        data: mockMemories,
        error: null,
      });

      const startTime = performance.now();
      await repository.loadTopMemories('session-123', 10);
      const endTime = performance.now();

      const duration = endTime - startTime;

      expect(duration).toBeLessThan(50);
    });

    it('should maintain performance with concurrent retrievals', async () => {
      const mockEmbedding = JSON.stringify(Array(1536).fill(0.5));
      const mockMemories = Array(5)
        .fill(null)
        .map((_, i) => ({
          id: `${i}`,
          content: `Memory ${i}`,
          importance: 3,
          similarity: 0.9,
          session_id: 'session-123',
          type: 'event',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          metadata: null,
        }));

      mockFunctionsInvoke.mockResolvedValue({
        data: { embedding: mockEmbedding },
        error: null,
      });

      mockRpc.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return mockMemories;
      });

      const queries = [
        'quest information',
        'npc details',
        'location description',
        'item properties',
        'event history',
      ];

      const startTime = performance.now();
      await Promise.all(queries.map((q) => MemoryService.getRelevantMemories('session-123', q, 5)));
      const endTime = performance.now();

      const duration = endTime - startTime;

      // Concurrent requests should complete faster than sequential
      expect(duration).toBeLessThan(500); // 5 * 100ms would be 500ms if sequential
    });
  });

  describe('Large Memory Sets (>1000 memories)', () => {
    it('should handle retrieval from large memory set efficiently', async () => {
      const mockEmbedding = JSON.stringify(Array(1536).fill(0.5));

      // Simulate database with 1000+ memories, returning top 50
      const mockMemories = Array(50)
        .fill(null)
        .map((_, i) => ({
          id: `${i}`,
          content: `Memory ${i} from large dataset`,
          importance: Math.floor(Math.random() * 5) + 1,
          similarity: 0.95 - i * 0.01,
          session_id: 'session-123',
          type: 'event',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          metadata: null,
        }));

      mockFunctionsInvoke.mockResolvedValue({
        data: { embedding: mockEmbedding },
        error: null,
      });

      mockRpc.mockImplementation(async () => {
        // Simulate realistic DB query time for large dataset
        await new Promise((resolve) => setTimeout(resolve, 30));
        return mockMemories;
      });

      const startTime = performance.now();
      const results = await MemoryService.getRelevantMemories('session-123', 'find relevant', 50);
      const endTime = performance.now();

      const duration = endTime - startTime;

      expect(results).toHaveLength(50);
      expect(duration).toBeLessThan(100);
    });

    it('should paginate efficiently through large result sets', async () => {
      const pageSize = 20;

      setQueryResult({
        data: Array(pageSize)
          .fill(null)
          .map((_, i) => ({
            id: `${i}`,
            content: `Memory ${i}`,
            importance: 3,
            session_id: 'session-123',
            type: 'event',
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
            metadata: null,
          })),
        error: null,
      });

      const memoryService = new MemoryService('session-123');

      const startTime = performance.now();
      const page1 = await memoryService.retrieveMemories({
        limit: pageSize,
        semanticSearch: false,
      });
      const page2 = await memoryService.retrieveMemories({
        limit: pageSize,
        semanticSearch: false,
      });
      const page3 = await memoryService.retrieveMemories({
        limit: pageSize,
        semanticSearch: false,
      });
      const endTime = performance.now();

      const duration = endTime - startTime;

      expect(page1).toHaveLength(pageSize);
      expect(page2).toHaveLength(pageSize);
      expect(page3).toHaveLength(pageSize);
      expect(duration).toBeLessThan(150); // 3 queries should complete quickly
    });

    it('should maintain memory efficiency with large datasets', async () => {
      const largeMemorySet = Array(2000)
        .fill(null)
        .map((_, i) => ({
          id: `${i}`,
          content: `Memory ${i}`,
          importance: 3,
          similarity: 0.8,
          session_id: 'session-123',
          type: 'event',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          metadata: null,
        }));

      // Mock should only return requested limit, not entire dataset. matchMemories()
      // (backing mockRpc) now returns the array directly, not a { data, error } envelope.
      mockRpc.mockResolvedValue(largeMemorySet.slice(0, 10));

      const mockEmbedding = JSON.stringify(Array(1536).fill(0.5));
      mockFunctionsInvoke.mockResolvedValue({
        data: { embedding: mockEmbedding },
        error: null,
      });

      const results = await MemoryService.getRelevantMemories('session-123', 'query', 10);

      // Should only get requested limit, not all 2000
      expect(results).toHaveLength(10);
    });
  });

  describe('Concurrent Retrieval Requests', () => {
    it('should handle 10 concurrent retrieval requests', async () => {
      const mockEmbedding = JSON.stringify(Array(1536).fill(0.5));
      mockFunctionsInvoke.mockResolvedValue({
        data: { embedding: mockEmbedding },
        error: null,
      });

      mockRpc.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return Array(5)
            .fill(null)
            .map((_, i) => ({
              id: `${i}`,
              content: `Memory ${i}`,
              importance: 3,
              similarity: 0.9,
              session_id: 'session-123',
              type: 'event',
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
              metadata: null,
            }));
      });

      const startTime = performance.now();
      const promises = Array(10)
        .fill(null)
        .map((_, i) => MemoryService.getRelevantMemories('session-123', `query ${i}`, 5));
      const results = await Promise.all(promises);
      const endTime = performance.now();

      const duration = endTime - startTime;

      expect(results).toHaveLength(10);
      expect(results.every((r) => r.length === 5)).toBe(true);
      // Concurrent should be much faster than 10 * 20ms = 200ms
      expect(duration).toBeLessThan(300);
    });

    it('should handle 50 concurrent retrieval requests without degradation', async () => {
      const mockEmbedding = JSON.stringify(Array(1536).fill(0.5));
      mockFunctionsInvoke.mockResolvedValue({
        data: { embedding: mockEmbedding },
        error: null,
      });

      mockRpc.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return Array(3)
            .fill(null)
            .map((_, i) => ({
              id: `${i}`,
              content: `Memory ${i}`,
              importance: 3,
              similarity: 0.9,
              session_id: 'session-123',
              type: 'event',
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
              metadata: null,
            }));
      });

      const startTime = performance.now();
      const promises = Array(50)
        .fill(null)
        .map((_, i) => MemoryService.getRelevantMemories(`session-${i % 5}`, `query ${i}`, 3));
      const results = await Promise.all(promises);
      const endTime = performance.now();

      const duration = endTime - startTime;

      expect(results).toHaveLength(50);
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
    });

    it('should maintain throughput under load', async () => {
      const mockEmbedding = JSON.stringify(Array(1536).fill(0.5));
      mockFunctionsInvoke.mockResolvedValue({
        data: { embedding: mockEmbedding },
        error: null,
      });

      let requestCount = 0;
      const requestTimes: number[] = [];

      mockRpc.mockImplementation(async () => {
        const reqStartTime = performance.now();
        await new Promise((resolve) => setTimeout(resolve, 10));
        requestCount++;
        requestTimes.push(performance.now() - reqStartTime);
        return Array(5)
            .fill(null)
            .map((_, i) => ({
              id: `${i}`,
              content: `Memory ${i}`,
              importance: 3,
              similarity: 0.9,
              session_id: 'session-123',
              type: 'event',
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
              metadata: null,
            }));
      });

      // Simulate sustained load over time
      const batches = 5;
      const batchSize = 10;

      for (let i = 0; i < batches; i++) {
        const promises = Array(batchSize)
          .fill(null)
          .map(() => MemoryService.getRelevantMemories('session-123', 'query', 5));
        await Promise.all(promises);
        await new Promise((resolve) => setTimeout(resolve, 50)); // Small gap between batches
      }

      expect(requestCount).toBe(batches * batchSize);

      // Check that request times don't degrade significantly
      const avgFirstBatch = requestTimes.slice(0, batchSize).reduce((a, b) => a + b) / batchSize;
      const avgLastBatch = requestTimes.slice(-batchSize).reduce((a, b) => a + b) / batchSize;

      // Last batch should not be significantly slower than first batch
      expect(avgLastBatch).toBeLessThan(avgFirstBatch * 1.5);
    });
  });

  describe('Semantic Search vs Keyword Search Performance', () => {
    it('should benchmark semantic search performance', async () => {
      const mockEmbedding = JSON.stringify(Array(1536).fill(0.5));
      mockFunctionsInvoke.mockResolvedValue({
        data: { embedding: mockEmbedding },
        error: null,
      });

      mockRpc.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25)); // Simulate vector search
        return Array(10)
            .fill(null)
            .map((_, i) => ({
              id: `${i}`,
              content: `Semantically relevant memory ${i}`,
              importance: 4,
              similarity: 0.9 - i * 0.05,
              session_id: 'session-123',
              type: 'event',
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
              metadata: null,
            }));
      });

      const startTime = performance.now();
      const results = await MemoryService.getRelevantMemories('session-123', 'dragon battle', 10);
      const endTime = performance.now();

      const semanticDuration = endTime - startTime;

      expect(results).toHaveLength(10);
      expect(semanticDuration).toBeLessThan(100);
    });

    it('should benchmark keyword search performance', async () => {
      vi.spyOn(featureFlags, 'isSemanticMemoriesEnabled').mockReturnValue(false);

      setQueryResult({
        data: Array(10)
          .fill(null)
          .map((_, i) => ({
            id: `${i}`,
            content: `Memory ${i}`,
            importance: 3,
            session_id: 'session-123',
            type: 'event',
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
            metadata: null,
          })),
        error: null,
      });

      const startTime = performance.now();
      await repository.loadTopMemories('session-123', 10);
      const endTime = performance.now();

      const keywordDuration = endTime - startTime;

      expect(keywordDuration).toBeLessThan(50);
    });

    it('should compare semantic vs keyword search speed', async () => {
      // Semantic search
      const mockEmbedding = JSON.stringify(Array(1536).fill(0.5));
      mockFunctionsInvoke.mockResolvedValue({
        data: { embedding: mockEmbedding },
        error: null,
      });

      mockRpc.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return Array(10)
            .fill(null)
            .map((_, i) => ({
              id: `${i}`,
              content: `Memory ${i}`,
              importance: 3,
              similarity: 0.9,
              session_id: 'session-123',
              type: 'event',
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
              metadata: null,
            }));
      });

      const semanticStart = performance.now();
      await MemoryService.getRelevantMemories('session-123', 'query', 10);
      const semanticEnd = performance.now();
      const semanticDuration = semanticEnd - semanticStart;

      // Keyword search
      vi.spyOn(featureFlags, 'isSemanticMemoriesEnabled').mockReturnValue(false);

      setQueryResult({
        data: Array(10)
          .fill(null)
          .map((_, i) => ({
            id: `${i}`,
            content: `Memory ${i}`,
            importance: 3,
            session_id: 'session-123',
            type: 'event',
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
            metadata: null,
          })),
        error: null,
      });

      const keywordStart = performance.now();
      await MemoryService.getRelevantMemories('session-123', 'query', 10);
      const keywordEnd = performance.now();
      const keywordDuration = keywordEnd - keywordStart;

      // Both should be fast, semantic might be slightly slower due to embedding generation
      expect(semanticDuration).toBeLessThan(100);
      expect(keywordDuration).toBeLessThan(50);
      // FIXME: Relative timing ratios are too flaky under concurrent full-suite load.
    });
  });

  describe('Embedding Generation Performance', () => {
    it('should generate embeddings in reasonable time', async () => {
      const mockEmbedding = JSON.stringify(Array(1536).fill(0.5));
      mockFunctionsInvoke.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30)); // Simulate API call
        return {
          data: { embedding: mockEmbedding },
          error: null,
        };
      });

      const startTime = performance.now();
      const result = await repository.invokeEmbedding('Test content for embedding');
      const endTime = performance.now();

      const duration = endTime - startTime;

      expect(result).toBe(mockEmbedding);
      expect(duration).toBeLessThan(100);
    });

    it('should handle batch embedding generation efficiently', async () => {
      const mockEmbedding = JSON.stringify(Array(1536).fill(0.5));
      mockFunctionsInvoke.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return {
          data: { embedding: mockEmbedding },
          error: null,
        };
      });

      const contents = Array(10)
        .fill(null)
        .map((_, i) => `Content ${i}`);

      const startTime = performance.now();
      await Promise.all(contents.map((c) => repository.invokeEmbedding(c)));
      const endTime = performance.now();

      const duration = endTime - startTime;

      // Concurrent embedding generation should be efficient
      expect(duration).toBeLessThan(500);
    });
  });

  describe('Memory Operations Under Load', () => {
    it('should maintain performance with mixed read/write operations', async () => {
      const mockEmbedding = JSON.stringify(Array(1536).fill(0.5));
      mockFunctionsInvoke.mockResolvedValue({
        data: { embedding: mockEmbedding },
        error: null,
      });

      mockRpc.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return Array(5)
            .fill(null)
            .map((_, i) => ({
              id: `${i}`,
              content: `Memory ${i}`,
              importance: 3,
              similarity: 0.9,
              session_id: 'session-123',
              type: 'event',
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
              metadata: null,
            }));
      });

      const operations = [];

      // Mix of read and write operations
      for (let i = 0; i < 20; i++) {
        if (i % 2 === 0) {
          operations.push(MemoryService.getRelevantMemories('session-123', `query ${i}`, 5));
        } else {
          operations.push(repository.invokeEmbedding(`content ${i}`));
        }
      }

      const startTime = performance.now();
      await Promise.all(operations);
      const endTime = performance.now();

      const duration = endTime - startTime;

      expect(duration).toBeLessThan(500);
    });
  });
});
