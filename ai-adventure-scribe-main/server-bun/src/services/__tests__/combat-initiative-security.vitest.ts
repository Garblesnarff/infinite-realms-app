/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client';
import { NotFoundError } from '../../lib/errors.js';
import { CombatEncounterService } from '../combat/combat-encounter-service.js';
import { CombatInitiativeService } from '../combat-initiative-service.js';

/**
 * Helper to create a mocked Drizzle query builder
 */
const createMockQueryBuilder = (results: any[] = []) => {
  const qb: any = {
    _results: results,
    select: vi.fn(() => qb),
    from: vi.fn(() => qb),
    innerJoin: vi.fn(() => qb),
    leftJoin: vi.fn(() => qb),
    where: vi.fn(() => qb),
    limit: vi.fn(() => qb),
    orderBy: vi.fn(() => qb),
    returning: vi.fn(() => Promise.resolve(qb._results)),
    values: vi.fn(() => qb),
    set: vi.fn(() => qb),
    // Make it thenable to support await on the query builder itself
    then: vi.fn(function (this: any, resolve: any) {
      return Promise.resolve(this._results).then(resolve);
    }),
  };
  return qb;
};

// Mock the db client
vi.mock('../../../../db/client', () => {
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
        },
      },
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
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
      vi.fn((strings, ...values) => ({ strings, values, type: 'sql' })),
      { join: vi.fn((args) => args) }
    ),
    exists: vi.fn((subquery) => ({ type: 'exists', subquery })),
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
      // Mock Batch NPC access check (only 1 found)
      const qb1 = createMockQueryBuilder([{ id: 'npc-1' }]);
      (db.select as any).mockReturnValueOnce(qb1);

      await expect(
        CombatEncounterService.startCombat(
          mockSessionId,
          [
            { name: 'NPC 1', npcId: 'npc-1', initiativeModifier: 2 },
            { name: 'NPC 2', npcId: 'npc-2', initiativeModifier: 1 },
          ],
          false,
          mockUserId,
        ),
      ).rejects.toThrow(NotFoundError);
    });

    it('should succeed if all NPCs are owned by the user in startCombat', async () => {
      // 1. Mock Batch NPC access check
      const qb1 = createMockQueryBuilder([{ id: 'npc-1' }, { id: 'npc-2' }]);
      // 2. Mock session ownership check
      const qb2 = createMockQueryBuilder([{ id: mockSessionId }]);
      // 3. Mock the participant NPC-row lookup performed before building participants.
      const qb3 = createMockQueryBuilder([{ id: 'npc-1' }, { id: 'npc-2' }]);

      (db.select as any).mockReturnValueOnce(qb1).mockReturnValueOnce(qb2).mockReturnValueOnce(qb3);

      // 4. Mock encounter creation with an explicit INSERT ... VALUES
      const insertEncounterQb = createMockQueryBuilder();
      insertEncounterQb.returning.mockResolvedValue([
        { id: mockEncounterId, status: 'active', currentRound: 1, currentTurnOrder: 0 },
      ]);
      (db.insert as any).mockReturnValueOnce(insertEncounterQb);

      // 5. Mock participants insertion
      const insertParticipantsQb = createMockQueryBuilder([
        {
          id: 'p1',
          name: 'NPC 1',
          npcId: 'npc-1',
          initiative: 15,
          initiativeModifier: 2,
          turnOrder: 0,
          isActive: true,
        },
        {
          id: 'p2',
          name: 'NPC 2',
          npcId: 'npc-2',
          initiative: 10,
          initiativeModifier: 1,
          turnOrder: 1,
          isActive: true,
        },
      ]);
      (db.insert as any).mockReturnValueOnce(insertParticipantsQb);

      // Combat start also initializes one status row per inserted participant.
      (db.insert as any).mockReturnValueOnce(createMockQueryBuilder());

      const result = await CombatEncounterService.startCombat(
        mockSessionId,
        [
          { name: 'NPC 1', npcId: 'npc-1', initiativeModifier: 2 },
          { name: 'NPC 2', npcId: 'npc-2', initiativeModifier: 1 },
        ],
        false,
        mockUserId,
      );

      expect(result.encounter.id).toBe(mockEncounterId);
      expect(result.participants).toHaveLength(2);
    });
  });

  describe('addParticipant NPC Security', () => {
    it('should throw NotFoundError if the NPC is not owned by the user in addParticipant', async () => {
      // 1. Mock Encounter access check
      const qb1 = createMockQueryBuilder([{ id: mockEncounterId }]);
      // 2. Mock NPC access check - not found
      const qb2 = createMockQueryBuilder([]);

      (db.select as any).mockReturnValueOnce(qb1).mockReturnValueOnce(qb2);

      await expect(
        CombatInitiativeService.addParticipant(
          mockEncounterId,
          { name: 'Evil NPC', npcId: 'npc-evil', initiativeModifier: 5 },
          mockUserId,
        ),
      ).rejects.toThrow(NotFoundError);
    });

    it('should succeed if the NPC is owned by the user in addParticipant', async () => {
      // 1. Mock Encounter access check
      const qb1 = createMockQueryBuilder([{ id: mockEncounterId }]);
      // 2. Mock NPC access check
      const qb2 = createMockQueryBuilder([{ id: 'npc-good' }]);
      // 3. Mock encounter existence check
      const qb3 = createMockQueryBuilder([{ id: mockEncounterId }]);

      (db.select as any)
        .mockReturnValueOnce(qb1)
        .mockReturnValueOnce(qb2)
        .mockReturnValueOnce(qb3);

      // 4. Mock participant insertion with an explicit INSERT ... VALUES
      const insertQb = createMockQueryBuilder();
      insertQb.returning.mockResolvedValue([{ id: 'p3', name: 'Good NPC', npcId: 'npc-good' }]);
      (db.insert as any).mockReturnValueOnce(insertQb);

      const result = await CombatInitiativeService.addParticipant(
        mockEncounterId,
        { name: 'Good NPC', npcId: 'npc-good', initiativeModifier: 3 },
        mockUserId,
      );

      expect(result.npcId).toBe('npc-good');
    });
  });

  describe('rollInitiative Security', () => {
    it('should throw NotFoundError if the user does not own the participant in rollInitiative', async () => {
      // Mock verifyParticipantOwnership - fail (empty results means not found/unauthorized)
      const qb = createMockQueryBuilder([]);
      (db.select as any).mockReturnValueOnce(qb);

      await expect(
        CombatInitiativeService.rollInitiative(
          mockEncounterId,
          'other-participant',
          15,
          undefined,
          mockUserId,
        ),
      ).rejects.toThrow(NotFoundError);
    });

    it('should succeed if the user owns the participant in rollInitiative', async () => {
      // 1. Mock verifyParticipantOwnership - success
      const qb1 = createMockQueryBuilder([{ id: 'my-participant' }]);
      // 2. Mock nested SELECT for UPDATE ... WHERE EXISTS
      const qb2 = createMockQueryBuilder([{ one: 1 }]);

      (db.select as any)
        .mockReturnValueOnce(qb1) // from verifyParticipantOwnership
        .mockReturnValueOnce(qb2); // from the UPDATE's exists clause

      // 3. Mock participant fetch for the service logic
      (db.query.combatParticipants.findFirst as any).mockResolvedValue({
        id: 'my-participant',
        encounterId: mockEncounterId,
        initiativeModifier: 2,
      });

      // 4. Mock update
      const updateQb = createMockQueryBuilder([{ id: 'my-participant' }]);
      (db.update as any).mockReturnValueOnce(updateQb);

      const result = await CombatInitiativeService.rollInitiative(
        mockEncounterId,
        'my-participant',
        15,
        undefined,
        mockUserId,
      );

      expect(result.total).toBeGreaterThanOrEqual(3); // server d20 + 2
      expect(result.total).toBeLessThanOrEqual(22);
    });
  });

  describe('reorderInitiative Security', () => {
    it('should throw NotFoundError if the user does not own the participant in reorderInitiative', async () => {
      const qb = createMockQueryBuilder([]);
      (db.select as any).mockReturnValueOnce(qb);

      await expect(
        CombatInitiativeService.reorderInitiative(
          mockEncounterId,
          'other-participant',
          20,
          mockUserId,
        ),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('advanceTurn Security', () => {
    it('should call findFirst with ownership verification in advanceTurn', async () => {
      const mockEncounter = {
        id: mockEncounterId,
        sessionId: mockSessionId,
        status: 'active',
        currentTurnOrder: 0,
        currentRound: 1,
        participants: [
          { id: 'p1', turnOrder: 0, isActive: true },
          { id: 'p2', turnOrder: 1, isActive: true },
        ],
      };

      (db.query.combatEncounters.findFirst as any).mockResolvedValue(mockEncounter);
      (db.update as any).mockReturnValue(createMockQueryBuilder([{ id: mockEncounterId }]));

      await CombatInitiativeService.advanceTurn(mockEncounterId, mockUserId);

      expect(db.query.combatEncounters.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.any(Function),
        }),
      );
    });
  });

  describe('removeParticipant Security', () => {
    it('should call update with ownership verification in removeParticipant', async () => {
      // Mock update
      const updateQb = createMockQueryBuilder([{ id: 'my-participant' }]);
      (db.update as any).mockReturnValueOnce(updateQb);

      // Mock the nested SELECT for the EXISTS clause in WHERE
      const selectQb = createMockQueryBuilder([{ one: 1 }]);
      (db.select as any).mockReturnValueOnce(selectQb);

      await CombatInitiativeService.removeParticipant('my-participant', mockUserId);

      // Verify that update was called
      expect(db.update).toHaveBeenCalled();
      // Verify that where was called (incorporating ownership)
      expect(updateQb.where).toHaveBeenCalled();
    });
  });
});
