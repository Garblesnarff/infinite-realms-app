/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { SpellSlotsService } from '../spell-slots-service.js';

// Mock the db client
vi.mock('../../../../db/client.js', () => ({
  db: {
    query: {
      characters: {
        findFirst: vi.fn(),
      },
      characterSpellSlots: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      spellSlotUsageLog: {
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
        where: vi.fn(() => ({
          returning: vi.fn(),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(),
    })),
    execute: vi.fn(),
  },
}));

// Mock drizzle-orm
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual('drizzle-orm');
  return {
    ...actual as any,
    count: vi.fn(),
    desc: vi.fn(),
    sql: vi.fn(),
  };
});

describe('SpellSlotsService', () => {
  const mockUserId = 'user-123';
  const mockCharacterId = 'char-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateSpellSlots', () => {
    it('should calculate slots for a level 1 Wizard', () => {
      const result = SpellSlotsService.calculateSpellSlots('Wizard', 1);
      expect(result.slots[1]).toBe(2);
      expect(result.casterLevel).toBe(1);
    });

    it('should calculate slots for a level 5 Paladin (half caster)', () => {
      const result = SpellSlotsService.calculateSpellSlots('Paladin', 5);
      expect(result.casterLevel).toBe(2);
      expect(result.slots[1]).toBe(3);
    });

    it('should throw ValidationError for invalid level', () => {
      expect(() => SpellSlotsService.calculateSpellSlots('Wizard', 21))
        .toThrow(ValidationError);
    });
  });

  describe('calculateMulticlassSpellSlots', () => {
    it('should calculate slots for Wizard 3 / Cleric 2', () => {
      const result = SpellSlotsService.calculateMulticlassSpellSlots([
        { className: 'Wizard', level: 3 },
        { className: 'Cleric', level: 2 }
      ]);
      expect(result.totalCasterLevel).toBe(5);
      expect(result.slots[3]).toBe(2);
    });
  });

  describe('Security: getCharacterSpellSlots', () => {
    it('should throw NotFoundError if character is not found or not owned by user', async () => {
      (db.query.characterSpellSlots.findMany as any).mockResolvedValue([]);
      (db.query.characters.findFirst as any).mockResolvedValue(null);

      await expect(SpellSlotsService.getCharacterSpellSlots(mockCharacterId, mockUserId))
        .rejects.toThrow(NotFoundError);
    });

    it('should succeed if character is owned by user', async () => {
      const mockSlots = [
        { id: '1', characterId: mockCharacterId, spellLevel: 1, totalSlots: 2, usedSlots: 0 }
      ];
      (db.query.characterSpellSlots.findMany as any).mockResolvedValue(mockSlots);

      const result = await SpellSlotsService.getCharacterSpellSlots(mockCharacterId, mockUserId);
      expect(result.characterId).toBe(mockCharacterId);
      expect(result.slots).toHaveLength(1);
      expect(result[1]).toBeDefined();
    });
  });

  describe('Security: useSpellSlot', () => {
    it('should throw NotFoundError if slot is not found or character not owned', async () => {
      (db.query.characterSpellSlots.findFirst as any).mockResolvedValue(null);

      await expect(SpellSlotsService.useSpellSlot({
        characterId: mockCharacterId,
        spellName: 'Fireball',
        spellLevel: 3,
        slotLevelUsed: 3,
      }, mockUserId)).rejects.toThrow(NotFoundError);
    });

    it('should succeed and log usage if slot exists and character owned', async () => {
      (db.query.characters.findFirst as any).mockResolvedValue({ id: mockCharacterId });
      (db.query.characterSpellSlots.findFirst as any).mockResolvedValue({
        id: 'slot-123',
        characterId: mockCharacterId,
        spellLevel: 3,
        totalSlots: 3,
        usedSlots: 0
      });

      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{
              id: 'slot-123',
              characterId: mockCharacterId,
              spellLevel: 3,
              totalSlots: 3,
              usedSlots: 1
            }])
          })
        })
      });

      (db.insert as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'log-123', timestamp: new Date() }])
        })
      });

      const result = await SpellSlotsService.useSpellSlot({
        characterId: mockCharacterId,
        spellName: 'Fireball',
        spellLevel: 3,
        slotLevelUsed: 3,
      }, mockUserId);

      expect(result.success).toBe(true);
      expect(db.insert).toHaveBeenCalled();
    });
  });

  describe('Security: restoreSpellSlots', () => {
    it('should throw NotFoundError if character not owned', async () => {
      (db.query.characters.findFirst as any).mockResolvedValue(null);

      await expect(SpellSlotsService.restoreSpellSlots({
        characterId: mockCharacterId,
      }, mockUserId)).rejects.toThrow(NotFoundError);
    });

    it('should restore slots if character owned', async () => {
      (db.query.characters.findFirst as any).mockResolvedValue({ id: mockCharacterId });
      (db.query.characterSpellSlots.findMany as any).mockResolvedValue([
        { id: 'slot-1', spellLevel: 1, usedSlots: 1 }
      ]);
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue({})
        })
      });

      const result = await SpellSlotsService.restoreSpellSlots({
        characterId: mockCharacterId,
      }, mockUserId);

      expect(result.totalRestored).toBe(1);
    });
  });

  describe('Security: getSpellSlotUsageHistory', () => {
    it('should throw NotFoundError if character not owned', async () => {
      (db.query.characters.findFirst as any).mockResolvedValue(null);

      await expect(SpellSlotsService.getSpellSlotUsageHistory({
        characterId: mockCharacterId,
      }, mockUserId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('Security: initializeSpellSlots', () => {
    it('should throw NotFoundError if character not owned', async () => {
      (db.query.characters.findFirst as any).mockResolvedValue(null);

      await expect(SpellSlotsService.initializeSpellSlots(
        mockCharacterId,
        mockUserId,
        [{ className: 'Wizard', level: 1 }]
      )).rejects.toThrow(NotFoundError);
    });

    it('should delete existing and insert new slots', async () => {
      (db.query.characters.findFirst as any).mockResolvedValue({ id: mockCharacterId });
      (db.delete as any).mockReturnValue({
        where: vi.fn().mockResolvedValue({})
      });
      (db.insert as any).mockReturnValue({
        values: vi.fn().mockResolvedValue({})
      });
      // Mock the final call to getCharacterSpellSlots
      (db.query.characterSpellSlots.findMany as any).mockResolvedValue([]);

      await SpellSlotsService.initializeSpellSlots(
        mockCharacterId,
        mockUserId,
        [{ className: 'Wizard', level: 1 }]
      );

      expect(db.delete).toHaveBeenCalled();
      expect(db.insert).toHaveBeenCalled();
    });
  });
});
