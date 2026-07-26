/* eslint-disable max-lines -- one cohesive reproduction of the run-14 incident: the
   fixture chain (campaign -> character -> session -> encounter -> participants -> status)
   is shared by every assertion, and splitting it would mean building combat twice. */
/**
 * A telemetry write must not be able to kill an attack, and a failed resolution
 * must not strand the actor.
 *
 * Run 14 of the agent playtest died on turn 4 like this:
 *
 *   POST /v1/combat/<id>/intent -> 500  "Failed to apply damage to HP"
 *   Insert select error: selected fields are not the same or are in a different
 *   order compared to the table definition
 *
 * The damage *log* write -- pure history, no gameplay meaning -- was issued via
 * Promise.all alongside the HP update. It threw on every call, the rejection
 * propagated out of applyDamage, and resolveAttack reported the attack as failed.
 * Because resolveAttack claims the actor's action *before* applying damage, and
 * `action_used` is cleared only by `resetTurnResources` (reachable only from
 * `advanceTurn`, reachable only from an `end_turn` intent), the actor was stuck
 * permanently: action spent, turn never advanced, every retry answered "Action
 * already used this turn". Confirmed in production as
 * `The Seeker action_used=t turn_order=1 current_turn_order=1 round=2`.
 *
 * The log failure here is injected at the database -- a CHECK constraint that
 * cannot be satisfied -- so the INSERT fails for real. Mocking `db` would not
 * have caught the original bug and would not test the fix either.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL -- see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, beforeEach, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';

import { closeRealDb, describeWithDb, hasRealDb, realDb, testId } from './fixtures/real-db.js';
import {
  campaigns,
  characters,
  combatDamageLog,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
} from '../../../../db/schema/index';

if (!hasRealDb) {
  console.warn(
    '[combat-damage-log-resilience] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

describeWithDb('a damage-log failure cannot fail an attack', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('user');

  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let attackerId: string;
  let targetId: string;

  const MAX_HP = 30;

  beforeAll(async () => {
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('camp') })
      .returning({ id: campaigns.id });

    [{ id: characterId }] = await db
      .insert(characters)
      .values({ userId, name: testId('hero'), level: 3 })
      .returning({ id: characters.id });

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

    attackerId = inserted[0].id;
    targetId = inserted[1].id;

    await db.insert(combatParticipantStatus).values(
      inserted.map((participant) => ({
        participantId: participant.id,
        currentHp: MAX_HP,
        maxHp: MAX_HP,
        isConscious: true,
      })),
    );
  });

  beforeEach(async () => {
    if (!hasRealDb) return;
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: MAX_HP, tempHp: 0, isConscious: true, deathSavesFailures: 0 })
      .where(eq(combatParticipantStatus.participantId, targetId));
    await db
      .update(combatParticipants)
      .set({ actionUsed: false })
      .where(eq(combatParticipants.encounterId, encounterId));
    await db.delete(combatDamageLog).where(eq(combatDamageLog.encounterId, encounterId));
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
      db.execute(sql`ALTER TABLE combat_damage_log DROP CONSTRAINT IF EXISTS test_force_failure`),
    );
    if (encounterId) {
      await drop(() =>
        db.delete(combatDamageLog).where(eq(combatDamageLog.encounterId, encounterId)),
      );
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
    if (characterId) await drop(() => db.delete(characters).where(eq(characters.id, characterId)));
    if (campaignId) await drop(() => db.delete(campaigns).where(eq(campaigns.id, campaignId)));
    await closeRealDb();
  });

  /** Makes every INSERT into combat_damage_log fail, at the database. */
  const breakDamageLog = async (): Promise<void> => {
    await db.execute(
      sql`ALTER TABLE combat_damage_log ADD CONSTRAINT test_force_failure CHECK (false) NOT VALID`,
    );
  };

  const repairDamageLog = async (): Promise<void> => {
    await db.execute(
      sql`ALTER TABLE combat_damage_log DROP CONSTRAINT IF EXISTS test_force_failure`,
    );
  };

  const currentHp = async (participantId: string): Promise<number> => {
    const [row] = await db
      .select({ hp: combatParticipantStatus.currentHp })
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, participantId));
    return row.hp;
  };

  it('sanity: the injected failure really does break the log insert', async () => {
    await breakDamageLog();
    let rejected = false;
    try {
      // Awaited inside try/catch rather than via expect().rejects: Drizzle's query
      // builder is a thenable, not a Promise, and bun's rejects matcher inspects it
      // as a plain object instead of running it.
      await db.insert(combatDamageLog).values({
        encounterId,
        participantId: targetId,
        damageAmount: 1,
        damageType: 'slashing',
        roundNumber: 1,
      });
    } catch {
      rejected = true;
    } finally {
      await repairDamageLog();
    }
    expect(rejected).toBe(true);
  });

  it('applies damage and resolves normally when the damage log write fails', async () => {
    const { CombatHPService } = await import('../combat-hp-service.js');

    await breakDamageLog();
    try {
      const result = await CombatHPService.applyDamage(
        targetId,
        encounterId,
        { damageAmount: 7, damageType: 'slashing', sourceDescription: 'longsword' },
        userId,
      );

      // The attack resolves. This is the whole point: before the fix this threw,
      // and resolveAttack turned it into "Attack succeeded but damage application
      // failed" plus an action_refused event.
      expect(result.modifiedDamage).toBe(7);
      expect(result.newCurrentHp).toBe(MAX_HP - 7);
    } finally {
      await repairDamageLog();
    }

    // HP applied exactly once -- not zero times, not twice.
    expect(await currentHp(targetId)).toBe(MAX_HP - 7);

    // And the log row is genuinely absent: the write was lost, which is the
    // acceptable outcome for telemetry.
    const logged = await db
      .select()
      .from(combatDamageLog)
      .where(eq(combatDamageLog.encounterId, encounterId));
    expect(logged).toHaveLength(0);
  });

  it('writes the damage log when nothing is wrong', async () => {
    const { CombatHPService } = await import('../combat-hp-service.js');

    await CombatHPService.applyDamage(
      targetId,
      encounterId,
      { damageAmount: 4, damageType: 'piercing', sourceParticipantId: attackerId },
      userId,
    );

    const logged = await db
      .select()
      .from(combatDamageLog)
      .where(eq(combatDamageLog.encounterId, encounterId));

    // The converted write has to actually work, not merely fail quietly. Before the
    // conversion this table had never received a row.
    expect(logged).toHaveLength(1);
    expect(logged[0].damageAmount).toBe(4);
    expect(logged[0].sourceParticipantId).toBe(attackerId);
    expect(logged[0].roundNumber).toBe(1);
  });

  it('releases the action claim when resolution throws, so the turn can still advance', async () => {
    const { claimTurnActionAndResolve } = await import('../combat/combat-turn-resources.js');

    const actionUsed = async (): Promise<boolean> => {
      const [row] = await db
        .select({ used: combatParticipants.actionUsed })
        .from(combatParticipants)
        .where(eq(combatParticipants.id, attackerId));
      return row.used;
    };

    const [{ version }] = await db
      .select({ version: combatEncounters.version })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));

    await expect(
      claimTurnActionAndResolve(attackerId, encounterId, version, async () => {
        // The claim has really been taken at this point -- that is what made the
        // production failure permanent.
        expect(await actionUsed()).toBe(true);
        throw new Error('damage application blew up mid-resolution');
      }),
    ).rejects.toThrow('damage application blew up mid-resolution');

    // Released. Without this the actor is stuck for the rest of the encounter:
    // nothing but advanceTurn clears action_used, and advanceTurn is only reached
    // from an end_turn intent the stranded actor can no longer submit.
    expect(await actionUsed()).toBe(false);
  });

  it('leaves the action claimed when resolution succeeds', async () => {
    const { claimTurnActionAndResolve } = await import('../combat/combat-turn-resources.js');

    const [{ version }] = await db
      .select({ version: combatEncounters.version })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));

    const result = await claimTurnActionAndResolve(
      attackerId,
      encounterId,
      version,
      async () => 'ok',
    );
    expect(result).toBe('ok');

    const [row] = await db
      .select({ used: combatParticipants.actionUsed })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, attackerId));

    // The release is compensating, not unconditional: a successful action still
    // costs the actor their action.
    expect(row.used).toBe(true);
  });

  it('claims the action exactly once across a failed then retried resolution', async () => {
    const { claimTurnActionAndResolve } = await import('../combat/combat-turn-resources.js');

    const version = async (): Promise<number> => {
      const [row] = await db
        .select({ v: combatEncounters.version })
        .from(combatEncounters)
        .where(eq(combatEncounters.id, encounterId));
      return row.v;
    };

    await expect(
      claimTurnActionAndResolve(attackerId, encounterId, await version(), async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // The retry succeeds against the refreshed version. The encounter version is
    // deliberately NOT rolled back -- it is a monotonic optimistic-concurrency
    // token, and decrementing it would let a stale expectedVersion start matching
    // again. A client that just got an error refetches state anyway.
    const retried = await claimTurnActionAndResolve(
      attackerId,
      encounterId,
      await version(),
      async () => 'second attempt',
    );

    expect(retried).toBe('second attempt');
  });
});
