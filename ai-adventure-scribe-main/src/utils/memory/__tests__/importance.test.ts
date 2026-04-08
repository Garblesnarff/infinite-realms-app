import { describe, it, expect } from 'vitest';

import { calculateImportance, sortMemoriesByImportance } from '../importance';

import type { Memory } from '@/types/memory';

describe('importance utility', () => {
  describe('calculateImportance', () => {
    it('should calculate base score by type', () => {
      expect(calculateImportance({ content: 'test', type: 'general' })).toBe(1); // Min 1
      expect(calculateImportance({ content: 'test', type: 'plot' })).toBe(3);
      expect(calculateImportance({ content: 'test', type: 'action' })).toBe(3);
      expect(calculateImportance({ content: 'test', type: 'character' })).toBe(2);
      expect(calculateImportance({ content: 'test', type: 'location' })).toBe(2);
      expect(calculateImportance({ content: 'test', type: 'dialogue' })).toBe(2);
      expect(calculateImportance({ content: 'test', type: 'scene_state' })).toBe(2);
      expect(calculateImportance({ content: 'test', type: 'event' })).toBe(1);
      expect(calculateImportance({ content: 'test', type: 'description' })).toBe(1);
      expect(calculateImportance({ content: 'test', type: 'task_result' })).toBe(5);
      expect(calculateImportance({ content: 'test', type: 'unknown' })).toBe(1); // Min score 1
    });

    it('should add bonus for category', () => {
      expect(calculateImportance({ content: 'test', type: 'general', category: 'player_action' })).toBe(2); // 0 (gen) + 2
      expect(calculateImportance({ content: 'test', type: 'general', category: 'npc' })).toBe(1); // 0 (gen) + 1
      expect(calculateImportance({ content: 'test', type: 'general', category: 'location' })).toBe(1); // 0 (gen) + 1
    });

    it('should add points based on content length', () => {
      const short = 'a'.repeat(50);
      const medium = 'a'.repeat(250);
      const long = 'a'.repeat(550);

      expect(calculateImportance({ content: short, type: 'general' })).toBe(1); // Min 1
      expect(calculateImportance({ content: medium, type: 'general' })).toBe(1); // 1 point for length > 200
      expect(calculateImportance({ content: long, type: 'general' })).toBe(2); // 1 point for > 200, 1 point for > 500
    });

    it('should add points for keywords', () => {
      expect(calculateImportance({ content: 'a quest begins', type: 'general' })).toBe(1);
      expect(calculateImportance({ content: 'a mission begins', type: 'general' })).toBe(1);
      expect(calculateImportance({ content: 'danger awaits', type: 'general' })).toBe(1);
      expect(calculateImportance({ content: 'a threat looms', type: 'general' })).toBe(1);

      // Multiple keywords only count once per group in current implementation (regex check is per group)
      expect(calculateImportance({ content: 'a quest mission', type: 'general' })).toBe(1);
      expect(calculateImportance({ content: 'quest danger', type: 'general' })).toBe(2);
    });

    it('should add points for named entities', () => {
      // Regex: /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g
      expect(calculateImportance({ content: 'Elminster is here', type: 'general' })).toBe(1);
      expect(calculateImportance({ content: 'Elminster and Drizzt', type: 'general' })).toBe(2);
      expect(calculateImportance({ content: 'Elminster, Drizzt, and Bruenor', type: 'general' })).toBe(2); // Cap at 2
    });

    it('should add points based on recency', () => {
      expect(calculateImportance({ content: 'test', type: 'general', ageInHours: 0.5 })).toBe(3); // < 1
      expect(calculateImportance({ content: 'test', type: 'general', ageInHours: 5 })).toBe(2); // < 24
      expect(calculateImportance({ content: 'test', type: 'general', ageInHours: 48 })).toBe(1); // < 72
      expect(calculateImportance({ content: 'test', type: 'general', ageInHours: 100 })).toBe(1); // > 72 (min 1)
    });

    it('should add points from metadata significance', () => {
      expect(calculateImportance({ content: 'test', type: 'general', metadata: { significance: 5 } })).toBe(5);
    });

    it('should add points for errors and priority', () => {
      expect(calculateImportance({ content: 'test', type: 'general', error: new Error() })).toBe(2);
      expect(calculateImportance({ content: 'test', type: 'general', priority: 'high' })).toBe(2);
    });

    it('should cap the score between 1 and 10', () => {
      // Very high score
      const factors = {
        content: 'Elminster and Drizzt found a Golden Dragon quest in the Danger Zone. '.repeat(10),
        type: 'plot',
        category: 'player_action',
        ageInHours: 0.5,
        metadata: { significance: 10 },
        priority: 'high' as const
      };
      // Type(3) + Category(2) + Length(2) + Keywords(2) + Entities(2) + Age(3) + Meta(10) + Priority(2) = 26
      expect(calculateImportance(factors)).toBe(10);

      // Very low score
      expect(calculateImportance({ content: '', type: 'unknown' })).toBe(1);
    });
  });

  describe('sortMemoriesByImportance', () => {
    it('should sort memories by importance descending', () => {
      const now = new Date().toISOString();
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const memories: any[] = [
        { id: '0', content: 'missing', created_at: now, updated_at: now, type: 'general', metadata: null },
        { id: '1', content: 'low', importance: 1, created_at: now, updated_at: now, type: 'general', metadata: null },
        { id: '2', content: 'high', importance: 5, created_at: now, updated_at: now, type: 'general', metadata: null },
        { id: '3', content: 'med', importance: 3, created_at: now, updated_at: now, type: 'general', metadata: null },
      ];

      const sorted = sortMemoriesByImportance(memories as Memory[]);
      expect(sorted[0].id).toBe('2');
      expect(sorted[1].id).toBe('3');
      expect(sorted[2].id).toBe('1');
    });

    it('should use recency as tie-breaker for equal importance', () => {
      const oldDate = new Date('2023-01-01').toISOString();
      const newDate = new Date('2023-01-02').toISOString();
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const memories: any[] = [
        { id: 'old', content: 'old', importance: 3, created_at: oldDate, updated_at: oldDate, type: 'general', metadata: null },
        { id: 'new', content: 'new', importance: 3, created_at: newDate, updated_at: newDate, type: 'general', metadata: null },
      ];

      const sorted = sortMemoriesByImportance(memories as Memory[]);
      expect(sorted[0].id).toBe('new');
      expect(sorted[1].id).toBe('old');
    });

    it('should return a new array and not mutate the original', () => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const memories: any[] = [
        { id: '1', content: '1', importance: 1, created_at: '2023-01-01', updated_at: '2023-01-01', type: 'general', metadata: null },
        { id: '2', content: '2', importance: 5, created_at: '2023-01-01', updated_at: '2023-01-01', type: 'general', metadata: null },
      ];
      const original = [...memories];
      sortMemoriesByImportance(memories as Memory[]);
      expect(memories).toEqual(original);
    });
  });
});
