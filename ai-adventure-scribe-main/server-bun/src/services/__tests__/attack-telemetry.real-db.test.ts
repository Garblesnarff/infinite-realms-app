/* eslint-disable max-lines -- one cohesive fixture chain (campaign -> character -> session
   -> encounter -> participants -> status -> board) shared by every assertion; splitting it
   would mean building combat twice. */
/**
 * Every attack resolution emits one complete `COMBAT_ATTACK_RESOLVED` line — misses too.
 *
 * Three questions went unanswered across six consecutive playtests, all for the same
 * reason: nothing recorded what the engine rolled. Run 16 accepted four attacks and produced
 * one `damage_applied` event; with the player untouched afterwards, the two monster attacks
 * were either honest misses against AC 13 or damage swallowed the way the Drizzle
 * insert-select bug used to swallow it, and the evidence could not tell those apart.
 *
 * The miss assertions are the load-bearing ones. A hit at least leaves a `combat_damage_log`
 * row behind; a miss leaves nothing, which is exactly how "missed" and "damage vanished"
 * became the same observation.
 *
 * Asserted against a real resolution through `combatAttackService.resolveAttack` — the same
 * entry point the HTTP intent route calls — and never against a hand-built telemetry object.
 * A constructed object would pass whether or not the engine ever emits the line, which is
 * the precise failure mode being closed here. It also has to be a real database: mocking
 * `db` is how the insert-select bug survived eleven weeks across 30 call sites.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import { closeRealDb, describeWithDb, hasRealDb, realDb, testId } from './fixtures/real-db.js';
import {
  campaigns,
  characters,
  characterStats,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
  inventoryItems,
  tacticalMaps,
} from '../../../../db/schema/index';

type LogPayload = Record<string, unknown>;

/** Captures the line the engine actually emitted, in place, rather than reconstructing it. */
const emitted: LogPayload[] = [];
const info = mock((payload: LogPayload) => {
  if (payload.msg === 'COMBAT_ATTACK_RESOLVED') emitted.push(payload);
});

// The child loggers are re-exported too. `mock.module` replaces the whole module for every
// importer in the run, so omitting one turns into a hard "Export named 'combatLogger' not
// found" in whichever unrelated file imports it next.
const stub = () => ({
  info,
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
  child: () => stub(),
});

mock.module('../../lib/logger.js', () => ({
  logger: stub(),
  combatLogger: stub(),
  spellLogger: stub(),
  progressionLogger: stub(),
  errorLogSerializers: {},
}));

const { combatAttackService } = await import('../combat/combat-attack-service.js');
const { saveTacticalMap } = await import('../combat/tactical-map-store.js');

if (!hasRealDb) {
  console.warn(
    '[attack-telemetry] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

/**
 * The d20 is `Math.floor(Math.random() * 20) + 1`. Pinning the face by replacing
 * `Math.random` for the duration of one resolution is not reliable — the path issues several
 * database round-trips first and postgres.js draws from the same source — so instead the
 * *AC* is moved. An AC of 1 cannot be missed except on a natural 1; an AC of 40 cannot be
 * hit except on a natural 20. Both branches are then reachable in a bounded number of
 * attempts without touching the engine's dice at all.
 */
const HERO = { ac: 13, maxHp: 60, strength: 16, level: 3 };
const UNREACHABLE_AC = 40;
const UNMISSABLE_AC = 1;

describeWithDb('attack resolution telemetry', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('telemetry-user');

  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let heroId: string;
  let monsterId: string;

  beforeAll(async () => {
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('camp') })
      .returning({ id: campaigns.id });

    [{ id: characterId }] = await db
      .insert(characters)
      .values({ userId, campaignId, name: testId('hero'), level: HERO.level, class: 'Fighter' })
      .returning({ id: characters.id });

    await db.insert(characterStats).values({
      characterId,
      strength: HERO.strength,
      armorClass: HERO.ac,
      maxHitPoints: HERO.maxHp,
      currentHitPoints: HERO.maxHp,
      speed: 30,
    });

    // The bow exists only for the cover case: a melee weapon cannot reach across the
    // covering square, so cover and reach are mutually exclusive without it.
    await db.insert(inventoryItems).values([
      { characterId, name: 'Longsword', itemType: 'weapon', isEquipped: true },
      { characterId, name: 'Longbow', itemType: 'weapon', isEquipped: true },
    ]);

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
          name: 'Telemetry Hero',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: HERO.ac,
          maxHp: HERO.maxHp,
          speed: 30,
        },
        {
          encounterId,
          name: 'Telemetry Golem',
          // 'monster' is what a structured DM combat start produces; see
          // combat-encounter-service.startCombat.
          participantType: 'monster',
          turnOrder: 1,
          initiative: 10,
          armorClass: 17,
          maxHp: 200,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });

    heroId = inserted.find((row) => row.turnOrder === 0)!.id;
    monsterId = inserted.find((row) => row.turnOrder === 1)!.id;

    await db.insert(combatParticipantStatus).values([
      { participantId: heroId, currentHp: HERO.maxHp, maxHp: HERO.maxHp, isConscious: true },
      { participantId: monsterId, currentHp: 200, maxHp: 200, isConscious: true },
    ]);
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
    await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characters).where(eq(characters.id, characterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  beforeEach(() => {
    emitted.length = 0;
    info.mockClear();
  });

  /** Hands the turn to `actorId`, refunds actions, and returns the version to claim. */
  const giveTurnTo = async (actorId: string): Promise<number> => {
    const [participant] = await db
      .select({ turnOrder: combatParticipants.turnOrder })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, actorId));
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false })
      .where(eq(combatParticipants.encounterId, encounterId));
    const [encounter] = await db
      .update(combatEncounters)
      .set({ currentTurnOrder: participant.turnOrder, updatedAt: new Date() })
      .where(eq(combatEncounters.id, encounterId))
      .returning({ version: combatEncounters.version });
    return encounter.version;
  };

  const setAc = (participantId: string, armorClass: number) =>
    db
      .update(combatParticipants)
      .set({ armorClass })
      .where(eq(combatParticipants.id, participantId));

  /** One real resolution, returning the line the engine logged for it. */
  const attack = async (
    attackerId: string,
    targetId: string,
    weaponId?: string,
  ): Promise<LogPayload> => {
    const expectedVersion = await giveTurnTo(attackerId);
    emitted.length = 0;
    await combatAttackService.resolveAttack(
      encounterId,
      {
        attackerId,
        targetId,
        expectedVersion,
        // `attackType` is required by the input type but never read by the resolver — the
        // real melee/ranged decision comes from the resolved weapon profile.
        attackType: weaponId === 'Longbow' ? 'ranged' : 'melee',
        ...(weaponId ? { weaponId } : {}),
      },
      userId,
    );
    expect(emitted).toHaveLength(1);
    return emitted[0];
  };

  const REQUIRED_FIELDS = [
    'encounterId',
    'attackerId',
    'attackerSlug',
    'targetId',
    'targetSlug',
    'weapon',
    'd20',
    'attackBonus',
    'totalAttack',
    'baseAc',
    'effectiveAc',
    'cover',
    'coverBonus',
    'advantage',
    'disadvantage',
    'outcome',
    'naturalOne',
    'naturalTwenty',
    'critical',
    'damageRolled',
    'damageApplied',
    'targetHpAfter',
  ] as const;

  const expectStructurallyComplete = (line: LogPayload) => {
    for (const field of REQUIRED_FIELDS) expect(line).toHaveProperty(field);
    expect(line.encounterId).toBe(encounterId);
    // A d20 face, not a total, and inside the only range a d20 has.
    expect(line.d20).toBeGreaterThanOrEqual(1);
    expect(line.d20).toBeLessThanOrEqual(20);
    expect(line.totalAttack).toBe(Number(line.d20) + Number(line.attackBonus));
    // The cover adjustment is stated at both ends, which is what makes it checkable.
    expect(line.effectiveAc).toBe(Number(line.baseAc) + Number(line.coverBonus));
    expect(typeof line.advantage).toBe('boolean');
    expect(typeof line.disadvantage).toBe('boolean');
    // Slugs are the form the DM was shown; an id or empty string would be unmatchable
    // against a transcript, which is the whole reason they are logged.
    expect(String(line.attackerSlug).length).toBeGreaterThan(0);
    expect(String(line.targetSlug).length).toBeGreaterThan(0);
  };

  test('a HIT emits one line with every field populated', async () => {
    await setAc(monsterId, UNMISSABLE_AC);
    const line = await attack(heroId, monsterId);

    expect(line.outcome).toBe('hit');
    expectStructurallyComplete(line);
    expect(line.baseAc).toBe(UNMISSABLE_AC);
    expect(line.totalAttack as number).toBeGreaterThanOrEqual(Number(line.effectiveAc));
    // On a hit the damage fields are real numbers, never the nulls a miss carries.
    expect(line.damageRolled).toBeGreaterThan(0);
    expect(line.damageApplied).toBeGreaterThan(0);
    expect(typeof line.targetHpAfter).toBe('number');

    // The HP the line reports is the HP that was written, not the HP the engine intended.
    // This is the "was damage silently dropped?" question, answered against the database.
    const [status] = await db
      .select({ currentHp: combatParticipantStatus.currentHp })
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, monsterId));
    expect(status.currentHp).toBe(Number(line.targetHpAfter));
  });

  test('a MISS logs the roll, the AC and the outcome exactly as a hit does', async () => {
    await setAc(monsterId, UNREACHABLE_AC);
    // A natural 20 hits regardless of AC, so retry until the branch under test is reached.
    // Bounded: the odds of twelve consecutive natural 20s are 1 in 20^12.
    let line: LogPayload | null = null;
    for (let attempt = 0; attempt < 12 && !line; attempt += 1) {
      const candidate = await attack(heroId, monsterId);
      if (candidate.outcome === 'miss') line = candidate;
    }
    expect(line).not.toBeNull();

    expectStructurallyComplete(line!);
    expect(line!.outcome).toBe('miss');
    expect(line!.baseAc).toBe(UNREACHABLE_AC);
    // The discriminating fact: the roll and the AC it lost to are both on the line, so a
    // miss is now distinguishable from a swallowed hit without any other evidence.
    expect(line!.totalAttack as number).toBeLessThan(Number(line!.effectiveAc));
    // Damage fields are explicitly null on a miss — absent would read as "not logged".
    expect(line!.damageRolled).toBeNull();
    expect(line!.damageApplied).toBeNull();
    expect(line!.targetHpAfter).toBeNull();
    expect(line!.critical).toBe(false);
  });

  test('a monster attacking a player is logged in the same shape', async () => {
    // The direction that was invisible in run 16: nothing about monster-sourced attacks was
    // recorded at all, so both of them could be argued either way.
    await setAc(heroId, UNMISSABLE_AC);
    const line = await attack(monsterId, heroId);

    expectStructurallyComplete(line);
    expect(line.attackerId).toBe(monsterId);
    expect(line.targetId).toBe(heroId);
    expect(line.outcome).toBe('hit');
    expect(line.damageApplied).toBeGreaterThan(0);
    await setAc(heroId, HERO.ac);
  });

  test('cover-adjusted AC is reported at both ends of the adjustment', async () => {
    // Never checkable in production before this: the engine applied +2/+5 internally and
    // reported only the final number, so a cover bonus that failed to apply was
    // indistinguishable from a target with lower AC.
    await setAc(monsterId, 17);
    const width = 12;
    const height = 5;
    const cells = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => ({
        terrain: 'floor' as const,
        blocksMovement: false,
        blocksSight: false,
        cover: 0 as 0 | 1 | 2 | 3,
        elevation: 0,
      })),
    );
    cells[2][2].cover = 1; // half cover between the two, at x=2
    const map = {
      id: crypto.randomUUID(),
      sessionId,
      width,
      height,
      cells,
      entities: [
        {
          id: heroId,
          slug: 'telemetry-hero',
          x: 1,
          y: 2,
          size: 'medium' as const,
          type: 'pc' as const,
          speedFeet: 30,
          movementRemaining: 30,
        },
        {
          id: monsterId,
          slug: 'telemetry-golem',
          x: 3,
          y: 2,
          size: 'medium' as const,
          type: 'monster' as const,
          speedFeet: 30,
          movementRemaining: 30,
        },
      ],
      round: 1,
      sceneDescription: 'cover fixture',
    };
    // Through the store rather than a raw insert, so the board is shaped exactly as the
    // loader expects it — including the slug backfill the resolver reads.
    await saveTacticalMap(map);

    const line = await attack(heroId, monsterId, 'Longbow');

    expectStructurallyComplete(line);
    expect(line.cover).toBe(1);
    expect(line.baseAc).toBe(17);
    expect(line.coverBonus).toBe(2);
    expect(line.effectiveAc).toBe(19);
    // The slug is the map's, so the line can be matched against what the DM was shown.
    expect(line.attackerSlug).toBe('telemetry-hero');
    expect(line.targetSlug).toBe('telemetry-golem');

    await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
  });
});
