import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CombatHPService } from '../combat-hp-service.js';
import { db } from '../../../../db/client';
import {
  combatParticipants,
  combatParticipantStatus,
  combatEncounters,
  combatDamageLog,
} from '../../../../db/schema/index';
import { NotFoundError, BusinessLogicError } from '../../lib/errors.js';

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
  return {
    db: {
      select: vi.fn(() => mockQueryBuilder),
      insert: vi.fn(() => mockQueryBuilder),
      update: vi.fn(() => mockQueryBuilder),
      delete: vi.fn(() => mockQueryBuilder),
      query: {
        combatParticipants: {
          findFirst: vi.fn(),
        }
      },
      execute: vi.fn()
    }
  };
});

describe('CombatHPService', () => {
  const mockUserId = 'user-123';
  const mockEncounterId = 'enc-456';
  const mockParticipantId = 'part-789';

  const mockParticipant = {
    id: mockParticipantId,
    encounterId: mockEncounterId,
    damageImmunities: [],
    damageResistances: [],
    damageVulnerabilities: [],
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
    vi.clearAllMocks();
    mockState.results = [];
  });

  describe('getParticipantWithFullContext (private)', () => {
    it('should throw NotFoundError if participant not found', async () => {
      // Accessing private method for testing
      const service = CombatHPService as any;

      // Mock empty result
      mockState.results = [];

      await expect(service.getParticipantWithFullContext(mockParticipantId, mockEncounterId, mockUserId))
        .rejects.toThrow(NotFoundError);
    });

    it('should return context if participant found and authorized', async () => {
      const service = CombatHPService as any;
      const mockResult = [{
        participant: mockParticipant,
        status: mockStatus,
        currentRound: 1
      }];

      mockState.results = mockResult;

      const result = await service.getParticipantWithFullContext(mockParticipantId, mockEncounterId, mockUserId);
      expect(result).toEqual(mockResult[0]);
    });
  });

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
      const unconsciousStatus = { ...mockStatus, currentHp: 0, isConscious: false };
      mockState.results = [{
        participant: mockParticipant,
        status: unconsciousStatus,
        currentRound: 1
      }];

      const result = await CombatHPService.rollDeathSave(
        mockParticipantId,
        mockEncounterId,
        15, // Success
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

      await expect(CombatHPService.rollDeathSave(mockParticipantId, mockEncounterId, 15, mockUserId))
        .rejects.toThrow(BusinessLogicError);
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
