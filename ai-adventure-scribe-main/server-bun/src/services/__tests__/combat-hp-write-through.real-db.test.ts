/**
 * The write-through, against a real Postgres.
 *
 * The mocked companion suite (`combat-hp-write-through.test.ts`) pins the composition: which
 * rows are written, in what order, inside which transaction. It cannot pin the thing that
 * actually broke in production, because a mocked `db` never runs the statement -- see
 * fixtures/real-db.ts for the eleven weeks that argument cost. So this suite drives
 * `CombatHPService` against real tables and then reads `character_stats` back with its own
 * query: after in-combat damage, the character sheet has to have moved.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL -- see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, beforeEach, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';

import { closeRealDb, describeWithDb, hasRealDb, realDb, testId } from './fixtures/real-db.js';
import {
  campaigns,
  characterStats,
  characters,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
} from '../../../../db/schema/index';

if (!hasRealDb) {
  console.warn(
    '[combat-hp-write-through] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

describeWithDb('combat damage reaches the character record', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('user');

  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let heroId: string;
  let goblinId: string;

  const MAX_HP = 20;

  beforeAll(async () => {
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('camp') })
      .returning({ id: campaigns.id });

    [{ id: characterId }] = await db
      .insert(characters)
      .values({ userId, name: testId('hero'), level: 3 })
      .returning({ id: characters.id });

    await db.insert(characterStats).values({
      characterId,
      maxHitPoints: MAX_HP,
      currentHitPoints: MAX_HP,
      temporaryHitPoints: 0,
    });

    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });

    [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });

    const inserted = await db
      .insert(combatParticipants)
      .values([
        {
          encounterId,
          characterId,
          name: 'The Seeker',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          maxHp: MAX_HP,
        },
        {
          encounterId,
          name: 'Goblin',
          participantType: 'npc',
          turnOrder: 1,
          initiative: 5,
          maxHp: MAX_HP,
        },
      ])
      .returning({ id: combatParticipants.id });

    heroId = inserted[0].id;
    goblinId = inserted[1].id;

    await db.insert(combatParticipantStatus).values(
      inserted.map((participant) => ({
        participantId: participant.id,
        currentHp: MAX_HP,
        maxHp: MAX_HP,
        isConscious: true,
      })),
    );
  });

  /** Both rows back to full health, so each test starts from the state combat seeding produces. */
  beforeEach(async () => {
    if (!hasRealDb) return;
    await db
      .update(combatParticipantStatus)
      .set({
        currentHp: MAX_HP,
        tempHp: 0,
        isConscious: true,
        deathSavesSuccesses: 0,
        deathSavesFailures: 0,
      })
      .where(eq(combatParticipantStatus.participantId, heroId));
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: MAX_HP, tempHp: 0, isConscious: true })
      .where(eq(combatParticipantStatus.participantId, goblinId));
    await db
      .update(characterStats)
      .set({
        currentHitPoints: MAX_HP,
        temporaryHitPoints: 0,
        isConscious: true,
        vitalState: 'standing',
        deathSavesSuccesses: 0,
        deathSavesFailures: 0,
        diedAt: null,
      })
      .where(eq(characterStats.characterId, characterId));
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    const drop = async (run: () => Promise<unknown>) => {
      try {
        await run();
      } catch {
        /* fixture teardown is best-effort */
      }
    };
    await drop(() =>
      db.execute(
        sql`ALTER TABLE combat_participant_status DROP CONSTRAINT IF EXISTS test_force_failure`,
      ),
    );
    if (encounterId) {
      await drop(() =>
        db.execute(
          sql`DELETE FROM combat_participant_status WHERE participant_id IN
              (SELECT id FROM combat_participants WHERE encounter_id = ${encounterId})`,
        ),
      );
      await drop(() =>
        db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId)),
      );
      await drop(() => db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId)));
    }
    if (sessionId) await drop(() => db.delete(gameSessions).where(eq(gameSessions.id, sessionId)));
    // character_stats goes with the character, on cascade.
    if (characterId) await drop(() => db.delete(characters).where(eq(characters.id, characterId)));
    if (campaignId) await drop(() => db.delete(campaigns).where(eq(campaigns.id, campaignId)));
    await closeRealDb();
  });

  const sheet = async () => {
    const [row] = await db
      .select({
        currentHitPoints: characterStats.currentHitPoints,
        isConscious: characterStats.isConscious,
        vitalState: characterStats.vitalState,
        deathSavesFailures: characterStats.deathSavesFailures,
      })
      .from(characterStats)
      .where(eq(characterStats.characterId, characterId));
    return row;
  };

  const participant = async (participantId: string) => {
    const [row] = await db
      .select({
        currentHp: combatParticipantStatus.currentHp,
        isConscious: combatParticipantStatus.isConscious,
        deathSavesFailures: combatParticipantStatus.deathSavesFailures,
      })
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, participantId));
    return row;
  };

  it('moves the character sheet and the participant row in the same request', async () => {
    const { CombatHPService } = await import('../combat-hp-service.js');

    await CombatHPService.applyDamage(
      heroId,
      encounterId,
      { damageAmount: 6, damageType: 'slashing', sourceDescription: 'longsword' },
      userId,
    );

    // This is the whole issue: before write-through the first of these was 20/20 forever,
    // because nothing ever copied combat's damage back onto the sheet.
    expect((await sheet()).currentHitPoints).toBe(MAX_HP - 6);
    expect((await participant(heroId)).currentHp).toBe(MAX_HP - 6);
  });

  it('records going down and coming back up on both rows', async () => {
    const { CombatHPService } = await import('../combat-hp-service.js');

    await CombatHPService.applyDamage(
      heroId,
      encounterId,
      { damageAmount: 10, damageType: 'bludgeoning' },
      userId,
    );
    await CombatHPService.applyDamage(
      heroId,
      encounterId,
      { damageAmount: 10, damageType: 'bludgeoning' },
      userId,
    );

    expect(await sheet()).toMatchObject({
      currentHitPoints: 0,
      isConscious: false,
      vitalState: 'dying',
    });
    expect(await participant(heroId)).toMatchObject({ currentHp: 0, isConscious: false });

    await CombatHPService.healDamage(heroId, encounterId, 7, 'cure wounds', userId);

    expect(await sheet()).toMatchObject({
      currentHitPoints: 7,
      isConscious: true,
      vitalState: 'standing',
    });
    expect(await participant(heroId)).toMatchObject({ currentHp: 7, isConscious: true });
  });

  it('mirrors a failed death save onto the character record', async () => {
    const { CombatHPService } = await import('../combat-hp-service.js');

    await CombatHPService.applyDamage(
      heroId,
      encounterId,
      { damageAmount: 10, damageType: 'force' },
      userId,
    );
    await CombatHPService.applyDamage(
      heroId,
      encounterId,
      { damageAmount: 10, damageType: 'force' },
      userId,
    );

    const random = Math.random;
    Math.random = () => 0.1; // a 3: one failure, still dying
    try {
      const result = await CombatHPService.rollDeathSave(heroId, encounterId, userId);
      expect(result.failures).toBe(1);
    } finally {
      Math.random = random;
    }

    expect(await sheet()).toMatchObject({
      deathSavesFailures: 1,
      isConscious: false,
      vitalState: 'dying',
    });
    expect((await participant(heroId)).deathSavesFailures).toBe(1);
  });

  it('leaves the character record alone when a monster takes the hit', async () => {
    const { CombatHPService } = await import('../combat-hp-service.js');

    await CombatHPService.applyDamage(
      goblinId,
      encounterId,
      { damageAmount: 6, damageType: 'piercing' },
      userId,
    );

    expect((await participant(goblinId)).currentHp).toBe(MAX_HP - 6);
    expect((await sheet()).currentHitPoints).toBe(MAX_HP);
  });

  it('rolls the character write back when the participant mirror fails', async () => {
    const { CombatHPService } = await import('../combat-hp-service.js');

    await db.execute(
      sql`ALTER TABLE combat_participant_status ADD CONSTRAINT test_force_failure CHECK (false) NOT VALID`,
    );

    let rejected = false;
    try {
      await CombatHPService.applyDamage(
        heroId,
        encounterId,
        { damageAmount: 6, damageType: 'fire' },
        userId,
      );
    } catch {
      rejected = true;
    } finally {
      await db.execute(
        sql`ALTER TABLE combat_participant_status DROP CONSTRAINT IF EXISTS test_force_failure`,
      );
    }

    expect(rejected).toBe(true);
    // Neither row moved. A sheet carrying damage the encounter never recorded is the same
    // divergence this PR exists to remove, pointing the other way.
    expect((await sheet()).currentHitPoints).toBe(MAX_HP);
    expect((await participant(heroId)).currentHp).toBe(MAX_HP);
  });
});
