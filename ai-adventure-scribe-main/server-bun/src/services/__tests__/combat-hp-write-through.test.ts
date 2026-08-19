/**
 * Combat damage has to reach the character sheet.
 *
 * `combat_participant_status` is seeded from `character_stats` when a fight starts and then
 * absorbs every hit, heal and death save until the encounter ends -- at which point
 * `concludeEncounter` throws the row away without ever syncing it back. A level 1 monk could be
 * beaten to 1 HP, win the fight, and walk out of it at 11/11, because the only row that ever
 * knew about the damage was the one that just got deleted (#1826).
 *
 * PR2 makes the participant row a write-through cache: every combat write path that touches a
 * participant with a `character_id` writes `character_stats` first, inside one transaction, and
 * mirrors the result onto the participant row second. These tests pin both halves of that -- and
 * that a monster, which has no character record, is still written exactly the way it always was.
 *
 * The database is mocked here, so what is under test is the composition: which rows are written,
 * in what order, and whether they share a transaction. The `mock.module` transaction stages its
 * writes and only "commits" them if the callback returns, which is what lets the last test assert
 * that a failed mirror takes the character write down with it.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { getTableName } from 'drizzle-orm';

type Row = Record<string, unknown>;

const PARTICIPANT_ID = 'participant-1';
const ENCOUNTER_ID = 'encounter-1';
const CHARACTER_ID = 'character-1';
const USER_ID = 'user-1';

/** One row write: which table it landed in, and the values handed to `.set()`. */
interface Write {
  table: string;
  values: Row;
}

/** The `character_stats` row the mocked SELECT returns, or null for "no stats row". */
let characterRow: Row | null = null;
let context: { participant: Row; status: Row; currentRound: number };
/** Writes that reached the database: either untransacted, or inside a transaction that committed. */
let committed: Write[] = [];
/** Writes that were staged inside a transaction which then threw. */
let rolledBack: Write[] = [];
/** Makes the participant-status UPDATE fail, the way a constraint violation would. */
let breakParticipantWrite = false;

function characterStatsRow(overrides: Row = {}): Row {
  return {
    characterId: CHARACTER_ID,
    currentHitPoints: 20,
    maxHitPoints: 20,
    temporaryHitPoints: 0,
    isConscious: true,
    deathSavesSuccesses: 0,
    deathSavesFailures: 0,
    vitalState: 'standing',
    diedAt: null,
    ...overrides,
  };
}

function participantRow(overrides: Row = {}): Row {
  return {
    id: PARTICIPANT_ID,
    encounterId: ENCOUNTER_ID,
    characterId: CHARACTER_ID,
    name: 'Claude',
    participantType: 'player',
    maxHp: 20,
    damageImmunities: [],
    damageResistances: [],
    damageVulnerabilities: [],
    ...overrides,
  };
}

function statusRow(overrides: Row = {}): Row {
  return {
    participantId: PARTICIPANT_ID,
    currentHp: 20,
    maxHp: 20,
    tempHp: 0,
    isConscious: true,
    deathSavesSuccesses: 0,
    deathSavesFailures: 0,
    ...overrides,
  };
}

/**
 * A statement builder thin enough to be obvious and complete enough for the two statements the
 * write-through issues: the vitals SELECT ... FOR UPDATE, and the two UPDATEs.
 *
 * `record` is what separates the pooled path from the transactional one: the pool records
 * straight into `committed`, a transaction records into its own staging list first.
 */
function makeWriter(record: (write: Write) => void) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const select: any = {
    from: () => select,
    innerJoin: () => select,
    leftJoin: () => select,
    where: () => select,
    limit: () => select,
    for: () => select,
    then: (resolve: (rows: Row[]) => unknown) => resolve(characterRow ? [characterRow] : []),
  };

  return {
    select: () => select,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update: (table: any) => ({
      set: (values: Row) => ({
        where: () => ({
          returning: async (): Promise<Row[]> => {
            const table_ = getTableName(table);
            if (table_ === 'combat_participant_status' && breakParticipantWrite) {
              throw new Error('participant status write rejected');
            }
            record({ table: table_, values });
            return table_ === 'character_stats'
              ? [{ ...characterRow, ...values }]
              : [{ participantId: PARTICIPANT_ID, ...values }];
          },
        }),
      }),
    }),
  };
}

const transaction = mock(async (callback: (tx: unknown) => Promise<unknown>) => {
  const staged: Write[] = [];
  try {
    const result = await callback(makeWriter((write) => staged.push(write)));
    committed.push(...staged);
    return result;
  } catch (error) {
    rolledBack.push(...staged);
    throw error;
  }
});

mock.module('../../../../db/client', () => ({
  db: {
    ...makeWriter((write) => committed.push(write)),
    insert: () => ({ values: async () => [] }),
    transaction,
  },
}));

mock.module('../combat/hp-data-access.js', () => ({
  getParticipantWithFullContext: async () => context,
  getParticipantStatusScoped: async () => null,
  getParticipantStatus: async () => null,
  getDamageLog: async () => [],
  initializeParticipantStatus: async () => ({}),
}));

const { CombatHPService } = await import('../combat-hp-service.js');

/** Rolls a chosen d20 face for the death-save path, then puts `Math.random` back. */
async function withD20<T>(face: number, run: () => Promise<T>): Promise<T> {
  const random = Math.random;
  Math.random = () => (face - 1) / 20;
  try {
    return await run();
  } finally {
    Math.random = random;
  }
}

describe('combat HP write-through to the character record', () => {
  beforeEach(() => {
    characterRow = characterStatsRow();
    context = { participant: participantRow(), status: statusRow(), currentRound: 1 };
    committed = [];
    rolledBack = [];
    breakParticipantWrite = false;
    transaction.mockClear();
  });

  const wrote = (table: string): Row | undefined =>
    committed.find((write) => write.table === table)?.values;

  describe('a player participant', () => {
    it('writes damage to character_stats and combat_participant_status in one transaction', async () => {
      const result = await CombatHPService.applyDamage(
        PARTICIPANT_ID,
        ENCOUNTER_ID,
        { damageAmount: 6, damageType: 'bludgeoning' },
        USER_ID,
      );

      expect(result.newCurrentHp).toBe(14);
      expect(transaction).toHaveBeenCalledTimes(1);

      // The character record first, as the source of truth; the participant row second, as its
      // mirror. Both, in that order, or the write-through is not one.
      expect(committed.map((write) => write.table)).toEqual([
        'character_stats',
        'combat_participant_status',
      ]);
      expect(wrote('character_stats')).toMatchObject({
        currentHitPoints: 14,
        isConscious: true,
        vitalState: 'standing',
      });
      expect(wrote('combat_participant_status')).toMatchObject({ currentHp: 14 });
    });

    it('records going down on both rows, not just the participant', async () => {
      characterRow = characterStatsRow({ currentHitPoints: 6 });
      context.status = statusRow({ currentHp: 6 });

      await CombatHPService.applyDamage(
        PARTICIPANT_ID,
        ENCOUNTER_ID,
        { damageAmount: 8, damageType: 'slashing' },
        USER_ID,
      );

      expect(wrote('character_stats')).toMatchObject({
        currentHitPoints: 0,
        isConscious: false,
        vitalState: 'dying',
      });
      expect(wrote('combat_participant_status')).toMatchObject({
        currentHp: 0,
        isConscious: false,
      });
    });

    it('writes healing to both rows and stands the character back up', async () => {
      characterRow = characterStatsRow({
        currentHitPoints: 0,
        isConscious: false,
        vitalState: 'dying',
        deathSavesFailures: 2,
      });
      context.status = statusRow({ currentHp: 0, isConscious: false, deathSavesFailures: 2 });

      const result = await CombatHPService.healDamage(
        PARTICIPANT_ID,
        ENCOUNTER_ID,
        5,
        'cure wounds',
        USER_ID,
      );

      expect(result.newCurrentHp).toBe(5);
      expect(wrote('character_stats')).toMatchObject({
        currentHitPoints: 5,
        isConscious: true,
        vitalState: 'standing',
        deathSavesFailures: 0,
      });
      expect(wrote('combat_participant_status')).toMatchObject({
        currentHp: 5,
        isConscious: true,
        deathSavesFailures: 0,
      });
    });

    it('mirrors a failed death save onto the character record', async () => {
      characterRow = characterStatsRow({
        currentHitPoints: 0,
        isConscious: false,
        vitalState: 'dying',
      });
      context.status = statusRow({ currentHp: 0, isConscious: false });

      const result = await withD20(3, () =>
        CombatHPService.rollDeathSave(PARTICIPANT_ID, ENCOUNTER_ID, USER_ID),
      );

      // The progression rules are combat's, unchanged: a 3 is one failure.
      expect(result.failures).toBe(1);
      expect(wrote('character_stats')).toMatchObject({
        deathSavesFailures: 1,
        isConscious: false,
        vitalState: 'dying',
      });
      expect(wrote('combat_participant_status')).toMatchObject({
        deathSavesFailures: 1,
        isConscious: false,
      });
    });

    it('mirrors a natural 20 back to conscious on both rows', async () => {
      characterRow = characterStatsRow({
        currentHitPoints: 0,
        isConscious: false,
        vitalState: 'dying',
      });
      context.status = statusRow({ currentHp: 0, isConscious: false });

      const result = await withD20(20, () =>
        CombatHPService.rollDeathSave(PARTICIPANT_ID, ENCOUNTER_ID, USER_ID),
      );

      expect(result.wasRevived).toBe(true);
      expect(wrote('character_stats')).toMatchObject({
        currentHitPoints: 1,
        isConscious: true,
        vitalState: 'standing',
      });
      expect(wrote('combat_participant_status')).toMatchObject({
        currentHp: 1,
        isConscious: true,
      });
    });

    it('names the stabilized state on the character record, which the counters cannot', async () => {
      characterRow = characterStatsRow({
        currentHitPoints: 0,
        isConscious: false,
        vitalState: 'dying',
        deathSavesFailures: 2,
      });
      context.status = statusRow({ currentHp: 0, isConscious: false, deathSavesFailures: 2 });

      const result = await CombatHPService.stabilizeWithMedicine(
        PARTICIPANT_ID,
        ENCOUNTER_ID,
        12,
        2,
        USER_ID,
      );

      expect(result.success).toBe(true);
      expect(wrote('character_stats')).toMatchObject({
        currentHitPoints: 0,
        isConscious: false,
        vitalState: 'stabilized',
        deathSavesFailures: 0,
      });
      expect(wrote('combat_participant_status')).toMatchObject({ deathSavesFailures: 0 });
    });
  });

  describe('an NPC participant', () => {
    beforeEach(() => {
      context.participant = participantRow({
        characterId: null,
        participantType: 'npc',
        name: 'Shadow Roach 2',
      });
    });

    it('writes participant status only, and never opens a transaction', async () => {
      await CombatHPService.applyDamage(
        PARTICIPANT_ID,
        ENCOUNTER_ID,
        { damageAmount: 6, damageType: 'piercing' },
        USER_ID,
      );

      expect(committed.map((write) => write.table)).toEqual(['combat_participant_status']);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('never touches character_stats when healed either', async () => {
      context.status = statusRow({ currentHp: 4 });

      await CombatHPService.healDamage(PARTICIPANT_ID, ENCOUNTER_ID, 5, 'potion', USER_ID);

      expect(committed.map((write) => write.table)).toEqual(['combat_participant_status']);
    });
  });

  describe('atomicity', () => {
    it('rolls the character write back when the participant mirror fails', async () => {
      breakParticipantWrite = true;

      await expect(
        CombatHPService.applyDamage(
          PARTICIPANT_ID,
          ENCOUNTER_ID,
          { damageAmount: 6, damageType: 'fire' },
          USER_ID,
        ),
      ).rejects.toThrow('participant status write rejected');

      // Nothing committed: a character sheet that had taken damage the encounter did not is the
      // mirror bug again, pointing the other way.
      expect(committed).toEqual([]);
      expect(rolledBack.map((write) => write.table)).toEqual(['character_stats']);
    });

    it('leaves both rows alone when the character has no stats row to mirror into', async () => {
      characterRow = null;

      const result = await CombatHPService.applyDamage(
        PARTICIPANT_ID,
        ENCOUNTER_ID,
        { damageAmount: 6, damageType: 'cold' },
        USER_ID,
      );

      // The fight goes on against the participant row alone rather than failing an attack over a
      // data gap that predates write-through. The warning log is how it gets found.
      expect(result.newCurrentHp).toBe(14);
      expect(committed.map((write) => write.table)).toEqual(['combat_participant_status']);
    });
  });
});
