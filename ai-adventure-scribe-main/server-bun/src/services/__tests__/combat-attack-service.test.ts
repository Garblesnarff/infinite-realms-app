/* eslint-disable max-lines */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client';
import { NotFoundError } from '../../lib/errors.js';
import { CombatAttackService } from '../combat-attack-service.js';
import { CombatInitiativeService } from '../combat-initiative-service.js';

vi.mock('../combat-initiative-service.js', () => ({
  CombatInitiativeService: { getCurrentTurn: vi.fn() },
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
                where: vi.fn()
            }))
        })),
        innerJoin: vi.fn(() => ({
            where: vi.fn()
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
    (db.update as any).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ version: 2 }]) }),
      }),
    });
  });

  describe('Security: getCharacterWeapons', () => {
    it('should incorporate userId/ownerId in query', async () => {
      (db.query.weaponAttacks.findMany as any).mockResolvedValue([]);

      await service.getCharacterWeapons(mockCharacterId, mockUserId);

      expect(db.query.weaponAttacks.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: 'and',
          })
        })
      );
    });
  });

  describe('Security: createWeaponAttack', () => {
    it('should throw NotFoundError if character is not owned (atomic check)', async () => {
      // Mock db.insert().select().returning() returning empty array
      (db.insert as any).mockReturnValue({
        select: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([])
        })
      });

      await expect(service.createWeaponAttack({
        characterId: mockCharacterId,
        name: 'Sword',
        attackBonus: 5,
        damageDice: '1d8',
        damageBonus: 2,
        damageType: 'slashing'
      }, mockUserId)).rejects.toThrow(NotFoundError);
    });

    it('should succeed if character is owned (atomic check)', async () => {
      (db.insert as any).mockReturnValue({
        select: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: mockWeaponId }])
        })
      });

      const result = await service.createWeaponAttack({
        characterId: mockCharacterId,
        name: 'Sword',
        attackBonus: 5,
        damageDice: '1d8',
        damageBonus: 2,
        damageType: 'slashing'
      }, mockUserId);

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
            type: 'and'
          })
        })
      );
    });
  });

  describe('resolveAttack', () => {
    it('should successfully resolve an attack using joined participant data', async () => {
      const mockEncounterId = 'enc-123';
      const mockTargetId = 'target-123';
      const mockAttackerId = 'attacker-123';

      (db.select as any).mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          { participant: { id: mockTargetId, armorClass: 15 }, stats: { armorClass: 15 }, status: null, encounter: {} },
          { participant: { id: mockAttackerId, armorClass: 10 }, stats: null, status: null, encounter: {} },
        ]),
      }).mockReturnValueOnce({
        from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      });

      const result = await service.resolveAttack(mockEncounterId, {
        attackerId: mockAttackerId,
        expectedVersion: 1,
        targetId: mockTargetId,
        attackType: 'melee'
      }, mockUserId);

      expect(result.hit).toBe(true);
      expect(result.isCritical).toBe(true);
      expect(result.targetAC).toBe(15);
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
          { participant: { id: mockTargetId, armorClass: 15 }, stats: { armorClass: 15 }, status: null, encounter: {} },
        ]),
      });

      await expect(service.resolveAttack(mockEncounterId, {
        attackerId: mockAttackerId,
        expectedVersion: 1,
        targetId: mockTargetId,
        attackType: 'melee'
      }, mockUserId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('resolveSpellAttack', () => {
    it('should throw NotFoundError if caster is not owned', async () => {
      const mockEncounterId = 'enc-123';
      const mockCasterId = 'caster-123';
      vi.mocked(CombatInitiativeService.getCurrentTurn).mockResolvedValue({ id: mockCasterId } as any);

      (db.select as any).mockReturnValueOnce({
        from: vi.fn().mockReturnThis(), leftJoin: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]),
      });

      await expect(service.resolveSpellAttack(mockEncounterId, {
        casterId: mockCasterId,
        expectedVersion: 1,
        targetIds: ['target-1'],
        spellName: 'Fireball'
      }, mockUserId)).rejects.toThrow(NotFoundError);
    });
  });
});
