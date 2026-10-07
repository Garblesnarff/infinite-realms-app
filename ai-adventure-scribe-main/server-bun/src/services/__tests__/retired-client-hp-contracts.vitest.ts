import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client';
import type { CombatParticipant, CombatParticipantStatus } from '../../../../db/schema/index';
import { combatEncounters, combatDamageLog } from '../../../../db/schema/index';
import { NotFoundError } from '../../lib/errors.js';
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
    }),
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
      },
    },
    execute: vi.fn(),
  };
  return { db };
});

describe('retired client HP contracts on CombatHPService', () => {
  const mockUserId = 'user-123';
  const mockEncounterId = 'enc-456';
  const mockParticipantId = 'part-789';

  const mockParticipant: CombatParticipant = {
    id: mockParticipantId,
    encounterId: mockEncounterId,
    // No character record: an NPC or monster, whose participant row is its only vitals row.
    characterId: null,
    npcId: null,
    name: 'Test monster',
    participantType: 'monster',
    initiative: 10,
    initiativeModifier: 0,
    turnOrder: 0,
    isActive: true,
    armorClass: 12,
    maxHp: 20,
    speed: 30,
    resourcesRound: 1,
    actionUsed: false,
    bonusActionUsed: false,
    reactionUsed: false,
    isDodging: false,
    isDisengaged: false,
    provoked: false,
    multiclassInfo: null,
    monsterAttack: null,
    createdAt: new Date('2026-10-07T00:00:00Z'),
    updatedAt: new Date('2026-10-07T00:00:00Z'),
    damageImmunities: [],
    damageResistances: [],
    damageVulnerabilities: [],
  };

  const mockStatus: CombatParticipantStatus = {
    id: 'status-1',
    exhaustionLevel: 0,
    updatedAt: new Date('2026-10-07T00:00:00Z'),
    participantId: mockParticipantId,
    currentHp: 20,
    maxHp: 20,
    tempHp: 0,
    isConscious: true,
    deathSavesSuccesses: 0,
    deathSavesFailures: 0,
  };

  beforeEach(() => {
    vi.mocked(CombatInitiativeService.getCurrentTurn).mockResolvedValue({
      id: mockParticipantId,
    } as any);
    vi.clearAllMocks();
    mockState.results = [];
  });

  describe('retired client HP adapter contracts on the live service', () => {
    it.each([
      ['plain damage', 0, 8, [], 12, 0, true],
      ['deplete temp HP first', 5, 8, [], 17, 0, true],
      ['partially deplete temp HP', 10, 8, [], 20, 2, true],
      ['become unconscious at zero HP', 0, 20, [], 0, 0, false],
      ['immunity leaves HP unchanged', 0, 8, ['fire'], 20, 0, true],
    ] as const)(
      '%s',
      async (_name, tempHp, damageAmount, immunities, currentHp, newTempHp, isConscious) => {
        mockState.results = [
          {
            participant: { ...mockParticipant, damageImmunities: [...immunities] },
            status: { ...mockStatus, tempHp },
            currentRound: 1,
          },
        ];
        const writer = db.update(combatEncounters);
        vi.mocked(writer.set).mockClear();
        const result = await CombatHPService.applyDamage(
          mockParticipantId,
          mockEncounterId,
          { damageAmount, damageType: 'fire' },
          mockUserId,
        );
        if (_name === 'plain damage') {
          expect(db.insert).toHaveBeenCalledWith(combatDamageLog);
          expect(vi.mocked(db.insert).mock.results[0].value.values).toHaveBeenCalledWith({
            encounterId: mockEncounterId,
            participantId: mockParticipantId,
            damageAmount: 8,
            damageType: 'fire',
            sourceParticipantId: null,
            sourceDescription: null,
            roundNumber: 1,
          });
        }
        expect(result.newCurrentHp).toBe(currentHp);
        expect(result.newTempHp).toBe(newTempHp);
        expect(result.isConscious).toBe(isConscious);
        expect(writer.set).toHaveBeenCalledWith(
          expect.objectContaining({
            currentHp,
            tempHp: newTempHp,
            isConscious,
          }),
        );
      },
    );

    it.each([
      ['heals conscious participant', 10, 5, 15, 5, false],
      ['caps healing at max HP', 18, 10, 20, 2, false],
      ['revives and resets death saves', 0, 5, 5, 5, true],
    ] as const)(
      '%s',
      async (_name, currentHp, amount, newCurrentHp, healingApplied, wasRevived) => {
        mockState.results = [
          {
            participant: mockParticipant,
            status: {
              ...mockStatus,
              currentHp,
              isConscious: currentHp > 0,
              deathSavesSuccesses: wasRevived ? 1 : 0,
              deathSavesFailures: wasRevived ? 2 : 0,
            },
            currentRound: 1,
          },
        ];
        const writer = db.update(combatEncounters);
        vi.mocked(writer.set).mockClear();
        const result = await CombatHPService.healDamage(
          mockParticipantId,
          mockEncounterId,
          amount,
          undefined,
          mockUserId,
        );
        expect(result.newCurrentHp).toBe(newCurrentHp);
        expect(result.healingApplied).toBe(healingApplied);
        expect(result.wasRevived).toBe(wasRevived);
        expect(writer.set).toHaveBeenCalledWith(
          expect.objectContaining({
            currentHp: newCurrentHp,
            isConscious: true,
            deathSavesSuccesses: 0,
            deathSavesFailures: 0,
          }),
        );
      },
    );

    it.each(['damage', 'healing'])('refuses %s for a missing participant', async (kind) => {
      mockState.results = [];
      await expect(
        kind === 'damage'
          ? CombatHPService.applyDamage(
              mockParticipantId,
              mockEncounterId,
              { damageAmount: 8 },
              mockUserId,
            )
          : CombatHPService.healDamage(
              mockParticipantId,
              mockEncounterId,
              5,
              undefined,
              mockUserId,
            ),
      ).rejects.toThrow(NotFoundError);
      expect(db.update).not.toHaveBeenCalled();
    });

    it.each(['damage', 'healing'])('propagates %s write failures', async (kind) => {
      mockState.results = [{ participant: mockParticipant, status: mockStatus, currentRound: 1 }];
      vi.mocked(db.update).mockImplementationOnce(() => {
        throw new Error('Update failed');
      });
      await expect(
        kind === 'damage'
          ? CombatHPService.applyDamage(
              mockParticipantId,
              mockEncounterId,
              { damageAmount: 8 },
              mockUserId,
            )
          : CombatHPService.healDamage(
              mockParticipantId,
              mockEncounterId,
              5,
              undefined,
              mockUserId,
            ),
      ).rejects.toThrow('Update failed');
    });

    it('keeps accepted damage when damage logging fails', async () => {
      mockState.results = [{ participant: mockParticipant, status: mockStatus, currentRound: 1 }];
      vi.mocked(db.insert).mockImplementationOnce(() => {
        throw new Error('Log failed');
      });
      const result = await CombatHPService.applyDamage(
        mockParticipantId,
        mockEncounterId,
        { damageAmount: 8 },
        mockUserId,
      );
      expect(result.newCurrentHp).toBe(12);
      expect(db.update).toHaveBeenCalled();
    });
  });
});
