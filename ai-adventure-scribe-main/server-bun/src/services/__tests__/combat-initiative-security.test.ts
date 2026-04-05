/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client';
import { NotFoundError } from '../../lib/errors.js';
import { CombatEncounterService } from '../combat/combat-encounter-service.js';
import { CombatInitiativeService } from '../combat-initiative-service.js';

// Mock the db client
vi.mock('../../../../db/client', () => {
  const mockQueryBuilder: any = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    // Make it thenable to support await
    then: vi.fn(function(this: any, resolve: any) {
      return Promise.resolve(this._results || []).then(resolve);
    }),
  };

  return {
    db: {
      query: {
        combatEncounters: {
          findFirst: vi.fn(),
        },
        combatParticipants: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
        npcs: {
          findFirst: vi.fn(),
        }
      },
      select: vi.fn(() => {
        const qb = { ...mockQueryBuilder };
        qb._results = [];
        // Important: each call to select() returns a fresh query builder
        qb.limit = vi.fn().mockImplementation(function(this: any, _n: number) {
            return this;
        });
        qb.where = vi.fn().mockImplementation(function(this: any, _cond: any) {
            return this;
        });
        return qb;
      }),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([]),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([]),
          })),
        })),
      })),
      delete: vi.fn(() => ({
        where: vi.fn(),
      })),
      execute: vi.fn(),
    },
  };
});

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
      vi.fn(() => ({ type: 'sql' })),
      { join: vi.fn((args) => args) }
    )
  };
});

describe('CombatInitiativeService Security', () => {
  const mockUserId = 'user-123';
  const mockSessionId = 'session-123';
  const mockEncounterId = 'enc-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('startCombat NPC Security', () => {
    it('should throw NotFoundError if an NPC is not owned by the user in startCombat', async () => {
      // Setup mock results for sequential calls
      const qb1 = (db.select() as any);
      qb1._results = [{ id: mockSessionId }]; // Session access check

      const qb2 = (db.select() as any);
      qb2._results = [{ id: 'npc-1' }]; // Batch NPC access check (only 1 found)

      (db.select as any)
        .mockReturnValueOnce(qb1)
        .mockReturnValueOnce(qb2);

      await expect(CombatEncounterService.startCombat(
        mockSessionId,
        [
          { name: 'NPC 1', npcId: 'npc-1', initiativeModifier: 2 },
          { name: 'NPC 2', npcId: 'npc-2', initiativeModifier: 1 }
        ],
        false,
        mockUserId
      )).rejects.toThrow(NotFoundError);
    });

    it('should succeed if all NPCs are owned by the user in startCombat', async () => {
      const qb1 = (db.select() as any);
      qb1._results = [{ id: mockSessionId }]; // Session access check

      const qb2 = (db.select() as any);
      qb2._results = [{ id: 'npc-1' }, { id: 'npc-2' }]; // Batch NPC access check

      (db.select as any)
        .mockReturnValueOnce(qb1)
        .mockReturnValueOnce(qb2);

      // Mock encounter creation
      (db.insert as any).mockReturnValueOnce({
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: mockEncounterId, status: 'active', currentRound: 1, currentTurnOrder: 0 }])
      });

      // Mock participants insertion
      (db.insert as any).mockReturnValueOnce({
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([
          { id: 'p1', name: 'NPC 1', npcId: 'npc-1', initiative: 15, initiativeModifier: 2, turnOrder: 0, isActive: true },
          { id: 'p2', name: 'NPC 2', npcId: 'npc-2', initiative: 10, initiativeModifier: 1, turnOrder: 1, isActive: true }
        ])
      });

      const result = await CombatEncounterService.startCombat(
        mockSessionId,
        [
          { name: 'NPC 1', npcId: 'npc-1', initiativeModifier: 2 },
          { name: 'NPC 2', npcId: 'npc-2', initiativeModifier: 1 }
        ],
        false,
        mockUserId
      );

      expect(result.encounter.id).toBe(mockEncounterId);
      expect(result.participants).toHaveLength(2);
    });
  });

  describe('addParticipant NPC Security', () => {
    it('should throw NotFoundError if the NPC is not owned by the user in addParticipant', async () => {
      const qb1 = (db.select() as any);
      qb1._results = [{ id: mockEncounterId }]; // Encounter access check

      const qb2 = (db.select() as any);
      qb2._results = []; // NPC access check - not found

      (db.select as any)
        .mockReturnValueOnce(qb1)
        .mockReturnValueOnce(qb2);

      await expect(CombatInitiativeService.addParticipant(
        mockEncounterId,
        { name: 'Evil NPC', npcId: 'npc-evil', initiativeModifier: 5 },
        mockUserId
      )).rejects.toThrow(NotFoundError);
    });

    it('should succeed if the NPC is owned by the user in addParticipant', async () => {
      const qb1 = (db.select() as any);
      qb1._results = [{ id: mockEncounterId }]; // Encounter access check

      const qb2 = (db.select() as any);
      qb2._results = [{ id: 'npc-good' }]; // NPC access check

      (db.select as any)
        .mockReturnValueOnce(qb1)
        .mockReturnValueOnce(qb2);

      // Mock participant insertion
      (db.insert as any).mockReturnValueOnce({
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: 'p3', name: 'Good NPC', npcId: 'npc-good' }])
      });

      const result = await CombatInitiativeService.addParticipant(
        mockEncounterId,
        { name: 'Good NPC', npcId: 'npc-good', initiativeModifier: 3 },
        mockUserId
      );

      expect(result.npcId).toBe('npc-good');
    });
  });

  describe('rollInitiative Security', () => {
    it('should throw NotFoundError if the user does not own the participant in rollInitiative', async () => {
      // Mock verifyParticipantOwnership - fail (empty results means not found/unauthorized)
      const qb = (db.select() as any);
      qb._results = [];

      (db.select as any).mockReturnValueOnce(qb);

      await expect(CombatInitiativeService.rollInitiative(
        mockEncounterId,
        'other-participant',
        15,
        undefined,
        mockUserId
      )).rejects.toThrow(NotFoundError);
    });

    it('should succeed if the user owns the participant in rollInitiative', async () => {
      // 1. Mock verifyParticipantOwnership - success
      const qb1 = (db.select() as any);
      qb1._results = [{ id: 'my-participant' }];
      (db.select as any).mockReturnValueOnce(qb1);

      // 2. Mock participant fetch for the service logic
      (db.query.combatParticipants.findFirst as any).mockResolvedValue({
        id: 'my-participant',
        encounterId: mockEncounterId,
        initiativeModifier: 2
      });

      // Mock findMany for calculateTurnOrder
      (db.query.combatParticipants.findMany as any).mockResolvedValue([
        { id: 'my-participant', initiative: 17, initiativeModifier: 2 }
      ]);

      // 3. Mock update
      (db.update as any).mockReturnValueOnce({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: 'my-participant' }])
      });

      const result = await CombatInitiativeService.rollInitiative(
        mockEncounterId,
        'my-participant',
        15,
        undefined,
        mockUserId
      );

      expect(result.total).toBe(17); // 15 + 2
    });
  });

  describe('reorderInitiative Security', () => {
    it('should throw NotFoundError if the user does not own the participant in reorderInitiative', async () => {
      const qb = (db.select() as any);
      qb._results = [];
      (db.select as any).mockReturnValueOnce(qb);

      await expect(CombatInitiativeService.reorderInitiative(
        mockEncounterId,
        'other-participant',
        20,
        mockUserId
      )).rejects.toThrow(NotFoundError);
    });
  });

  describe('removeParticipant Security', () => {
    it('should return early if the user does not own the participant in removeParticipant', async () => {
      const qb = (db.select() as any);
      qb._results = [];
      (db.select as any).mockReturnValueOnce(qb);

      await CombatInitiativeService.removeParticipant('other-participant', mockUserId);

      // Verify that update was NOT called
      expect(db.update).not.toHaveBeenCalled();
    });

    it('should proceed if the user owns the participant in removeParticipant', async () => {
      const qb = (db.select() as any);
      qb._results = [{ id: 'my-participant', encounterId: mockEncounterId }];
      (db.select as any).mockReturnValueOnce(qb);

      // Mock update for removeParticipant
      (db.update as any).mockReturnValueOnce({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue({ length: 1 })
      });

      await CombatInitiativeService.removeParticipant('my-participant', mockUserId);

      // Verify that update was called
      expect(db.update).toHaveBeenCalled();
    });
  });
});
