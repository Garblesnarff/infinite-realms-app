/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client';
import { NotFoundError } from '../../lib/errors.js';
import { RestService } from '../rest-service.js';
import { SpellSlotsService } from '../spell-slots-service.js';
import { CharacterVitalsService } from '../character-vitals-service.js';
import { CombatHPService } from '../combat-hp-service.js';

// Mock the write-through services: the real-db suite proves what they store;
// the mocked suite pins that takeLongRest calls them (not raw updates).
vi.mock('../character-vitals-service.js', () => ({
  CharacterVitalsService: { heal: vi.fn() },
}));
vi.mock('../combat-hp-service.js', () => ({
  CombatHPService: { healDamage: vi.fn() },
}));

// Mock the db client
vi.mock('../../../../db/client', () => ({
  db: {
    query: {
      characters: {
        findFirst: vi.fn(),
      },
      characterHitDice: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      restEvents: {
        findMany: vi.fn(),
      },
      combatParticipants: {
        findMany: vi.fn(),
      },
    },
    select: vi.fn(() => {
      const mock = {
        from: vi.fn(() => mock),
        leftJoin: vi.fn(() => mock),
        where: vi.fn(() => mock),
        limit: vi.fn(() => mock),
        orderBy: vi.fn(() => mock),
        returning: vi.fn(),
      };
      return mock;
    }),
    insert: vi.fn(() => {
      const mock = {
        values: vi.fn(() => mock),
        select: vi.fn(() => mock),
        returning: vi.fn(),
      };
      return mock;
    }),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
    execute: vi.fn().mockResolvedValue([]),
  },
}));

// Mock the schema symbols to avoid undefined errors
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual('drizzle-orm');
  return {
    ...(actual as any),
  };
});

describe('RestService Security', () => {
  const mockUserId = 'user-123';
  const mockCharacterId = 'char-123';

  beforeEach(() => {
    vi.clearAllMocks();
    (db.query.combatParticipants.findMany as any).mockResolvedValue([]);
  });

  describe('takeShortRest', () => {
    it('should throw NotFoundError if character is not found or not owned by user', async () => {
      // Mock character NOT found or NOT owned
      (db.query.characters.findFirst as any).mockResolvedValue(null);

      await expect(RestService.takeShortRest(mockCharacterId, mockUserId)).rejects.toThrow(
        NotFoundError,
      );
    });

    it('should succeed if character is owned by user', async () => {
      // Mock character found and owned
      (db.query.characters.findFirst as any).mockResolvedValue({
        id: mockCharacterId,
        hitDice: [],
        classFeatures: null,
        pactSlots: null,
        spellSlots: null,
      });

      // Mock internal hit dice lookup
      (db.query.characterHitDice.findMany as any).mockResolvedValue([]);
      (db.query.combatParticipants.findMany as any).mockResolvedValue([]);

      // #2598: the short-rest result serves the engine's slot table through
      // SpellSlotDataAccess.getCharacterSpellSlots, which awaits the
      // select→from→leftJoin→where→orderBy chain. No rows here.
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([{ slot: null, charId: mockCharacterId }]),
      });

      // Mock rest event insertion
      (db.insert as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'event-123' }]),
        }),
      });

      const result = await RestService.takeShortRest(mockCharacterId, mockUserId);
      expect(result).toBeDefined();
      expect(result.characterId).toBe(mockCharacterId);
      expect(result.restEventId).toBe('event-123');
    });
  });

  describe('takeLongRest', () => {
    it('should throw NotFoundError if character is not found or not owned by user', async () => {
      (db.query.characters.findFirst as any).mockResolvedValue(null);

      await expect(RestService.takeLongRest(mockCharacterId, mockUserId)).rejects.toThrow(
        NotFoundError,
      );
    });

    it('should succeed if character is owned by user', async () => {
      (db.query.characters.findFirst as any).mockResolvedValue({
        id: mockCharacterId,
        stats: {
          constitution: 10,
          maxHitPoints: 10,
          currentHitPoints: 10,
        },
        hitDice: [],
        classFeatures: null,
        pactSlots: null,
        spellSlots: null,
      });

      (db.query.characterHitDice.findMany as any).mockResolvedValue([]);
      (db.insert as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'event-456' }]),
        }),
      });

      // #2459: takeLongRest resets the engine's slot table through
      // SpellSlotsService.restoreSpellSlots, whose ownership check is a
      // select→from→leftJoin→where chain. Resolve it as "character found, no
      // slot rows", so the restore is a no-op here.
      //
      // #2598: the result also reads the slot table through
      // SpellSlotDataAccess.getCharacterSpellSlots, which chains .orderBy()
      // after .where(). One thenable serves both shapes.
      const noSlotRows = [{ slot: null, charId: mockCharacterId }];
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue(noSlotRows),
          then: (resolve: (value: unknown) => void) => resolve(noSlotRows),
        }),
      });

      const result = await RestService.takeLongRest(mockCharacterId, mockUserId);
      expect(result).toBeDefined();
      expect(result.restEventId).toBe('event-456');
    });

    it('heals the sheet and participants through the write-through paths (#2600)', async () => {
      // The write-through services are module-mocked above: the real-db suite
      // proves what they store; here we pin that takeLongRest calls them
      // (not raw updates).
      const healMock = vi.mocked(CharacterVitalsService.heal);
      const healDamageMock = vi.mocked(CombatHPService.healDamage);
      healMock.mockResolvedValue({} as any);
      healDamageMock.mockResolvedValue({} as any);

      try {
        // #180: the guard refuses a 0 HP character, so this wires the
        // write-through with a standing, wounded character (10/30) instead
        // of a dying one; the guard's own refusals are pinned in the
        // real-DB suite.
        (db.query.characters.findFirst as any).mockResolvedValue({
          id: mockCharacterId,
          stats: {
            constitution: 10,
            maxHitPoints: 30,
            currentHitPoints: 10,
            vitalState: 'standing',
          },
          hitDice: [],
          classFeatures: null,
          pactSlots: null,
          spellSlots: null,
        });

        (db.query.characterHitDice.findMany as any).mockResolvedValue([]);
        // A wounded participant in an active encounter.
        (db.query.combatParticipants.findMany as any).mockResolvedValue([
          {
            id: 'part-1',
            encounterId: 'enc-1',
            status: { maxHp: 30 },
            encounter: { status: 'active' },
          },
        ]);
        (db.insert as any).mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'event-789' }]),
          }),
        });

        // Same slot-table shape as the test above: character found, no slot rows.
        const noSlotRows = [{ slot: null, charId: mockCharacterId }];
        (db.select as any).mockReturnValue({
          from: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(noSlotRows),
            then: (resolve: (value: unknown) => void) => resolve(noSlotRows),
          }),
        });

        await RestService.takeLongRest(mockCharacterId, mockUserId);

        // The sheet is healed through CharacterVitalsService (vitalState,
        // isConscious and tallies move with the HP; dead are left alone).
        expect(healMock).toHaveBeenCalledWith(mockCharacterId, mockUserId, 20);
        // Each participant is healed through CombatHPService (HP to max,
        // conscious, tallies 0/0 via the write-through; dead are left alone).
        expect(healDamageMock).toHaveBeenCalledWith('part-1', 'enc-1', 30, 'long rest', mockUserId);
      } finally {
        healMock.mockReset();
        healDamageMock.mockReset();
      }
    });
  });

  describe('spell slots served from the engine table (#2598)', () => {
    const staleJsonb = { '1': { max: 4, current: 2 } };
    const tableRowsAllSpent = [
      {
        id: 'slot-1',
        characterId: mockCharacterId,
        spellLevel: 1,
        totalSlots: 4,
        usedSlots: 4,
        remainingSlots: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    const tableRowsRestored = [
      {
        id: 'slot-1',
        characterId: mockCharacterId,
        spellLevel: 1,
        totalSlots: 4,
        usedSlots: 0,
        remainingSlots: 4,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    function mockRestEventInsert() {
      (db.insert as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'event-1' }]),
        }),
      });
    }

    it('short rest serves the table rows, not the stale JSONB', async () => {
      (db.query.characters.findFirst as any).mockResolvedValue({
        id: mockCharacterId,
        hitDice: [],
        classFeatures: null,
        pactSlots: null,
        spellSlots: staleJsonb,
      });
      (db.query.characterHitDice.findMany as any).mockResolvedValue([]);
      mockRestEventInsert();
      const getSpy = vi
        .spyOn(SpellSlotsService, 'getCharacterSpellSlots')
        .mockResolvedValue({
          characterId: mockCharacterId,
          slots: tableRowsAllSpent,
          totalAvailableSlots: 4,
          totalUsedSlots: 4,
        } as any);

      const result = await RestService.takeShortRest(mockCharacterId, mockUserId);
      getSpy.mockRestore();

      // The JSONB says current 2; the table says all 4 slots spent, so the
      // result must show current 0. Reading character.spellSlots (the revert)
      // reports 2 here instead.
      expect(result.spellSlots).toEqual({ '1': { max: 4, current: 0 } });
    });

    it('long rest restores the table and leaves characters.spell_slots untouched', async () => {
      (db.query.characters.findFirst as any).mockResolvedValue({
        id: mockCharacterId,
        stats: {
          constitution: 10,
          maxHitPoints: 10,
          currentHitPoints: 10,
        },
        hitDice: [],
        classFeatures: null,
        pactSlots: null,
        // NULL JSONB: the old code returned null here even though the table
        // was reset, so the sheet kept its spent slots.
        spellSlots: null,
      });
      (db.query.characterHitDice.findMany as any).mockResolvedValue([]);
      mockRestEventInsert();
      // #170: takeLongRest looks up the rest-clearable condition ids from the
      // conditions library; resolve empty so the lookup is a no-op here. Saved
      // and restored because mock implementations leak across tests in this
      // file (clearAllMocks does not remove them).
      const selectImpl = (db.select as any).getMockImplementation();
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      });
      const restoreSpy = vi
        .spyOn(SpellSlotsService, 'restoreSpellSlots')
        .mockResolvedValue({
          characterId: mockCharacterId,
          slotsRestored: [{ level: 1, restoredAmount: 4 }],
          totalRestored: 4,
        } as any);
      const getSpy = vi
        .spyOn(SpellSlotsService, 'getCharacterSpellSlots')
        .mockResolvedValue({
          characterId: mockCharacterId,
          slots: tableRowsRestored,
          totalAvailableSlots: 4,
          totalUsedSlots: 0,
        } as any);
      const setCalls: any[] = [];
      const updateMock = db.update as any;
      const updateImpl = updateMock.getMockImplementation();
      updateMock.mockImplementation(() => ({
        set: vi.fn((arg: any) => {
          setCalls.push(arg);
          return { where: vi.fn() };
        }),
      }));

      const result = await RestService.takeLongRest(mockCharacterId, mockUserId);

      expect(restoreSpy).toHaveBeenCalledWith({ characterId: mockCharacterId }, mockUserId);
      // The table was restored, so current is back to max. The old code served
      // the JSONB here (null for this character).
      expect(result.spellSlots).toEqual({ '1': { max: 4, current: 4 } });
      // The characters UPDATE must no longer write the legacy JSONB column.
      // The stats update is the other db.update call; the characters one is
      // the one that also writes pactSlots.
      const characterUpdate = setCalls.find((arg) => 'pactSlots' in arg);
      expect(characterUpdate).toBeDefined();
      expect(characterUpdate).not.toHaveProperty('spellSlots');

      restoreSpy.mockRestore();
      getSpy.mockRestore();
      updateMock.mockImplementation(updateImpl);
      (db.select as any).mockImplementation(selectImpl);
    });
  });

  describe('initializeHitDice', () => {
    it('should throw NotFoundError if character is not found or not owned by user', async () => {
      (db.query.characters.findFirst as any).mockResolvedValue(null);

      await expect(
        RestService.initializeHitDice(mockCharacterId, mockUserId, 'Wizard', 1),
      ).rejects.toThrow(NotFoundError);
    });

    it('should succeed and return new hit dice if owned by user', async () => {
      (db.query.characters.findFirst as any).mockResolvedValue({ id: mockCharacterId });
      (db.query.characterHitDice.findFirst as any).mockResolvedValue(null);

      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ one: 1 }]),
      });

      (db.insert as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'hd-123', characterId: mockCharacterId }]),
        }),
      });

      const result = await RestService.initializeHitDice(mockCharacterId, mockUserId, 'Wizard', 1);
      expect(result).toBeDefined();
      expect(result.id).toBe('hd-123');
    });
  });

  describe('getHitDice', () => {
    it('should include exists check in where clause for hit dice', async () => {
      (db.query.characterHitDice.findMany as any).mockResolvedValue([]);

      await RestService.getHitDice(mockCharacterId, mockUserId);

      expect(db.query.characterHitDice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.any(Object),
        }),
      );
    });
  });
});
