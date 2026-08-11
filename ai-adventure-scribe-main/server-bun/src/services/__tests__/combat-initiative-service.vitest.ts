/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client';
import { NotFoundError } from '../../lib/errors.js';
import { CombatEncounterService } from '../combat/combat-encounter-service.js';

// Mock the db client
vi.mock('../../../../db/client', () => ({
  db: {
    query: {
      combatEncounters: {
        findFirst: vi.fn(),
      },
      combatParticipants: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
            limit: vi.fn(),
            innerJoin: vi.fn(() => ({
                where: vi.fn()
            }))
        })),
        leftJoin: vi.fn(() => ({
            leftJoin: vi.fn(() => ({
                where: vi.fn()
            }))
        })),
        innerJoin: vi.fn(() => ({
            leftJoin: vi.fn(() => ({
                leftJoin: vi.fn(() => ({
                    where: vi.fn()
                }))
            }))
        }))
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
    and: vi.fn((...args) => ({ type: 'and', args })),
    or: vi.fn((...args) => ({ type: 'or', args })),
    eq: vi.fn((a, b) => ({ type: 'eq', a, b })),
    inArray: vi.fn((a, b) => ({ type: 'inArray', a, b })),
    sql: Object.assign(
      vi.fn((strings, ...values) => ({ strings, values, type: 'sql' })),
      { join: vi.fn((args) => args) }
    ),
    exists: vi.fn((subquery) => ({ type: 'exists', subquery })),
  };
});

describe('CombatEncounterService', () => {
  const mockUserId = 'user-123';
  const mockSessionId = 'session-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('startCombat', () => {
    it('should use verifyCharactersAccessBatch for multiple characters', async () => {
      // Mock batch character access check
      (db.select as any).mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ id: 'char-1' }, { id: 'char-2' }])
      });

      // Mock encounter creation with atomic INSERT ... SELECT
      (db.insert as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: 'enc-123', status: 'active', currentRound: 1, currentTurnOrder: 0 }])
      });

      // Mock nested SELECT for INSERT ... SELECT
      (db.select as any).mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
      });

      // Mock participants insertion
      (db.insert as any).mockReturnValueOnce({
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([
          { id: 'p1', name: 'Player 1', characterId: 'char-1', initiative: 15, initiativeModifier: 2, turnOrder: 0, isActive: true },
          { id: 'p2', name: 'Player 2', characterId: 'char-2', initiative: 10, initiativeModifier: 1, turnOrder: 1, isActive: true }
        ])
      });

      await CombatEncounterService.startCombat(
        mockSessionId,
        [
          { name: 'Player 1', characterId: 'char-1', initiativeModifier: 2, encounterId: '' },
          { name: 'Player 2', characterId: 'char-2', initiativeModifier: 1, encounterId: '' }
        ],
        false,
        mockUserId
      );

      // Verify that db.select was called for characters
      expect(db.select).toHaveBeenCalled();
    });

    it('should throw NotFoundError if one of the characters is not found in batch', async () => {
      // Mock batch character access check - only one character found
      (db.select as any).mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ id: 'char-1' }])
      });

      await expect(CombatEncounterService.startCombat(
        mockSessionId,
        [
          { name: 'Player 1', characterId: 'char-1', initiativeModifier: 2, encounterId: '' },
          { name: 'Player 2', characterId: 'char-2', initiativeModifier: 1, encounterId: '' }
        ],
        false,
        mockUserId
      )).rejects.toThrow(NotFoundError);
    });
  });
});
