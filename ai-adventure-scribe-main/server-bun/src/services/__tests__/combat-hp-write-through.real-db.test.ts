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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';

import { closeRealDb, describeWithDb, hasRealDb, realDb, testId } from './fixtures/real-db.js';
import {
  campaigns,
  characterStats,
  characters,
  characterFeatures,
  classFeaturesLibrary,
  combatDamageLog,
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
    // Every applyDamage writes a combat_damage_log row, and the suite shares one encounter:
    // without this, earlier tests' rows accumulate and pollute per-test aggregations (#570).
    await db.delete(combatDamageLog).where(eq(combatDamageLog.encounterId, encounterId));
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
    await db.update(characters).set({ race: null }).where(eq(characters.id, characterId));
    await db.delete(characterFeatures).where(eq(characterFeatures.characterId, characterId));
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

  const encounterUpdatedAt = async () => {
    const [row] = await db
      .select({ updatedAt: combatEncounters.updatedAt })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    return row.updatedAt;
  };

  const backdateEncounter = async () => {
    const baseline = new Date(Date.now() - 60_000);
    await db
      .update(combatEncounters)
      .set({ updatedAt: baseline })
      .where(eq(combatEncounters.id, encounterId));
    return baseline;
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

  it('moves the encounter clock when damage is applied', async () => {
    const { CombatHPService } = await import('../combat-hp-service.js');
    const baseline = await backdateEncounter();

    await CombatHPService.applyDamage(
      heroId,
      encounterId,
      { damageAmount: 6, damageType: 'slashing' },
      userId,
    );

    expect((await encounterUpdatedAt()).getTime()).toBeGreaterThan(baseline.getTime());
  });

  it('moves the encounter clock when healing is applied', async () => {
    const { CombatHPService } = await import('../combat-hp-service.js');
    await CombatHPService.applyDamage(
      heroId,
      encounterId,
      { damageAmount: 6, damageType: 'slashing' },
      userId,
    );
    const baseline = await backdateEncounter();

    await CombatHPService.healDamage(heroId, encounterId, 3, 'cure wounds', userId);

    expect((await encounterUpdatedAt()).getTime()).toBeGreaterThan(baseline.getTime());
  });

  it('does not move the encounter clock for zero damage', async () => {
    const { CombatHPService } = await import('../combat-hp-service.js');
    const baseline = await backdateEncounter();

    await CombatHPService.applyDamage(
      heroId,
      encounterId,
      { damageAmount: 0, damageType: 'slashing' },
      userId,
    );

    expect((await encounterUpdatedAt()).getTime()).toBe(baseline.getTime());
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

  it('aggregates per-participant damage for the combat summary (#570)', async () => {
    const { CombatHPService } = await import('../combat-hp-service.js');
    const { getCombatDamageSummary } = await import('../combat/combat-damage-summary.js');

    // The hero hits the goblin for 7 fire; the goblin hits the hero for 3 piercing.
    // Both write combat_damage_log rows carrying their source participant.
    await CombatHPService.applyDamage(
      goblinId,
      encounterId,
      {
        damageAmount: 7,
        damageType: 'fire',
        sourceParticipantId: heroId,
        sourceDescription: 'fire bolt',
      },
      userId,
    );
    await CombatHPService.applyDamage(
      heroId,
      encounterId,
      {
        damageAmount: 3,
        damageType: 'piercing',
        sourceParticipantId: goblinId,
        sourceDescription: 'scimitar',
      },
      userId,
    );

    const summary = await getCombatDamageSummary(encounterId, userId);

    expect(summary.encounterId).toBe(encounterId);
    expect(summary.rounds).toBe(1);
    expect(summary.totalDamage).toBe(7);
    expect(summary.totalDamage).not.toBe(10);
    expect(summary.participants).toHaveLength(2);
    expect(summary.participants.find((p) => p.participantId === heroId)).toMatchObject({
      name: 'The Seeker',
      damageDealt: 7,
      damageTaken: 3,
      status: 'ok',
    });
    expect(summary.participants.find((p) => p.participantId === goblinId)).toMatchObject({
      name: 'Goblin',
      damageDealt: 3,
      damageTaken: 7,
      status: 'ok',
    });
  });

  // #1635: Half-Orc Relentless Endurance. The class_features_library row comes from migration
  // db/migrations/20261122_seed_relentless_endurance.sql (replayed into this database); the
  // character_features row is created by the engine on first use. Producers: the production
  // CombatHPService.applyDamage, CharacterVitalsService.applyDamage, applyNonAttackDamage,
  // combatAttackService.resolveAttack and ClassFeatureUsageService.restoreFeatures. The fight
  // rows are the suite's own fixtures above. Nothing here reaches the DM.
  describe('Half-Orc Relentless Endurance (#1635)', () => {
    const LINE = 'The Seeker stays on their feet with 1 HP (Relentless Endurance).';

    const becomeHalfOrc = () =>
      db.update(characters).set({ race: 'Half-Orc' }).where(eq(characters.id, characterId));

    const usesRemaining = async (): Promise<number | null | undefined> => {
      const rows = await db
        .select({ usesRemaining: characterFeatures.usesRemaining })
        .from(characterFeatures)
        .innerJoin(classFeaturesLibrary, eq(characterFeatures.featureId, classFeaturesLibrary.id))
        .where(
          and(
            eq(characterFeatures.characterId, characterId),
            eq(classFeaturesLibrary.className, 'Half-Orc'),
            eq(classFeaturesLibrary.featureName, 'Relentless Endurance'),
          ),
        );
      expect(rows.length).toBeLessThanOrEqual(1);
      return rows[0]?.usesRemaining;
    };

    const hit = async (amount: number) => {
      const { CombatHPService } = await import('../combat-hp-service.js');
      return CombatHPService.applyDamage(
        heroId,
        encounterId,
        {
          damageAmount: amount,
          damageType: 'slashing',
          sourceDescription: 'a falling rock',
          uncapped: true,
        },
        userId,
      );
    };

    const backToFull = async () => {
      await db
        .update(combatParticipantStatus)
        .set({
          currentHp: MAX_HP,
          isConscious: true,
          deathSavesSuccesses: 0,
          deathSavesFailures: 0,
        })
        .where(eq(combatParticipantStatus.participantId, heroId));
      await db
        .update(characterStats)
        .set({
          currentHitPoints: MAX_HP,
          isConscious: true,
          vitalState: 'standing',
          deathSavesFailures: 0,
        })
        .where(eq(characterStats.characterId, characterId));
    };

    it('the seed row exists: Half-Orc, passive, long rest, one use', async () => {
      const rows = await db
        .select({
          usageType: classFeaturesLibrary.usageType,
          usesPerRest: classFeaturesLibrary.usesPerRest,
          usesCount: classFeaturesLibrary.usesCount,
        })
        .from(classFeaturesLibrary)
        .where(
          and(
            eq(classFeaturesLibrary.className, 'Half-Orc'),
            eq(classFeaturesLibrary.featureName, 'Relentless Endurance'),
          ),
        );
      expect(rows).toEqual([{ usageType: 'passive', usesPerRest: 'long_rest', usesCount: 1 }]);
    });

    it('a Half-Orc dropped to 0 stays at 1 HP, on both rows, and the use is spent', async () => {
      await becomeHalfOrc();

      const result = await hit(MAX_HP);

      expect(result.newCurrentHp).toBe(1);
      expect(result.isConscious).toBe(true);
      expect(result.relentlessEnduranceLine).toBe(LINE);
      expect(await participant(heroId)).toMatchObject({
        currentHp: 1,
        isConscious: true,
        deathSavesFailures: 0,
      });
      expect(await sheet()).toMatchObject({
        currentHitPoints: 1,
        isConscious: true,
        vitalState: 'standing',
      });
      expect(await usesRemaining()).toBe(0);
    });

    it('a second drop to 0 before a long rest goes to 0 and starts dying', async () => {
      await becomeHalfOrc();
      expect((await hit(MAX_HP)).newCurrentHp).toBe(1);
      await backToFull();

      const result = await hit(MAX_HP);

      expect(result.newCurrentHp).toBe(0);
      expect(result.isConscious).toBe(false);
      expect(result.relentlessEnduranceLine).toBeUndefined();
      expect(await sheet()).toMatchObject({ currentHitPoints: 0, vitalState: 'dying' });
      expect(await usesRemaining()).toBe(0);
    });

    it('massive damage kills a Half-Orc outright and does not touch the use', async () => {
      await becomeHalfOrc();

      // 20 HP, 40 damage: 20 left over after reaching 0, equal to the maximum (SRD instant death).
      const result = await hit(2 * MAX_HP);

      expect(result.massiveDamage).toBe(true);
      expect(result.isDead).toBe(true);
      expect(result.relentlessEnduranceLine).toBeUndefined();
      expect(await sheet()).toMatchObject({ currentHitPoints: 0, vitalState: 'dead' });
      expect(await usesRemaining()).toBeUndefined();
    });

    it('a character who is not a Half-Orc drops to 0 and gets no feature row', async () => {
      const result = await hit(MAX_HP);

      expect(result.newCurrentHp).toBe(0);
      expect(result.relentlessEnduranceLine).toBeUndefined();
      expect(await sheet()).toMatchObject({ currentHitPoints: 0, vitalState: 'dying' });
      const rows = await db
        .select({ id: characterFeatures.id })
        .from(characterFeatures)
        .where(eq(characterFeatures.characterId, characterId));
      expect(rows).toEqual([]);
    });

    it('a long rest restores the use, and the next drop is caught again', async () => {
      const { ClassFeatureUsageService } =
        await import('../progression/class-feature-usage-service.js');
      await becomeHalfOrc();
      expect((await hit(MAX_HP)).newCurrentHp).toBe(1);
      expect(await usesRemaining()).toBe(0);

      await ClassFeatureUsageService.restoreFeatures({ characterId, restType: 'long', userId });

      expect(await usesRemaining()).toBe(1);
      await backToFull();
      const result = await hit(MAX_HP);
      expect(result.newCurrentHp).toBe(1);
      expect(result.relentlessEnduranceLine).toBe(LINE);
      expect(await usesRemaining()).toBe(0);
    });

    it('the out-of-combat writer (CharacterVitalsService.applyDamage) uses the same rule', async () => {
      const { CharacterVitalsService } = await import('../character-vitals-service.js');
      await becomeHalfOrc();
      await db
        .update(characterStats)
        .set({ currentHitPoints: 5 })
        .where(eq(characterStats.characterId, characterId));
      const [{ name }] = await db
        .select({ name: characters.name })
        .from(characters)
        .where(eq(characters.id, characterId));

      const first = await CharacterVitalsService.applyDamage(characterId, userId, 5);
      expect(first).toMatchObject({
        currentHitPoints: 1,
        isConscious: true,
        vitalState: 'standing',
      });
      expect(first.relentlessEnduranceLine).toBe(
        `${name} stays on their feet with 1 HP (Relentless Endurance).`,
      );
      expect(await usesRemaining()).toBe(0);

      const second = await CharacterVitalsService.applyDamage(characterId, userId, 5);
      expect(second).toMatchObject({ currentHitPoints: 0, vitalState: 'dying' });
      expect(second.relentlessEnduranceLine).toBeUndefined();
    });

    it('a non-attack source in a live fight (applyNonAttackDamage) carries the engine line', async () => {
      const { applyNonAttackDamage } = await import('../combat/non-attack-damage.js');
      await becomeHalfOrc();

      const result = await applyNonAttackDamage(
        characterId,
        userId,
        MAX_HP,
        'a collapsing ceiling',
      );

      expect(result.engineLines).toContain(LINE);
      expect(await participant(heroId)).toMatchObject({ currentHp: 1, isConscious: true });
      expect(await sheet()).toMatchObject({ currentHitPoints: 1, vitalState: 'standing' });
      expect(await usesRemaining()).toBe(0);
    });

    it('an attack (combatAttackService.resolveAttack) that drops a Half-Orc carries the engine line', async () => {
      const { combatAttackService } = await import('../combat/combat-attack-service.js');
      await becomeHalfOrc();
      // The goblin's turn, the hero at 1 HP and armour class 1: a d20 of 15 hits and is no crit,
      // and any damage drops the hero to 0, so the per-hit cap cannot keep them up.
      await db
        .update(combatParticipantStatus)
        .set({ currentHp: 1 })
        .where(eq(combatParticipantStatus.participantId, heroId));
      await db
        .update(characterStats)
        .set({ currentHitPoints: 1 })
        .where(eq(characterStats.characterId, characterId));
      await db
        .update(combatParticipants)
        .set({ armorClass: 1 })
        .where(eq(combatParticipants.id, heroId));
      await db
        .update(combatEncounters)
        .set({ currentTurnOrder: 1 })
        .where(eq(combatEncounters.id, encounterId));
      try {
        const [{ version }] = await db
          .select({ version: combatEncounters.version })
          .from(combatEncounters)
          .where(eq(combatEncounters.id, encounterId));

        const result = await combatAttackService.resolveAttack(
          encounterId,
          {
            attackerId: goblinId,
            targetId: heroId,
            expectedVersion: version,
            attackType: 'melee',
            providedD20: 15,
          },
          userId,
        );

        expect(result.hit).toBe(true);
        expect(result.transcriptLines ?? []).toContain(LINE);
        expect(await participant(heroId)).toMatchObject({ currentHp: 1, isConscious: true });
        expect(await sheet()).toMatchObject({ currentHitPoints: 1, vitalState: 'standing' });
        expect(await usesRemaining()).toBe(0);
      } finally {
        await db
          .update(combatParticipants)
          .set({ armorClass: null, actionUsed: false })
          .where(eq(combatParticipants.encounterId, encounterId));
        await db
          .update(combatEncounters)
          .set({ currentTurnOrder: 0 })
          .where(eq(combatEncounters.id, encounterId));
      }
    });
  });
});
