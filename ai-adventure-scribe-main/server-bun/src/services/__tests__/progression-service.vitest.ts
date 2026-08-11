/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client';
import { NotFoundError } from '../../lib/errors.js';
import { ProgressionService } from '../progression-service.js';

// Helper to create a chainable mock
const createMockChain = (initialValue: any = []) => {
  const mock: any = {
    from: vi.fn(() => mock),
    innerJoin: vi.fn(() => mock),
    leftJoin: vi.fn(() => mock),
    where: vi.fn(() => mock),
    limit: vi.fn(() => mock),
    orderBy: vi.fn(() => mock),
    groupBy: vi.fn(() => mock),
    returning: vi.fn(() => Promise.resolve(initialValue)),
    values: vi.fn(() => mock),
    select: vi.fn(() => mock),
    set: vi.fn(() => mock),
    then: (onFulfilled: any) => Promise.resolve(initialValue).then(onFulfilled),
    // For Drizzle-style .returning() which is often awaited
    [Symbol.iterator]: [][Symbol.iterator],
  };
  return mock;
};

// Mock the db client
vi.mock('../../../../db/client', () => {
  const mockDb = {
    query: {
      characters: {
        findFirst: vi.fn(),
      },
      levelProgression: {
        findFirst: vi.fn(),
      },
    },
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    execute: vi.fn(),
  };
  return { db: mockDb };
});

// Mock the schema symbols to avoid undefined errors
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual('drizzle-orm');
  return {
    ...actual as any,
  };
});

describe('ProgressionService Security', () => {
  const mockUserId = 'user-123';
  const mockCharacterId = 'char-123';

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock behaviors
    (db.select as any).mockImplementation(() => createMockChain());
    (db.insert as any).mockImplementation(() => createMockChain());
    (db.update as any).mockImplementation(() => createMockChain());
  });

  describe('initializeProgression', () => {
    it('should throw NotFoundError if character is not found or not owned by user', async () => {
      // Mock progression doesn't exist
      (db.query.levelProgression.findFirst as any).mockResolvedValue(null);

      // Mock character NOT found or NOT owned in the atomic check
      (db.insert as any).mockImplementation(() => {
        const mock = createMockChain([]); // Returns empty array = no insertion
        return mock;
      });

      await expect(ProgressionService.initializeProgression(mockCharacterId, mockUserId))
        .rejects.toThrow(NotFoundError);
    });

    it('should succeed if character is owned by user', async () => {
      // Mock progression doesn't exist
      (db.query.levelProgression.findFirst as any).mockResolvedValue(null);

      // Mock progression insertion success
      (db.insert as any).mockImplementation(() => {
        return createMockChain([{ characterId: mockCharacterId, currentLevel: 1 }]);
      });

      const result = await ProgressionService.initializeProgression(mockCharacterId, mockUserId);
      expect(result).toBeDefined();
      expect(result.characterId).toBe(mockCharacterId);
    });
  });

  describe('awardXP', () => {
    it('should throw Error if progression update fails (e.g. unauthorized)', async () => {
      // Mock progression lookup
      (db.select as any).mockImplementation(() =>
        createMockChain([{ progression: { currentLevel: 1, totalXp: 0, currentXp: 0 } }])
      );

      // Mock update returning empty array (unauthorized or not found)
      (db.update as any).mockImplementation(() => createMockChain([]));

      await expect(ProgressionService.awardXP(mockCharacterId, 100, 'combat', mockUserId))
        .rejects.toThrow();
    });

    it('should succeed if character is owned and progression exists', async () => {
      // Mock progression lookup
      (db.select as any).mockImplementation(() =>
        createMockChain([{ progression: { currentLevel: 1, totalXp: 0, currentXp: 0 } }])
      );

      // Mock update returning updated row
      (db.update as any).mockImplementationOnce(() =>
        createMockChain([{ characterId: mockCharacterId, currentLevel: 1, totalXp: 100, currentXp: 100 }])
      );

      const result = await ProgressionService.awardXP(mockCharacterId, 100, 'combat', mockUserId);
      expect(result).toBeDefined();
      expect(result.newXp).toBe(100);
    });
  });

  describe('setLevel', () => {
    it('should throw NotFoundError if user does not own character', async () => {
      // Mock current progression lookup
      (db.select as any).mockImplementation(() =>
        createMockChain([{ progression: { currentLevel: 1, totalXp: 0 } }])
      );

      // Mock updates returning 0 rows (unauthorized)
      (db.update as any).mockImplementation(() => createMockChain([]));

      await expect(ProgressionService.setLevel(mockCharacterId, 5, mockUserId))
        .rejects.toThrow(NotFoundError);
    });

    it('should succeed if character is owned', async () => {
      // Mock current progression lookup
      (db.select as any).mockImplementation(() =>
        createMockChain([{ progression: { currentLevel: 1, totalXp: 0 } }])
      );

      // Mock updates returning 1 row
      (db.update as any).mockImplementation(() => createMockChain([{ characterId: mockCharacterId }]));

      const result = await ProgressionService.setLevel(mockCharacterId, 5, mockUserId);
      expect(result.newLevel).toBe(5);
    });
  });
});
