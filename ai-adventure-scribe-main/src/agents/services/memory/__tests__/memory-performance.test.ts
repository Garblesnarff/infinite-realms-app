import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { MemoryRepository } from '../MemoryRepository';
import { MemoryService } from '../MemoryService';

// This suite used to benchmark the browser's semantic path: invokeEmbedding()
// (supabase.functions.invoke('generate-embedding')) followed by a match_memories RPC. Neither
// exists in the client any more — #1822 established the embedding call had been gated off for
// the entire life of the memories table, and PR2 moved embedding to the server. What is left
// to measure here is the retrieval that live play actually performs: the session's top
// memories via userDataApi.listMemories().
const { mockListMemories: baseMockListMemories, setQueryResult, setQueryLatency } = vi.hoisted(
  () => {
    let queryResult: any = [];
    let latencyMs = 0;

    const listMemories = vi.fn(async () => {
      if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
      return queryResult;
    });

    return {
      mockListMemories: listMemories,
      setQueryResult: (result: any[]) => {
        queryResult = result;
      },
      setQueryLatency: (ms: number) => {
        latencyMs = ms;
      },
    };
  },
);

// Mock userDataApi - MemoryRepository's real backing store as of the REST API
// migration (see src/agents/services/memory/MemoryRepository.ts).
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    listMemories: baseMockListMemories,
    matchMemories: vi.fn(),
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

const buildMemories = (count: number): any[] =>
  Array(count)
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

describe('Memory Performance Tests', () => {
  let repository: MemoryRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new MemoryRepository();
    setQueryResult([]);
    setQueryLatency(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Retrieval Performance (<100ms requirement)', () => {
    it('should retrieve relevant memories in under 100ms', async () => {
      setQueryResult(buildMemories(10));
      setQueryLatency(10); // Simulate 10ms server latency

      const startTime = performance.now();
      const results = await MemoryService.getRelevantMemories('session-123', 'test query', 10);
      const duration = performance.now() - startTime;

      expect(results).toHaveLength(10);
      expect(duration).toBeLessThan(100);
    });

    it('should retrieve top memories in under 50ms', async () => {
      setQueryResult(buildMemories(10));

      const startTime = performance.now();
      await repository.loadTopMemories('session-123', 10);
      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(50);
    });

    it('should maintain performance with concurrent retrievals', async () => {
      setQueryResult(buildMemories(5));
      setQueryLatency(15);

      const queries = [
        'quest information',
        'npc details',
        'location description',
        'item properties',
        'event history',
      ];

      const startTime = performance.now();
      await Promise.all(queries.map((q) => MemoryService.getRelevantMemories('session-123', q, 5)));
      const duration = performance.now() - startTime;

      // Concurrent requests should complete faster than sequential
      expect(duration).toBeLessThan(500);
    });
  });

  describe('Large Memory Sets (>1000 memories)', () => {
    it('should handle retrieval from large memory set efficiently', async () => {
      // Simulate a session with 1000+ memories, of which the server returns the top 50
      setQueryResult(buildMemories(50));
      setQueryLatency(30);

      const startTime = performance.now();
      const results = await MemoryService.getRelevantMemories('session-123', 'find relevant', 50);
      const duration = performance.now() - startTime;

      expect(results).toHaveLength(50);
      expect(duration).toBeLessThan(100);
    });

    it('should only receive the requested limit, not the whole dataset', async () => {
      setQueryResult(buildMemories(10)); // Backend honors the limit

      const results = await MemoryService.getRelevantMemories('session-123', 'query', 10);

      expect(results).toHaveLength(10);
      expect(baseMockListMemories).toHaveBeenCalledWith('session-123', { limit: 10, top: true });
    });
  });

  describe('Concurrent Retrieval Requests', () => {
    it('should handle 10 concurrent retrieval requests', async () => {
      setQueryResult(buildMemories(5));
      setQueryLatency(20);

      const startTime = performance.now();
      const results = await Promise.all(
        Array(10)
          .fill(null)
          .map((_, i) => MemoryService.getRelevantMemories('session-123', `query ${i}`, 5)),
      );
      const duration = performance.now() - startTime;

      expect(results).toHaveLength(10);
      expect(results.every((r) => r.length === 5)).toBe(true);
      // Concurrent should be much faster than 10 * 20ms = 200ms
      expect(duration).toBeLessThan(300);
    });

    it('should handle 50 concurrent retrieval requests without degradation', async () => {
      setQueryResult(buildMemories(3));
      setQueryLatency(15);

      const startTime = performance.now();
      const results = await Promise.all(
        Array(50)
          .fill(null)
          .map((_, i) => MemoryService.getRelevantMemories(`session-${i % 5}`, `query ${i}`, 3)),
      );
      const duration = performance.now() - startTime;

      expect(results).toHaveLength(50);
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
    });
  });

  describe('Memory Operations Under Load', () => {
    it('should maintain throughput across sustained batches', async () => {
      setQueryResult(buildMemories(5));
      setQueryLatency(10);

      const batches = 5;
      const batchSize = 10;

      const startTime = performance.now();
      for (let i = 0; i < batches; i++) {
        await Promise.all(
          Array(batchSize)
            .fill(null)
            .map(() => MemoryService.getRelevantMemories('session-123', 'query', 5)),
        );
      }
      const duration = performance.now() - startTime;

      expect(baseMockListMemories).toHaveBeenCalledTimes(batches * batchSize);
      expect(duration).toBeLessThan(1000);
    });
  });
});
