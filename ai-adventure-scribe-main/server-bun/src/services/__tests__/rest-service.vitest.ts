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
      combatParticipants: {
        findMany: vi.fn(),
      },
    },
    select: vi.fn(() => {
      const mock = {
        from: vi.fn(() => mock),
        where: vi.fn(() => mock),
        limit: vi.fn(() => mock),
        orderBy: vi.fn(() => mock),
        returning: vi.fn(),
      };
      return mock;
    }),
    insert: vi.fn(() => {
      const mock = {
        values: vi.fn(() => mock),
        select: vi.fn(() => mock),
        returning: vi.fn(),
      };
      return mock;
    }),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
    execute: vi.fn().mockResolvedValue([]),
  },
}));

// Mock the schema symbols to avoid undefined errors
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual('drizzle-orm');
  return {
    ...(actual as any),
  };
});

describe('RestService Security', () => {
  const mockUserId = 'user-123';
  const mockCharacterId = 'char-123';

  beforeEach(() => {
    vi.clearAllMocks();
    (db.query.combatParticipants.findMany as any).mockResolvedValue([]);
  });

  describe('takeShortRest', () => {
    it('should throw NotFoundError if character is not found or not owned by user', async () => {
      // Mock character NOT found or NOT owned
      (db.query.characters.findFirst as any).mockResolvedValue(null);

      await expect(RestService.takeShortRest(mockCharacterId, mockUserId)).rejects.toThrow(
        NotFoundError,
      );
    });

    it('should succeed if character is owned by user', async () => {
      // Mock character found and owned
      (db.query.characters.findFirst as any).mockResolvedValue({
        id: mockCharacterId,
        hitDice: [],
        classFeatures: null,
        pactSlots: null,
        spellSlots: null,
      });

      // Mock internal hit dice lookup
      (db.query.characterHitDice.findMany as any).mockResolvedValue([]);
      (db.query.combatParticipants.findMany as any).mockResolvedValue([]);

      // Mock rest event insertion
      (db.insert as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'event-123' }]),
        }),
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

      await expect(RestService.takeLongRest(mockCharacterId, mockUserId)).rejects.toThrow(
        NotFoundError,
      );
    });

    it('should succeed if character is owned by user', async () => {
      (db.query.characters.findFirst as any).mockResolvedValue({
        id: mockCharacterId,
        stats: {
          constitution: 10,
          maxHitPoints: 10,
          currentHitPoints: 10,
        },
        hitDice: [],
        classFeatures: null,
        pactSlots: null,
        spellSlots: null,
      });

      (db.query.characterHitDice.findMany as any).mockResolvedValue([]);
      (db.insert as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'event-456' }]),
        }),
      });

      const result = await RestService.takeLongRest(mockCharacterId, mockUserId);
      expect(result).toBeDefined();
      expect(result.restEventId).toBe('event-456');
    });
  });

  describe('initializeHitDice', () => {
    it('should throw NotFoundError if character is not found or not owned by user', async () => {
      (db.query.characters.findFirst as any).mockResolvedValue(null);

      await expect(
        RestService.initializeHitDice(mockCharacterId, mockUserId, 'Wizard', 1),
      ).rejects.toThrow(NotFoundError);
    });

    it('should succeed and return new hit dice if owned by user', async () => {
      (db.query.characters.findFirst as any).mockResolvedValue({ id: mockCharacterId });
      (db.query.characterHitDice.findFirst as any).mockResolvedValue(null);

      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ one: 1 }]),
      });

      (db.insert as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'hd-123', characterId: mockCharacterId }]),
        }),
      });

      const result = await RestService.initializeHitDice(mockCharacterId, mockUserId, 'Wizard', 1);
      expect(result).toBeDefined();
      expect(result.id).toBe('hd-123');
    });
  });

  describe('getHitDice', () => {
    it('should include exists check in where clause for hit dice', async () => {
      (db.query.characterHitDice.findMany as any).mockResolvedValue([]);

      await RestService.getHitDice(mockCharacterId, mockUserId);

      expect(db.query.characterHitDice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.any(Object),
        }),
      );
    });
  });
});
