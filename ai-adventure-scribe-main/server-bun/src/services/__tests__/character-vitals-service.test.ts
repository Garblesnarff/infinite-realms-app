import { beforeEach, describe, expect, it, mock } from 'bun:test';

type Row = Record<string, unknown>;

const CHARACTER_ID = 'character-1';
const OWNER_ID = 'owner-1';

/** The `character_stats` row the mocked SELECT returns, or null for "not yours". */
let currentRow: Row | null = null;
/** Every payload handed to `.set()`, i.e. what actually reaches the database. */
let writes: Row[] = [];

function vitalsRow(overrides: Row = {}): Row {
  return {
    characterId: CHARACTER_ID,
    currentHitPoints: 11,
    maxHitPoints: 11,
    temporaryHitPoints: 0,
    isConscious: true,
    deathSavesSuccesses: 0,
    deathSavesFailures: 0,
    vitalState: 'standing',
    diedAt: null,
    ...overrides,
  };
}

/**
 * A transaction handle thin enough to be obvious and complete enough for the service's
 * two statements: the ownership-scoped SELECT ... FOR UPDATE, and the UPDATE.
 *
 * `returning()` echoes the written values back, so every assertion below is against what
 * the service decided to store — not against a value this mock invented.
 */
function makeTx() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const select: any = {
    from: () => select,
    where: () => select,
    limit: () => select,
    for: () => select,
    then: (resolve: (rows: Row[]) => unknown) => resolve(currentRow ? [currentRow] : []),
  };

  return {
    select: () => select,
    update: () => ({
      set: (values: Row) => {
        writes.push(values);
        return {
          where: () => ({
            returning: () => Promise.resolve([{ ...currentRow, ...values }]),
          }),
        };
      },
    }),
  };
}

const transaction = mock(async (callback: (tx: unknown) => Promise<unknown>) =>
  callback(makeTx()),
);

mock.module('../../../../db/client', () => ({
  db: { transaction },
}));

const { CharacterVitalsService } = await import('../character-vitals-service.js');

describe('CharacterVitalsService', () => {
  beforeEach(() => {
    currentRow = vitalsRow();
    writes = [];
    transaction.mockClear();
  });

  describe('applyDamage', () => {
    /**
     * The walking-corpse regression (#1826).
     *
     * A level 1 monk with 11 HP jumped into a bottomless chasm, failed both checks, was
     * told his skin was being flayed and that he was "down" — and finished the scene at
     * 11/11 with play continuing normally. Damage that exceeds a character's hit points
     * must put them at 0 and take them out of the fight. Not back at full. Not held at 1
     * so the story can continue.
     */
    it('drops an 11 HP character to 0, unconscious and dying, on 15 damage', async () => {
      const vitals = await CharacterVitalsService.applyDamage(CHARACTER_ID, OWNER_ID, 15);

      expect(vitals.currentHitPoints).toBe(0);
      expect(vitals.currentHitPoints).not.toBe(11);
      expect(vitals.currentHitPoints).not.toBe(1);
      expect(vitals.isConscious).toBe(false);
      expect(vitals.vitalState).toBe('dying');

      // And the same thing reached the database, not just the return value.
      expect(writes).toHaveLength(1);
      expect(writes[0]).toMatchObject({
        currentHitPoints: 0,
        isConscious: false,
        vitalState: 'dying',
      });
    });

    it('drains temporary hit points before real hit points', async () => {
      currentRow = vitalsRow({ temporaryHitPoints: 4 });

      const vitals = await CharacterVitalsService.applyDamage(CHARACTER_ID, OWNER_ID, 6);

      expect(vitals.temporaryHitPoints).toBe(0);
      expect(vitals.currentHitPoints).toBe(9);
      expect(vitals.isConscious).toBe(true);
      expect(vitals.vitalState).toBe('standing');
    });

    it('leaves an already dying character at 0 and dying, with death saves untouched', async () => {
      currentRow = vitalsRow({
        currentHitPoints: 0,
        isConscious: false,
        vitalState: 'dying',
        deathSavesFailures: 1,
      });

      const vitals = await CharacterVitalsService.applyDamage(CHARACTER_ID, OWNER_ID, 3);

      expect(vitals.currentHitPoints).toBe(0);
      expect(vitals.vitalState).toBe('dying');
      expect(vitals.isConscious).toBe(false);
      // Death-save progression is PR3. PR1 must not quietly start counting.
      expect(vitals.deathSavesFailures).toBe(1);
      expect(writes[0]).toMatchObject({ deathSavesFailures: 1 });
    });

    it('rejects a character the caller does not own and writes nothing', async () => {
      currentRow = null;

      await expect(
        CharacterVitalsService.applyDamage(CHARACTER_ID, 'someone-else', 5),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(writes).toHaveLength(0);
    });
  });

  describe('heal', () => {
    it('revives a dying character to standing and clears their death saves', async () => {
      currentRow = vitalsRow({
        currentHitPoints: 0,
        isConscious: false,
        vitalState: 'dying',
        deathSavesSuccesses: 1,
        deathSavesFailures: 2,
      });

      const vitals = await CharacterVitalsService.heal(CHARACTER_ID, OWNER_ID, 5);

      expect(vitals.currentHitPoints).toBe(5);
      expect(vitals.isConscious).toBe(true);
      expect(vitals.vitalState).toBe('standing');
      expect(vitals.deathSavesSuccesses).toBe(0);
      expect(vitals.deathSavesFailures).toBe(0);
    });

    it('does not heal past maximum hit points', async () => {
      currentRow = vitalsRow({ currentHitPoints: 9 });

      const vitals = await CharacterVitalsService.heal(CHARACTER_ID, OWNER_ID, 20);

      expect(vitals.currentHitPoints).toBe(11);
    });

    it('rejects a character the caller does not own', async () => {
      currentRow = null;

      await expect(
        CharacterVitalsService.heal(CHARACTER_ID, 'someone-else', 5),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(writes).toHaveLength(0);
    });
  });

  describe('getVitals', () => {
    it('returns the character-scoped vitals for an owner', async () => {
      currentRow = vitalsRow({ currentHitPoints: 3, vitalState: 'standing' });

      const vitals = await CharacterVitalsService.getVitals(CHARACTER_ID, OWNER_ID);

      expect(vitals).toMatchObject({
        characterId: CHARACTER_ID,
        currentHitPoints: 3,
        maxHitPoints: 11,
        isConscious: true,
        vitalState: 'standing',
      });
      expect(writes).toHaveLength(0);
    });

    it('rejects a character the caller does not own', async () => {
      currentRow = null;

      await expect(
        CharacterVitalsService.getVitals(CHARACTER_ID, 'someone-else'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
