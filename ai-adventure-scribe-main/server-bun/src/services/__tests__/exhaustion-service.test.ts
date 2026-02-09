/* eslint-disable max-lines */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../../../../db/client.js';
import { BusinessLogicError, NotFoundError } from '../../lib/errors.js';
import { ExhaustionService } from '../exhaustion-service.js';

// Mock the db client
vi.mock('../../../../db/client.js', () => {
  const mock: any = {
    query: {
      combatParticipants: {
        findFirst: vi.fn(),
      },
      combatParticipantStatus: {
        findFirst: vi.fn(),
      },
    },
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
  };

  const chainable = () => {
    const c: any = vi.fn(() => c);
    c.from = vi.fn(() => c);
    c.innerJoin = vi.fn(() => c);
    c.leftJoin = vi.fn(() => c);
    c.where = vi.fn(() => c);
    c.limit = vi.fn(() => c);
    c.set = vi.fn(() => c);
    c.values = vi.fn(() => c);
    c.returning = vi.fn(() => Promise.resolve([]));
    return c;
  };

  mock.select.mockImplementation(chainable);
  mock.update.mockImplementation(chainable);
  mock.insert.mockImplementation(chainable);
  mock.delete.mockImplementation(chainable);

  return { db: mock };
});

// Mock drizzle-orm
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual('drizzle-orm');
  return {
    ...(actual as any),
    and: vi.fn((...args) => ({ type: 'and', args })),
    or: vi.fn((...args) => ({ type: 'or', args })),
    eq: vi.fn((a, b) => ({ type: 'eq', a, b })),
    exists: vi.fn((subquery) => ({ type: 'exists', subquery })),
  };
});

describe('ExhaustionService', () => {
  const mockUserId = 'user-123';
  const mockParticipantId = 'part-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getExhaustionEffects', () => {
    it('should return correct effects for level 0', () => {
      const effects = ExhaustionService.getExhaustionEffects(0);
      expect(effects.level).toBe(0);
      expect(effects.isDead).toBe(false);
      expect(effects.speedMultiplier).toBe(1);
    });

    it('should return correct effects for level 1', () => {
      const effects = ExhaustionService.getExhaustionEffects(1);
      expect(effects.disadvantageOnAbilityChecks).toBe(true);
      expect(effects.speedMultiplier).toBe(1);
    });

    it('should return correct effects for level 3', () => {
      const effects = ExhaustionService.getExhaustionEffects(3);
      expect(effects.disadvantageOnAttacks).toBe(true);
      expect(effects.disadvantageOnSaves).toBe(true);
      expect(effects.speedMultiplier).toBe(0.5);
    });

    it('should return correct effects for level 6', () => {
      const effects = ExhaustionService.getExhaustionEffects(6);
      expect(effects.isDead).toBe(true);
    });
  });

  describe('Security: getExhaustionLevel', () => {
    it('should throw NotFoundError if participant is not found or not owned', async () => {
      (db.query.combatParticipants.findFirst as any).mockResolvedValue(null);

      await expect(
        ExhaustionService.getExhaustionLevel(mockParticipantId, mockUserId),
      ).rejects.toThrow(NotFoundError);
    });

    it('should return exhaustion level if owned', async () => {
      (db.query.combatParticipants.findFirst as any).mockResolvedValue({
        id: mockParticipantId,
        status: { exhaustionLevel: 2 },
      });

      const level = await ExhaustionService.getExhaustionLevel(mockParticipantId, mockUserId);
      expect(level).toBe(2);
      expect(db.query.combatParticipants.findFirst).toHaveBeenCalled();
    });

    it('should return 0 if owned but no status record exists', async () => {
      (db.query.combatParticipants.findFirst as any).mockResolvedValue({
        id: mockParticipantId,
        status: null,
      });

      const level = await ExhaustionService.getExhaustionLevel(mockParticipantId, mockUserId);
      expect(level).toBe(0);
    });
  });

  describe('Security: applyExhaustion', () => {
    it('should throw NotFoundError if participant is not owned', async () => {
      (db.query.combatParticipants.findFirst as any).mockResolvedValue(null);

      await expect(
        ExhaustionService.applyExhaustion(mockParticipantId, 1, mockUserId),
      ).rejects.toThrow(NotFoundError);
    });

    it('should update exhaustion level if owned', async () => {
      (db.query.combatParticipants.findFirst as any).mockResolvedValue({
        id: mockParticipantId,
        status: { exhaustionLevel: 1 },
      });

      const mockReturning = vi.fn().mockResolvedValue([{ exhaustionLevel: 2 }]);
      (db.update as any).mockImplementation(() => {
        const c: any = vi.fn(() => c);
        c.set = vi.fn(() => c);
        c.where = vi.fn(() => c);
        c.returning = mockReturning;
        return c;
      });

      const result = await ExhaustionService.applyExhaustion(
        mockParticipantId,
        1,
        mockUserId,
        'forced_march',
      );

      expect(result.newLevel).toBe(2);
      expect(result.message).toContain('forced march');
      expect(db.update).toHaveBeenCalled();
    });

    it('should handle zero levels change', async () => {
      (db.query.combatParticipants.findFirst as any).mockResolvedValue({
        id: mockParticipantId,
        status: { exhaustionLevel: 1 },
      });

      const mockReturning = vi.fn().mockResolvedValue([{ exhaustionLevel: 1 }]);
      (db.update as any).mockImplementation(() => {
        const c: any = vi.fn(() => c);
        c.set = vi.fn(() => c);
        c.where = vi.fn(() => c);
        c.returning = mockReturning;
        return c;
      });

      const result = await ExhaustionService.applyExhaustion(mockParticipantId, 0, mockUserId);
      expect(result.message).toContain('unchanged');
    });

    it('should include death message at level 6', async () => {
      (db.query.combatParticipants.findFirst as any).mockResolvedValue({
        id: mockParticipantId,
        status: { exhaustionLevel: 5 },
      });

      const mockReturning = vi.fn().mockResolvedValue([{ exhaustionLevel: 6 }]);
      (db.update as any).mockImplementation(() => {
        const c: any = vi.fn(() => c);
        c.set = vi.fn(() => c);
        c.where = vi.fn(() => c);
        c.returning = mockReturning;
        return c;
      });

      const result = await ExhaustionService.applyExhaustion(mockParticipantId, 1, mockUserId);
      expect(result.message).toContain('died from exhaustion');
    });
  });

  describe('Security: reduceExhaustion', () => {
    it('should throw BusinessLogicError if no food provided', async () => {
      await expect(
        ExhaustionService.reduceExhaustion(mockParticipantId, mockUserId, 1, false),
      ).rejects.toThrow(BusinessLogicError);
    });

    it('should reduce exhaustion if owned and has food', async () => {
      (db.query.combatParticipants.findFirst as any).mockResolvedValue({
        id: mockParticipantId,
        status: { exhaustionLevel: 1 },
      });

      const mockReturning = vi.fn().mockResolvedValue([{ exhaustionLevel: 0 }]);
      (db.update as any).mockImplementation(() => {
        const c: any = vi.fn(() => c);
        c.set = vi.fn(() => c);
        c.where = vi.fn(() => c);
        c.returning = mockReturning;
        return c;
      });

      const result = await ExhaustionService.reduceExhaustion(
        mockParticipantId,
        mockUserId,
        1,
        true,
      );

      expect(result.newLevel).toBe(0);
      expect(db.update).toHaveBeenCalled();
    });
  });

  describe('Security: setExhaustionLevel', () => {
    it('should set exact exhaustion level if owned', async () => {
      (db.query.combatParticipants.findFirst as any).mockResolvedValue({
        id: mockParticipantId,
        status: { exhaustionLevel: 1 },
      });

      const mockReturning = vi.fn().mockResolvedValue([{ exhaustionLevel: 4 }]);
      (db.update as any).mockImplementation(() => {
        const c: any = vi.fn(() => c);
        c.set = vi.fn(() => c);
        c.where = vi.fn(() => c);
        c.returning = mockReturning;
        return c;
      });

      const result = await ExhaustionService.setExhaustionLevel(mockParticipantId, 4, mockUserId);

      expect(result.newLevel).toBe(4);
      expect(db.update).toHaveBeenCalled();
    });
  });

  describe('Helper methods', () => {
    it('getExhaustionModifiers should return all mechanical flags', () => {
      const mods = ExhaustionService.getExhaustionModifiers(1);
      expect(mods.abilityCheckDisadvantage).toBe(true);
      expect(mods.attackDisadvantage).toBe(false);
    });

    it('calculateEffectiveMaxHp should half HP at level 4', () => {
      expect(ExhaustionService.calculateEffectiveMaxHp(100, 4)).toBe(50);
      expect(ExhaustionService.calculateEffectiveMaxHp(100, 3)).toBe(100);
    });

    it('calculateEffectiveSpeed should half speed at level 2', () => {
      expect(ExhaustionService.calculateEffectiveSpeed(30, 2)).toBe(15);
      expect(ExhaustionService.calculateEffectiveSpeed(30, 5)).toBe(0);
      expect(ExhaustionService.calculateEffectiveSpeed(30, 0)).toBe(30);
    });

    it('getExhaustionDescription should return formatted string', () => {
      expect(ExhaustionService.getExhaustionDescription(0)).toBe('No exhaustion');
      expect(ExhaustionService.getExhaustionDescription(1)).toContain('Level 1');
    });

    it('getExhaustionScenarios should return all scenarios', () => {
      const scenarios = ExhaustionService.getExhaustionScenarios();
      expect(scenarios.forced_march).toBeDefined();
      expect(scenarios.starvation.levels).toBe(1);
    });
  });
});
