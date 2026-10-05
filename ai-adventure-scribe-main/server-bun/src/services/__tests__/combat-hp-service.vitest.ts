import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client';
import { combatEncounters } from '../../../../db/schema/index';
import { NotFoundError, BusinessLogicError } from '../../lib/errors.js';
import * as HPDataAccess from '../combat/hp-data-access.js';
import { CombatHPService } from '../combat-hp-service.js';
import { CombatInitiativeService } from '../combat-initiative-service.js';

vi.mock('../combat-initiative-service.js', () => ({
  CombatInitiativeService: { getCurrentTurn: vi.fn() },
}));

// Mock state for query builder
const mockState = {
  results: [] as any[],
};

// Mock the database client
vi.mock('../../../../db/client', () => {
  const mockQueryBuilder = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    // SELECT ... FOR UPDATE, used by the character-record read the write-through locks.
    for: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    then: vi.fn((resolve: any) => {
      return Promise.resolve(mockState.results).then(resolve);
    })
  };
  const db = {
    select: vi.fn(() => mockQueryBuilder),
    insert: vi.fn(() => mockQueryBuilder),
    update: vi.fn(() => mockQueryBuilder),
    delete: vi.fn(() => mockQueryBuilder),
    // The write-through composes the character_stats write and the participant mirror into a
    // single transaction. Handing the callback this same object keeps both statements
    // countable through `db.update`.
    transaction: vi.fn(async (callback: any) => callback(db)),
    query: {
      combatParticipants: {
        findFirst: vi.fn(),
      }
    },
    execute: vi.fn()
  };
  return { db };
});

describe('CombatHPService', () => {
  const mockUserId = 'user-123';
  const mockEncounterId = 'enc-456';
  const mockParticipantId = 'part-789';

  const mockParticipant = {
    id: mockParticipantId,
    encounterId: mockEncounterId,
    // No character record: an NPC or monster, whose participant row is its only vitals row.
    characterId: null,
    damageImmunities: [],
    damageResistances: [],
    damageVulnerabilities: [],
  };

  // A player character's participant, which the write-through mirrors onto `character_stats`.
  const mockPlayerParticipant = {
    ...mockParticipant,
    characterId: 'char-321',
    participantType: 'player',
  };

  const mockStatus = {
    participantId: mockParticipantId,
    currentHp: 20,
    maxHp: 20,
    tempHp: 0,
    isConscious: true,
    deathSavesSuccesses: 0,
    deathSavesFailures: 0,
  };

  beforeEach(() => {
    vi.mocked(CombatInitiativeService.getCurrentTurn).mockResolvedValue({ id: mockParticipantId } as any);
    vi.clearAllMocks();
    mockState.results = [];
  });

  describe('HPDataAccess', () => {
    describe('getParticipantWithFullContext', () => {
      it('should throw NotFoundError if participant not found', async () => {
        // Mock empty result
        mockState.results = [];

        await expect(HPDataAccess.getParticipantWithFullContext(mockParticipantId, mockEncounterId, mockUserId))
          .rejects.toThrow(NotFoundError);
      });

      it('should return context if participant found and authorized', async () => {
        const mockResult = [{
          participant: mockParticipant,
          status: mockStatus,
          currentRound: 1
        }];

        mockState.results = mockResult;

        const result = await HPDataAccess.getParticipantWithFullContext(mockParticipantId, mockEncounterId, mockUserId);
        expect(result).toEqual(mockResult[0]);
      });
    });

    describe('getParticipantStatusScoped', () => {
      it('should return status if found and authorized', async () => {
        mockState.results = [{
          encounterId: mockEncounterId,
          status: mockStatus
        }];

        const result = await HPDataAccess.getParticipantStatusScoped(mockParticipantId, mockUserId);
        expect(result?.status).toEqual(mockStatus);
      });

      it('should return null if not found', async () => {
        mockState.results = [];
        const result = await HPDataAccess.getParticipantStatusScoped(mockParticipantId, mockUserId);
        expect(result).toBeNull();
      });
    });

    describe('getParticipantStatus', () => {
      it('should return status', async () => {
        mockState.results = [{
          encounterId: mockEncounterId,
          status: mockStatus
        }];

        const result = await HPDataAccess.getParticipantStatus(mockParticipantId, mockUserId);
        expect(result).toEqual(mockStatus);
      });
    });

    describe('initializeParticipantStatus', () => {
      it('should initialize status', async () => {
        mockState.results = [mockStatus];

        const result = await HPDataAccess.initializeParticipantStatus(mockParticipantId, 20);
        expect(result).toEqual(mockStatus);
        expect(db.insert).toHaveBeenCalled();
      });
    });
  });

  describe('CombatHPService', () => {
    describe('applyDamage', () => {
      it('should apply damage and log it', async () => {
        const mockResult = [{
          participant: mockParticipant,
          status: mockStatus,
          currentRound: 1
        }];
        mockState.results = mockResult;

        const result = await CombatHPService.applyDamage(
          mockParticipantId,
          mockEncounterId,
          { damageAmount: 10, damageType: 'piercing' },
          mockUserId
        );

        expect(result.newCurrentHp).toBe(10);
        expect(db.update).toHaveBeenCalled();
        expect(db.insert).toHaveBeenCalled();
        // No character record to mirror into, so no transaction is opened.
        expect(db.transaction).not.toHaveBeenCalled();
      });

      it('should write the character record and the participant mirror in one transaction', async () => {
        mockState.results = [{
          participant: mockPlayerParticipant,
          status: mockStatus,
          currentRound: 1
        }];

        const result = await CombatHPService.applyDamage(
          mockParticipantId,
          mockEncounterId,
          { damageAmount: 6, damageType: 'slashing' },
          mockUserId
        );

        expect(result.newCurrentHp).toBe(14);
        // Three UPDATEs. character_stats first, then combat_participant_status, both inside the
        // transaction; combat_encounters third, after it commits, on the pool. This shared
        // query-builder mock cannot tell the payloads apart;
        // combat-hp-write-through.test.ts asserts what each row actually receives.
        expect(db.transaction).toHaveBeenCalledTimes(1);
        expect(db.update).toHaveBeenCalledTimes(3);
        expect(db.update).toHaveBeenNthCalledWith(3, combatEncounters);
      });
    });

    describe('healDamage', () => {
      it('should heal participant', async () => {
        const injuredStatus = { ...mockStatus, currentHp: 10 };
        mockState.results = [{
          participant: mockParticipant,
          status: injuredStatus,
          currentRound: 1
        }];

        const result = await CombatHPService.healDamage(
          mockParticipantId,
          mockEncounterId,
          5,
          undefined,
          mockUserId
        );

        expect(result.newCurrentHp).toBe(15);
        expect(db.update).toHaveBeenCalled();
      });
    });

    describe('setTempHP', () => {
      it('should set temp HP', async () => {
        mockState.results = [{
          participant: mockParticipant,
          status: mockStatus,
          currentRound: 1
        }];

        const result = await CombatHPService.setTempHP(
          mockParticipantId,
          mockEncounterId,
          10,
          mockUserId
        );

        expect(result.newTempHp).toBe(10);
        expect(db.update).toHaveBeenCalled();
      });
    });

    describe('rollDeathSave', () => {
      it('should roll death save for unconscious participant', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.7); // Natural 15
        const unconsciousStatus = { ...mockStatus, currentHp: 0, isConscious: false };
        mockState.results = [{
          participant: mockParticipant,
          status: unconsciousStatus,
          currentRound: 1
        }];

        const result = await CombatHPService.rollDeathSave(
          mockParticipantId,
          mockEncounterId,
          mockUserId
        );

        expect(result.successes).toBe(1);
        expect(db.update).toHaveBeenCalled();
      });

      it('should throw BusinessLogicError if conscious', async () => {
        mockState.results = [{
          participant: mockParticipant,
          status: mockStatus, // Conscious
          currentRound: 1
        }];

        await expect(CombatHPService.rollDeathSave(mockParticipantId, mockEncounterId, mockUserId))
          .rejects.toThrow(BusinessLogicError);
      });
    });

    describe('checkConscious', () => {
      it('should return consciousness state', async () => {
        mockState.results = [{
          encounterId: mockEncounterId,
          status: mockStatus
        }];

        const result = await CombatHPService.checkConscious(mockParticipantId, mockUserId);
        expect(result).toBe(true);
      });
    });

    describe('stabilizeWithMedicine', () => {
      it('should stabilize dying participant on success', async () => {
        const dyingStatus = { ...mockStatus, currentHp: 0, isConscious: false };
        mockState.results = [{
          participant: mockParticipant,
          status: dyingStatus,
          currentRound: 1
        }];

        const result = await CombatHPService.stabilizeWithMedicine(
          mockParticipantId,
          mockEncounterId,
          10, // Medicine check roll
          2,  // Modifier
          mockUserId
        );

        expect(result.success).toBe(true);
        expect(db.update).toHaveBeenCalled();
      });
    });

    describe('getDamageLog', () => {
      it('should fetch damage log with authorization', async () => {
        const mockLogs = [{ id: 'log-1', damageAmount: 10 }];
        mockState.results = mockLogs.map(l => ({ log: l }));

        const result = await CombatHPService.getDamageLog(mockEncounterId, undefined, undefined, mockUserId);

        expect(result).toEqual(mockLogs);
        expect(db.select).toHaveBeenCalled();
      });
    });
  });
});
