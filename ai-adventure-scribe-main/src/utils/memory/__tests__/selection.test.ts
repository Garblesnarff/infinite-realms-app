import { describe, it, expect } from 'vitest';

import {
  cosineSimilarity,
  calculateMemoryScore,
  selectRelevantMemories,
  RECENCY_WEIGHT,
  IMPORTANCE_WEIGHT,
  RELEVANCE_WEIGHT
} from '../selection';

import type { MessageContext } from '@/types/game';
import type { Memory } from '@/types/memory';

describe('memory selection utility', () => {
  describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      const v = [1, 0, 1];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1);
    });

    it('should return 0 for orthogonal vectors', () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    });

    it('should return 0 for vectors of different lengths', () => {
      expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
    });

    it('should return 0 for null/undefined inputs', () => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      expect(cosineSimilarity(null as any, [1])).toBe(0);
      expect(cosineSimilarity([1], undefined as any)).toBe(0);
    });

    it('should handle zero vectors', () => {
      expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
    });
  });

  describe('calculateMemoryScore', () => {
    const now = Date.now();
    const mockMemory: Memory = {
      id: '1',
      content: 'The party is in Neverwinter.',
      importance: 5,
      created_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
      type: 'location',
      metadata: null,
    };

    it('should calculate score based on recency and importance', () => {
      const context: MessageContext = { location: 'Waterdeep' };
      const score = calculateMemoryScore(mockMemory, context);

      // recencyScore = exp(0) = 1
      // importanceScore = 5/5 = 1
      // relevanceScore = 0
      const expected = (1 * RECENCY_WEIGHT) + (1 * IMPORTANCE_WEIGHT) + (0 * RELEVANCE_WEIGHT);
      expect(score).toBeCloseTo(expected);
    });

    it('should add relevance bonus if location matches', () => {
      const context: MessageContext = { location: 'Neverwinter' };
      const score = calculateMemoryScore(mockMemory, context);

      // relevanceScore = 0.3
      const expected = (1 * RECENCY_WEIGHT) + (1 * IMPORTANCE_WEIGHT) + (0.3 * RELEVANCE_WEIGHT);
      expect(score).toBeCloseTo(expected);
    });

    it('should factor in embedding similarity', () => {
      const memoryWithEmbedding: Memory = {
        ...mockMemory,
        embedding: [1, 0, 0],
      };
      const queryEmbedding = [1, 0, 0];
      const context: MessageContext = { location: 'Waterdeep' };

      const score = calculateMemoryScore(memoryWithEmbedding, context, queryEmbedding);

      // similarity = 1
      // relevanceScore = 1 * 0.7 = 0.7
      const expected = (1 * RECENCY_WEIGHT) + (1 * IMPORTANCE_WEIGHT) + (0.7 * RELEVANCE_WEIGHT);
      expect(score).toBeCloseTo(expected);
    });

    it('should handle stringified embeddings', () => {
        const memoryWithEmbedding: Memory = {
          ...mockMemory,
          embedding: JSON.stringify([1, 0, 0]),
        };
        const queryEmbedding = [1, 0, 0];
        const score = calculateMemoryScore(memoryWithEmbedding, null, queryEmbedding);

        const expected = (1 * RECENCY_WEIGHT) + (1 * IMPORTANCE_WEIGHT) + (0.7 * RELEVANCE_WEIGHT);
        expect(score).toBeCloseTo(expected);
    });

    it('should decay score over time', () => {
      const yesterday = now - (24 * 60 * 60 * 1000);
      const oldMemory: Memory = {
        ...mockMemory,
        created_at: new Date(yesterday).toISOString(),
      };

      const score = calculateMemoryScore(oldMemory, null);

      // hoursSinceCreation = 24
      // recencyScore = exp(-24/24) = exp(-1) approx 0.367
      const recencyScore = Math.exp(-1);
      const expected = (recencyScore * RECENCY_WEIGHT) + (1 * IMPORTANCE_WEIGHT);
      expect(score).toBeCloseTo(expected);
    });
  });

  describe('selectRelevantMemories', () => {
    it('should select top memories by score', () => {
      const now = Date.now();
      const memories: Memory[] = [
        { id: 'low', importance: 1, created_at: new Date(now - 1000000).toISOString(), content: 'low', type: 'general', metadata: null, updated_at: '' },
        { id: 'high', importance: 5, created_at: new Date(now).toISOString(), content: 'high', type: 'general', metadata: null, updated_at: '' },
      ];

      const selected = selectRelevantMemories(memories, null, null, 1);
      expect(selected).toHaveLength(1);
      expect(selected[0].id).toBe('high');
    });

    it('should respect window size', () => {
      const memories = Array(5).fill(null).map((_, i) => ({
        id: `${i}`,
        importance: 3,
        created_at: new Date().toISOString(),
        content: `memory ${i}`,
        type: 'general',
        metadata: null,
        updated_at: ''
      } as Memory));

      const selected = selectRelevantMemories(memories, null, null, 2);
      expect(selected).toHaveLength(2);
    });
  });
});
