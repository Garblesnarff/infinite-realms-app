/* eslint-disable max-lines */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client';
import { NotFoundError } from '../../lib/errors.js';
import { CombatAttackService } from '../combat-attack-service.js';
import { CombatHPService } from '../combat-hp-service.js';
import { CombatInitiativeService } from '../combat-initiative-service.js';

vi.mock('../combat-initiative-service.js', () => ({
  CombatInitiativeService: { getCurrentTurn: vi.fn() },
}));

vi.mock('../combat-hp-service.js', () => ({
  CombatHPService: { applyDamage: vi.fn() },
}));

// Mock the db client
vi.mock('../../../../db/client', () => ({
  db: {
    query: {
      characters: {
        findFirst: vi.fn(),
      },
      npcs: {
        findFirst: vi.fn(),
      },
      campaigns: {
        findFirst: vi.fn(),
      },
      weaponAttacks: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      creatureStats: {
        findFirst: vi.fn(),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(),
          innerJoin: vi.fn(() => ({
            where: vi.fn(),
          })),
        })),
        innerJoin: vi.fn(() => ({
          where: vi.fn(),
        })),
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
    transaction: vi.fn(),
    execute: vi.fn(),
  },
}));

// Mock drizzle-orm
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual('drizzle-orm');
  return {
    ...(actual as any),
    and: vi.fn((...args) => ({ type: 'and', args })),
    or: vi.fn((...args) => ({ type: 'or', args })),
    eq: vi.fn((a, b) => ({ type: 'eq', a, b })),
    exists: vi.fn((subquery) => ({ type: 'exists', subquery })),
    desc: vi.fn((col) => ({ type: 'desc', col })),
  };
});

describe('CombatAttackService', () => {
  const mockUserId = 'user-123';
  const mockCharacterId = 'char-123';
  const mockWeaponId = 'weapon-123';
  const service = new CombatAttackService();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Math, 'random').mockReturnValue(0.95);
    vi.mocked(CombatInitiativeService.getCurrentTurn).mockResolvedValue({
      id: 'attacker-123',
    } as any);
    vi.mocked(CombatHPService.applyDamage).mockResolvedValue({
      damageDealt: 1,
      newCurrentHp: 9,
      isConscious: true,
      isDead: false,
    } as any);
    (db.update as any).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ version: 2 }]) }),
      }),
    });
    const txUpdate = (result: unknown[]) => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue(result) }),
      }),
    });
    (db.transaction as any).mockImplementation(async (callback: (tx: any) => unknown) =>
      callback({
        update: vi
          .fn()
          .mockReturnValueOnce(txUpdate([{ version: 2 }]))
          .mockReturnValueOnce(txUpdate([{ id: 'attacker-123' }])),
      }),
    );
  });

  describe('Security: getCharacterWeapons', () => {
    it('should incorporate userId/ownerId in query', async () => {
      (db.query.weaponAttacks.findMany as any).mockResolvedValue([]);

      await service.getCharacterWeapons(mockCharacterId, mockUserId);

      expect(db.query.weaponAttacks.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: 'and',
          }),
        }),
      );
    });
  });

  describe('Security: createWeaponAttack', () => {
    /**
     * The ownership check used to ride inside an insert-select. Projecting 8 of
     * weapon_attacks' 10 columns, Drizzle rejected the statement while building it,
     * so adding a custom weapon never worked. It is now an ownership SELECT followed
     * by a plain insert.
     */
    // Once, not mockReturnValue: createWeaponAttack makes exactly one db.select call,
    // and a persistent implementation would leak into the sibling suites below
    // (vi.clearAllMocks clears recorded calls, not implementations).
    const mockOwnershipCheck = (rows: unknown[]) => {
      (db.select as any).mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(rows),
      });
    };

    const input = {
      characterId: mockCharacterId,
      name: 'Sword',
      attackBonus: 5,
      damageDice: '1d8',
      damageBonus: 2,
      damageType: 'slashing' as const,
    };

    it('should throw NotFoundError if character is not owned (atomic check)', async () => {
      mockOwnershipCheck([]);
      const mockValues = vi.fn();
      (db.insert as any).mockReturnValue({ values: mockValues });

      await expect(service.createWeaponAttack(input, mockUserId)).rejects.toThrow(NotFoundError);

      // An unowned character must not reach the write.
      expect(mockValues).not.toHaveBeenCalled();
    });

    it('should succeed if character is owned (atomic check)', async () => {
      mockOwnershipCheck([{ one: 1 }]);
      (db.insert as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: mockWeaponId }]),
        }),
      });

      const result = await service.createWeaponAttack(input, mockUserId);

      expect(result.id).toBe(mockWeaponId);
      expect(db.insert).toHaveBeenCalled();
    });
  });

  describe('Security: getCreatureStats', () => {
    it('should incorporate ownership in where clause', async () => {
      (db.query.creatureStats.findFirst as any).mockResolvedValue({ armorClass: 15 });

      await service.getCreatureStats(mockCharacterId, mockUserId);

      expect(db.query.creatureStats.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: 'and',
          }),
        }),
      );
    });
  });

  describe('resolveAttack', () => {
    it('should successfully resolve an attack using joined participant data', async () => {
      const mockEncounterId = 'enc-123';
      const mockTargetId = 'target-123';
      const mockAttackerId = 'attacker-123';

      (db.select as any)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([
            {
              participant: {
                id: mockTargetId,
                name: 'The Professor',
                armorClass: 15,
                participantType: 'npc',
                damageImmunities: [],
                damageResistances: [],
                damageVulnerabilities: [],
              },
              stats: { armorClass: 15 },
              status: {
                currentHp: 10,
                maxHp: 10,
                tempHp: 0,
                isConscious: true,
                deathSavesFailures: 0,
              },
              encounter: { currentRound: 1, sessionId: 'session-123' },
            },
            {
              participant: { id: mockAttackerId, armorClass: 10, participantType: 'player' },
              stats: null,
              status: null,
              encounter: {},
            },
          ]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([]),
        });

      const result = await service.resolveAttack(
        mockEncounterId,
        {
          attackerId: mockAttackerId,
          expectedVersion: 1,
          targetId: mockTargetId,
          attackType: 'melee',
        },
        mockUserId,
      );

      expect(result.hit).toBe(true);
      expect(result.isCritical).toBe(true);
      expect(result.targetAC).toBe(15);
      expect(result.transcriptLines).toEqual(['⚙️ Engine: The Professor turns hostile.']);
    });

    it('should throw NotFoundError if attacker is not owned', async () => {
      const mockEncounterId = 'enc-123';
      const mockTargetId = 'target-123';
      const mockAttackerId = 'attacker-123';

      (db.select as any).mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          {
            participant: { id: mockTargetId, armorClass: 15 },
            stats: { armorClass: 15 },
            status: null,
            encounter: {},
          },
        ]),
      });

      await expect(
        service.resolveAttack(
          mockEncounterId,
          {
            attackerId: mockAttackerId,
            expectedVersion: 1,
            targetId: mockTargetId,
            attackType: 'melee',
          },
          mockUserId,
        ),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('resolveSpellAttack', () => {
    it('should throw NotFoundError if caster is not owned', async () => {
      const mockEncounterId = 'enc-123';
      const mockCasterId = 'caster-123';
      vi.mocked(CombatInitiativeService.getCurrentTurn).mockResolvedValue({
        id: mockCasterId,
      } as any);

      (db.select as any).mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      });

      await expect(
        service.resolveSpellAttack(
          mockEncounterId,
          {
            casterId: mockCasterId,
            expectedVersion: 1,
            targetIds: ['target-1'],
            spellName: 'Fireball',
          },
          mockUserId,
        ),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
