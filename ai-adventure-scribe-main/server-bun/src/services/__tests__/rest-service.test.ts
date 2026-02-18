/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client';
import { NotFoundError } from '../../lib/errors.js';
import { RestService } from '../rest-service.js';

// Mock the db client
vi.mock('../../../../db/client', () => ({
  db: {
    query: {
      characters: {
        findFirst: vi.fn(),
      },
      characterHitDice: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      restEvents: {
        findMany: vi.fn(),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
  },
}));

// Mock the schema symbols to avoid undefined errors
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual('drizzle-orm');
  return {
    ...actual as any,
  };
});

describe('RestService Security', () => {
  const mockUserId = 'user-123';
  const mockCharacterId = 'char-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('takeShortRest', () => {
    it('should throw NotFoundError if character is not found or not owned by user', async () => {
      // Mock character NOT found or NOT owned (which returns null in our implementation)
      (db.query.characters.findFirst as any).mockResolvedValue(null);

      await expect(RestService.takeShortRest(mockCharacterId, mockUserId))
        .rejects.toThrow(NotFoundError);
    });

    it('should succeed if character is owned by user', async () => {
      // Mock character found and owned
      (db.query.characters.findFirst as any).mockResolvedValue({ id: mockCharacterId });

      // Mock internal hit dice lookup
      (db.query.characterHitDice.findMany as any).mockResolvedValue([]);

      // Mock rest event insertion
      (db.insert as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'event-123' }])
        })
      });

      const result = await RestService.takeShortRest(mockCharacterId, mockUserId);
      expect(result).toBeDefined();
      expect(result.characterId).toBe(mockCharacterId);
      expect(result.restEventId).toBe('event-123');
    });
  });

  describe('takeLongRest', () => {
    it('should throw NotFoundError if character is not found or not owned by user', async () => {
      (db.query.characters.findFirst as any).mockResolvedValue(null);

      await expect(RestService.takeLongRest(mockCharacterId, mockUserId))
        .rejects.toThrow(NotFoundError);
    });

    it('should succeed if character is owned by user', async () => {
      (db.query.characters.findFirst as any).mockResolvedValue({
        id: mockCharacterId,
        stats: { constitution: 10 }
      });

      (db.query.characterHitDice.findMany as any).mockResolvedValue([]);
      (db.insert as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'event-456' }])
        })
      });

      const result = await RestService.takeLongRest(mockCharacterId, mockUserId);
      expect(result).toBeDefined();
      expect(result.restEventId).toBe('event-456');
    });
  });

  describe('getHitDice', () => {
    it('should include exists check in where clause for hit dice', async () => {
      (db.query.characterHitDice.findMany as any).mockResolvedValue([]);

      await RestService.getHitDice(mockCharacterId, mockUserId);

      expect(db.query.characterHitDice.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.any(Object)
      }));
    });
  });
});
