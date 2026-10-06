/* eslint-disable max-lines -- one fixture (campaign -> character -> session -> encounter ->
   board) rebuilt per test, because every assertion below is about a fight that ENDS, and each
   ending destroys the encounter and the board it ends. Splitting the file would mean standing
   the same chain up twice. */
/**
 * #2580: a player has a way out of a fight the end guard holds open.
 *
 * Before this, the guard from #2524 refused a DM scene end while a hostile stood, and the only
 * exits it honoured were the DM's own `combat_exits`. So a fight the player wanted out of could
 * only end by killing everything: the Disengage chip moved the token and recorded nothing, and
 * no control produced an exit for the player's own side. The player was stuck in initiative with
 * a 409 on every `end`.
 *
 * Real database throughout, through `executeCombatIntent` and `concludeEncounter` — the two
 * functions the intent and end routes call — not through the HTTP route itself (the wire body is
 * pinned separately: intent-schema.test.ts and the client pipeline test). The failure this has
 * to not have again lives in the seam between the intent that records the exit, the participant
 * row that leaves the turn order, and the guard that reads both back — a mocked `db` papers over
 * exactly that seam (fixtures/real-db.ts explains why, at length).
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { afterAll, afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from './fixtures/real-db.js';
import {
  campaigns,
  characterStats,
  characters,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
  narrativeFacts,
  tacticalMaps,
} from '../../../../db/schema/index';
import { playerExitDmEnvelope } from '../../../../shared/test-fixtures/player-exit-intent';

import type { MonsterAttackProfile } from '../combat/monster-attack-profile.js';

const { consumeDmTacticalFacts } = await importWithRealDb(
  () => import('../combat/tactical-action-service.js'),
);
const { saveTacticalMap, loadActiveTacticalMap } = await importWithRealDb(
  () => import('../combat/tactical-map-store.js'),
);
const { concludeEncounter } = await importWithRealDb(() => import('../combat/combat-ending.js'));
const { executeCombatIntent } = await importWithRealDb(
  () => import('../combat/combat-intent-service.js'),
);
const { buildTurnOrderBlock } = await importWithRealDb(
  () => import('../combat/turn-order-block.js'),
);
const { enforceCombatTransitionContract } = await importWithRealDb(
  () => import('../combat-transition-enforcement.js'),
);

if (!hasRealDb) {
  console.warn('[player-exit] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.');
}

const HERO_MAX_HP = 7;

describeWithDb('a player can leave a fight the end guard is holding open (#2580)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('player-exit-user');

  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let heroId: string;
  let swarmId: string;
  /** Distance in cells between the two tokens: one cell is five feet. */
  let gap: number;
  const createdSessionIds: string[] = [];

  const heroRow = async () => {
    const [row] = await db
      .select()
      .from(combatParticipants)
      .where(eq(combatParticipants.id, heroId));
    return row;
  };

  const heroHp = async (): Promise<number | null> => {
    const [row] = await db
      .select({ currentHp: combatParticipantStatus.currentHp })
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, heroId));
    return row?.currentHp ?? null;
  };

  const encounterRow = async () => {
    const [row] = await db
      .select({ status: combatEncounters.status, endedReason: combatEncounters.endedReason })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    return row;
  };

  beforeEach(async () => {
    if (!hasRealDb) return;
    if (!campaignId) {
      [{ id: campaignId }] = await db
        .insert(campaigns)
        .values({ userId, name: testId('exit-camp') })
        .returning({ id: campaigns.id });
      [{ id: characterId }] = await db
        .insert(characters)
        .values({ userId, campaignId, name: 'The Scholar', level: 3, class: 'Wizard' })
        .returning({ id: characters.id });
      await db.insert(characterStats).values({
        characterId,
        strength: 8,
        armorClass: 11,
        maxHitPoints: HERO_MAX_HP,
        currentHitPoints: HERO_MAX_HP,
        speed: 30,
      });
    }

    // A fresh SESSION per test: #1954 allows one ACTIVE encounter per session, and each test
    // here ends its encounter differently, so a shared session would collide with the row the
    // previous test left behind.
    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    createdSessionIds.push(sessionId);

    [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 2, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });

    // The D5 fixture, in shape: the Scholar holds the turn at 5/7 and a Light-Eater Swarm is
    // alive at 4/4. Nothing here has been fought — that is the point.
    const inserted = await db
      .insert(combatParticipants)
      .values([
        {
          encounterId,
          characterId,
          name: 'The Scholar',
          participantType: 'player',
          turnOrder: 0,
          initiative: 19,
          armorClass: 11,
          maxHp: HERO_MAX_HP,
          speed: 30,
        },
        {
          encounterId,
          name: 'Light-Eater Swarm 1',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 7,
          armorClass: 12,
          maxHp: 4,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
    heroId = inserted.find((row) => row.turnOrder === 0)!.id;
    swarmId = inserted.find((row) => row.turnOrder === 1)!.id;
    await db.insert(combatParticipantStatus).values([
      { participantId: heroId, currentHp: 5, maxHp: HERO_MAX_HP, isConscious: true },
      { participantId: swarmId, currentHp: 4, maxHp: 4, isConscious: true },
    ]);

    // Adjacent, one cell apart: five feet, inside the reach of the unarmed strike this Swarm
    // fights with. The opportunity-attack case is the one that has to hold, and a fixture at
    // ten feet would have passed by never drawing one.
    gap = 1;
    await saveTacticalMap({
      id: crypto.randomUUID(),
      sessionId,
      width: 12,
      height: 10,
      cells: Array.from({ length: 10 }, () =>
        Array.from({ length: 12 }, () => ({
          terrain: 'floor' as const,
          blocksMovement: false,
          blocksSight: false,
          cover: 0 as const,
          elevation: 0,
        })),
      ),
      entities: [
        {
          id: heroId,
          slug: 'the-scholar',
          x: 4,
          y: 4,
          size: 'medium',
          type: 'pc',
          speedFeet: 30,
          movementRemaining: 30,
        },
        {
          id: swarmId,
          slug: 'light-eater-swarm-1',
          x: 4 + gap,
          y: 4,
          size: 'medium',
          type: 'monster',
          speedFeet: 30,
          movementRemaining: 30,
        },
      ],
      round: 2,
      sceneDescription: 'D5 gallery',
    });
    await consumeDmTacticalFacts(sessionId);
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    const rows = await db
      .select({ id: combatParticipants.id })
      .from(combatParticipants)
      .innerJoin(combatEncounters, eq(combatParticipants.encounterId, combatEncounters.id))
      .where(inArray(combatEncounters.sessionId, createdSessionIds));
    await db.delete(combatParticipantStatus).where(
      inArray(
        combatParticipantStatus.participantId,
        rows.map((row) => row.id),
      ),
    );
    await db.delete(narrativeFacts).where(inArray(narrativeFacts.sessionId, createdSessionIds));
    await db.delete(tacticalMaps).where(inArray(tacticalMaps.sessionId, createdSessionIds));
    for (const row of await db
      .select({ id: combatEncounters.id })
      .from(combatEncounters)
      .where(inArray(combatEncounters.sessionId, createdSessionIds))) {
      await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, row.id));
    }
    await db.delete(combatEncounters).where(inArray(combatEncounters.sessionId, createdSessionIds));
    await db.delete(gameSessions).where(inArray(gameSessions.id, createdSessionIds));
    await db.delete(characterStats).where(eq(characterStats.characterId, characterId));
    await db.delete(characters).where(eq(characters.id, characterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  const flee = (type: 'flee' | 'yield' = 'flee') =>
    executeCombatIntent(
      encounterId,
      { type, actorId: heroId, expectedVersion: 1 },
      userId,
      'player',
      Date.now(),
      'action_bar',
    );

  /** Move the Swarm to `cells` away, so a case can choose whether it can reach the hero. */
  const setGap = async (cells: number): Promise<void> => {
    const map = await loadActiveTacticalMap(sessionId);
    if (!map) throw new Error('fixture board missing');
    const swarm = map.entities.find((entity) => entity.id === swarmId)!;
    const hero = map.entities.find((entity) => entity.id === heroId)!;
    swarm.x = hero.x + cells;
    await saveTacticalMap(map);
  };

  /** The Swarm's attack as `MonsterAttackProfile` stores it on the participant row. */
  const setSwarmAttack = async (attack: MonsterAttackProfile['attacks'][number]): Promise<void> => {
    const profile: MonsterAttackProfile = { source: 'authored', attacks: [attack] };
    await db
      .update(combatParticipants)
      .set({ monsterAttack: profile })
      .where(eq(combatParticipants.id, swarmId));
  };

  const swarmRow = async () => {
    const [row] = await db
      .select({
        actionUsed: combatParticipants.actionUsed,
        reactionUsed: combatParticipants.reactionUsed,
      })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, swarmId));
    return row;
  };

  const encounterVersion = async (): Promise<number> => {
    const [row] = await db
      .select({ version: combatEncounters.version })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    return row.version;
  };

  const partyLedgerState = async (): Promise<unknown> => {
    const rows = await db
      .select({ value: narrativeFacts.value, invalidatedAt: narrativeFacts.invalidatedAt })
      .from(narrativeFacts)
      .where(eq(narrativeFacts.sessionId, sessionId));
    return rows.find((row) => row.invalidatedAt === null)?.value;
  };

  const randomSpy = (value: number) => spyOn(Math, 'random').mockReturnValue(value);
  afterEach(() => {
    (Math.random as unknown as { mockRestore?: () => void }).mockRestore?.();
  });

  test('fleeing mid-combat records the exit and leaves HP untouched', async () => {
    // Out of reach, so this case measures the exit alone and nothing else. With a hostile
    // adjacent the hero can legitimately lose hit points to the opportunity attack, and a test
    // asserting "untouched" there would be asserting that the dice went their way.
    await setGap(3);
    await flee();

    // The exit is the engine's own: the participant row leaves the turn order and nothing else
    // about it moves. A fled player must never read back as a dead one.
    expect(await heroRow()).toMatchObject({ isActive: false, maxHp: HERO_MAX_HP });
    expect(await heroHp()).toBe(5);
    expect(await consumeDmTacticalFacts(sessionId)).toEqual(['The Scholar flees the fight.']);
    // The fight is not over by itself: nobody declared an end, so the encounter is still standing
    // and it is the DM's next turn that closes it.
    expect(await encounterRow()).toMatchObject({ status: 'active', endedReason: null });
  });

  test('fleeing out of every hostile’s reach provokes no attack at all', async () => {
    // The other half of the reach rule: the opportunity attack is provoked BY proximity, so a
    // flee into empty space must cost nothing and say nothing about an attack.
    await setGap(4);
    await flee();

    expect(await consumeDmTacticalFacts(sessionId)).toEqual(['The Scholar flees the fight.']);
    expect(await heroHp()).toBe(5);
  });

  test("the DM's next end is not 409-refused, and the encounter concludes", async () => {
    await flee();

    // The exact call the end route makes on `combat_transition: 'end'` (#2563). It returned false
    // before this change — the 409 the player was stuck behind.
    const concluded = await concludeEncounter(encounterId, sessionId, userId, 'dm_ended_scene', {
      exits: [{ participant_id: 'light-eater-swarm-1', exit: 'fled' }],
    });

    expect(concluded).toBe(true);
    expect(await encounterRow()).toMatchObject({ status: 'completed' });
    // The reason is the exit, not the DM declaring a scene over while a creature stood: a row
    // that said otherwise is exactly what #2524 was about.
    expect((await encounterRow()).endedReason).toBe('abandoned');
    // The DM's sentence is the abandonment one, not the DM-declared-scene one: it must not open
    // with "the last hostile has fallen" over a creature standing at 4/4.
    const facts = await consumeDmTacticalFacts(sessionId);
    expect(facts.at(-1)).toContain('abandoned mid-fight');
    // The Swarm was never killed, and the fact the DM reads says so.
    const [swarmStatus] = await db
      .select({ currentHp: combatParticipantStatus.currentHp })
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, swarmId));
    expect(swarmStatus.currentHp).toBe(4);
  });

  test('fleeing inside a hostile\u2019s reach resolves exactly one opportunity attack first', async () => {
    await flee();

    const facts = await consumeDmTacticalFacts(sessionId);
    const attacks = facts.filter((fact) => fact.includes('attacked The Scholar'));
    // Exactly one, never a round's worth, and it lands before the exit line — the ordering is
    // the rule's: the blow is struck while the player is still in reach.
    expect(attacks).toHaveLength(1);
    expect(facts.at(-1)).toBe('The Scholar flees the fight.');
    expect(facts.indexOf(attacks[0])).toBeLessThan(facts.length - 1);
    // The line must be a real resolution, not a sentence written because an attack was expected:
    // `describeResolvedAttack` says MISSED or reports the roll that hit, and either way it is a
    // die the engine threw. A refused reaction must leave no line at all, and this is the only
    // thing in the suite that would notice if one did.
    expect(attacks[0]).toMatch(/attacked The Scholar with its Unarmed Strike/);
    expect(attacks[0]).toMatch(/MISS|for \d+ damage/);
    // The attack is the only thing in this flow that may cost the player hit points, and it
    // costs no more than the single blow it reports: a miss leaves them where they stood.
    const struck = /for (\d+) damage/.exec(attacks[0]);
    expect(await heroHp()).toBe(struck ? 5 - Number(struck[1]) : 5);
    // And the exit still stands, whatever the dice did.
    expect(await heroRow()).toMatchObject({ isActive: false });
    // The attacker spent its REACTION, not a second Action: a monster that still had its Action
    // for the round is the rule, and spending it here would rob the creature of its own turn.
    const [swarm] = await db
      .select({
        actionUsed: combatParticipants.actionUsed,
        reactionUsed: combatParticipants.reactionUsed,
      })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, swarmId));
    expect(swarm).toMatchObject({ actionUsed: false, reactionUsed: true });
  });

  test('yielding records the surrender and provokes no attack', async () => {
    await flee('yield');

    expect(await heroRow()).toMatchObject({ isActive: false });
    expect(await heroHp()).toBe(5);
    expect(await consumeDmTacticalFacts(sessionId)).toEqual(['The Scholar yields.']);
  });

  test('the exit fact reaches the DM prompt the way a combat_exits fact does', async () => {
    await flee();

    // `combat_exits` reaches the DM through `recordDmTacticalFact`, which the tactical-context
    // route renders inside `<engine_resolved_outcomes>`. The player exit has to arrive the same
    // way or the DM narrates a fight the engine has already ended — which is the failure this
    // whole change exists to stop (#2524).
    const facts = await consumeDmTacticalFacts(sessionId);
    expect(facts.at(-1)).toBe('The Scholar flees the fight.');
    // It is one engine line the DM can read as narration, not a chat message the player typed:
    // the exit is the engine's decision and must never read back as the player's prose.
    expect(facts.some((fact) => fact.startsWith('⚙️ Engine:'))).toBe(false);
  });

  test('Disengage then moving off the board records the exit with no chip', async () => {
    // The Disengage chip first, exactly as the client sends it.
    await executeCombatIntent(
      encounterId,
      { type: 'disengage', actorId: heroId, expectedVersion: 1 },
      userId,
      'player',
      Date.now(),
      'action_bar',
    );
    await consumeDmTacticalFacts(sessionId);
    // Then the move off the board. x=0 is the map's outer ring, which is the engine's own
    // definition of having left (see `hasLeftTheBoard`).
    await executeCombatIntent(
      encounterId,
      { type: 'move', actorId: heroId, x: 0, y: 4 },
      userId,
      'player',
      Date.now(),
      'action_bar',
    );

    expect(await heroRow()).toMatchObject({ isActive: false });
    const facts = await consumeDmTacticalFacts(sessionId);
    expect(facts).toContain('The Scholar flees the fight.');
  });

  test('an opportunity attack that downs the player records NO exit', async () => {
    // Hero at 1 HP, Math.random pinned high so the Swarm's d20 is a natural 20: the reaction hits.
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 1 })
      .where(eq(combatParticipantStatus.participantId, heroId));
    randomSpy(0.99);

    await flee();

    // Dying, not gone: still in the turn order for the death-save flow, at 0 HP, unconscious.
    expect(await heroRow()).toMatchObject({ isActive: true });
    expect(await heroHp()).toBe(0);
    const [status] = await db
      .select({ isConscious: combatParticipantStatus.isConscious })
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, heroId));
    expect(status.isConscious).toBe(false);
    const facts = await consumeDmTacticalFacts(sessionId);
    expect(facts.some((fact) => fact.includes('UNCONSCIOUS'))).toBe(true);
    expect(facts.some((fact) => fact.includes('flees the fight'))).toBe(false);
    expect(await partyLedgerState()).toBeUndefined();
    // The guard still holds the fight open: a downed player has not left it.
    expect(await concludeEncounter(encounterId, sessionId, userId, 'dm_ended_scene')).toBe(false);
    expect(await encounterRow()).toMatchObject({ status: 'active', endedReason: null });
  });

  test('Flee does not spend the Action: it works with the Action already spent', async () => {
    await db
      .update(combatParticipants)
      .set({ actionUsed: true })
      .where(eq(combatParticipants.id, heroId));
    await setGap(3);

    await flee();

    expect(await heroRow()).toMatchObject({ isActive: false, actionUsed: true });
    expect(await consumeDmTacticalFacts(sessionId)).toEqual(['The Scholar flees the fight.']);
  });

  test('a stale expectedVersion is refused: no exit, no attack', async () => {
    await expect(
      executeCombatIntent(
        encounterId,
        { type: 'flee', actorId: heroId, expectedVersion: 0 },
        userId,
        'player',
        Date.now(),
        'action_bar',
      ),
    ).rejects.toThrow();

    expect(await heroRow()).toMatchObject({ isActive: true });
    expect(await heroHp()).toBe(5);
    expect(await consumeDmTacticalFacts(sessionId)).toEqual([]);
    expect(await swarmRow()).toMatchObject({ reactionUsed: false });
  });

  test('Disengage, then Flee with a hostile adjacent: the exit is recorded and no attack is made', async () => {
    await executeCombatIntent(
      encounterId,
      { type: 'disengage', actorId: heroId, expectedVersion: 1 },
      userId,
      'player',
      Date.now(),
      'action_bar',
    );
    await consumeDmTacticalFacts(sessionId);

    await executeCombatIntent(
      encounterId,
      { type: 'flee', actorId: heroId, expectedVersion: await encounterVersion() },
      userId,
      'player',
      Date.now(),
      'action_bar',
    );

    expect(await heroRow()).toMatchObject({ isActive: false });
    expect(await consumeDmTacticalFacts(sessionId)).toEqual(['The Scholar flees the fight.']);
    expect(await heroHp()).toBe(5);
    expect(await swarmRow()).toMatchObject({ actionUsed: false, reactionUsed: false });
  });

  test('a hostile archer provokes nothing, at 30 ft or at 5 ft', async () => {
    await setSwarmAttack({
      name: 'Shortbow',
      attackBonus: 4,
      damageDice: '1d6',
      damageBonus: 2,
      damageType: 'piercing',
      normalRange: 80,
      longRange: 320,
      ranged: true,
    });
    randomSpy(0.99);

    await setGap(6);
    await flee();

    expect(await consumeDmTacticalFacts(sessionId)).toEqual(['The Scholar flees the fight.']);
    expect(await heroHp()).toBe(5);
    expect(await swarmRow()).toMatchObject({ reactionUsed: false });
  });

  test('a hostile archer adjacent still provokes nothing: only melee reach does', async () => {
    await setSwarmAttack({
      name: 'Shortbow',
      attackBonus: 4,
      damageDice: '1d6',
      damageBonus: 2,
      damageType: 'piercing',
      normalRange: 80,
      longRange: 320,
      ranged: true,
    });
    randomSpy(0.99);

    await flee();

    expect(await consumeDmTacticalFacts(sessionId)).toEqual(['The Scholar flees the fight.']);
    expect(await swarmRow()).toMatchObject({ reactionUsed: false });
  });

  test('a fled player is an exit, not a defeat: the next end_turn does not conclude the fight', async () => {
    await setGap(3);
    await flee();
    await consumeDmTacticalFacts(sessionId);

    // The Swarm is the current turn now — `getCombatState` indexes the turn into the ACTIVE list.
    await executeCombatIntent(
      encounterId,
      { type: 'end_turn', actorId: swarmId },
      userId,
      'dm',
      Date.now(),
    );

    expect(await encounterRow()).toMatchObject({ status: 'active', endedReason: null });
    // Only the DM's own end closes it, and it closes as the abandonment it is.
    expect(await concludeEncounter(encounterId, sessionId, userId, 'dm_ended_scene')).toBe(true);
    expect((await encounterRow()).endedReason).toBe('abandoned');
  });

  test('yielding is recorded as surrendered in the ledger, and fleeing as fled', async () => {
    await flee('yield');
    await concludeEncounter(encounterId, sessionId, userId, 'dm_ended_scene');
    expect(await partyLedgerState()).toMatchObject({ state: 'surrendered', encounterId });

    // A fresh fight for the flee half: the first one concluded and tore its board down.
    await db.delete(narrativeFacts).where(eq(narrativeFacts.sessionId, sessionId));
    const [{ id: secondEncounter }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 2, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });
    const [hero] = await db
      .insert(combatParticipants)
      .values({
        encounterId: secondEncounter,
        characterId,
        name: 'The Scholar',
        participantType: 'player',
        turnOrder: 0,
        initiative: 19,
        armorClass: 11,
        maxHp: HERO_MAX_HP,
        speed: 30,
      })
      .returning({ id: combatParticipants.id });
    await db.insert(combatParticipants).values({
      encounterId: secondEncounter,
      name: 'Light-Eater Swarm 1',
      participantType: 'monster',
      turnOrder: 1,
      initiative: 7,
      armorClass: 12,
      maxHp: 4,
      speed: 30,
    });
    const second = await db
      .select({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder })
      .from(combatParticipants)
      .where(eq(combatParticipants.encounterId, secondEncounter));
    await db.insert(combatParticipantStatus).values([
      { participantId: hero.id, currentHp: 5, maxHp: HERO_MAX_HP, isConscious: true },
      {
        participantId: second.find((row) => row.turnOrder === 1)!.id,
        currentHp: 4,
        maxHp: 4,
        isConscious: true,
      },
    ]);
    await executeCombatIntent(
      secondEncounter,
      { type: 'flee', actorId: hero.id, expectedVersion: 1 },
      userId,
      'player',
      Date.now(),
      'action_bar',
    );
    await concludeEncounter(secondEncounter, sessionId, userId, 'dm_ended_scene');
    expect(await partyLedgerState()).toMatchObject({ state: 'fled', encounterId: secondEncounter });
  });

  test('a refused reaction leaves no attack line, and the exit still stands', async () => {
    await db
      .update(combatParticipants)
      .set({ reactionUsed: true })
      .where(eq(combatParticipants.id, swarmId));

    await flee();

    expect(await consumeDmTacticalFacts(sessionId)).toEqual(['The Scholar flees the fight.']);
    expect(await heroHp()).toBe(5);
    expect(await heroRow()).toMatchObject({ isActive: false });
  });

  test('a move to the edge WITHOUT having Disengaged records no exit', async () => {
    await executeCombatIntent(
      encounterId,
      { type: 'move', actorId: heroId, x: 0, y: 4 },
      userId,
      'player',
      Date.now(),
      'action_bar',
    );

    expect(await heroRow()).toMatchObject({ isActive: true });
    expect(await consumeDmTacticalFacts(sessionId)).not.toContain('The Scholar flees the fight.');
  });

  test('a Disengaged move that stays on the interior of the board records no exit', async () => {
    await executeCombatIntent(
      encounterId,
      { type: 'disengage', actorId: heroId, expectedVersion: 1 },
      userId,
      'player',
      Date.now(),
      'action_bar',
    );
    await consumeDmTacticalFacts(sessionId);
    await executeCombatIntent(
      encounterId,
      { type: 'move', actorId: heroId, x: 3, y: 4 },
      userId,
      'player',
      Date.now(),
      'action_bar',
    );

    expect(await heroRow()).toMatchObject({ isActive: true });
    expect(await consumeDmTacticalFacts(sessionId)).not.toContain('The Scholar flees the fight.');
  });

  test('the generation-time guard lets the DM end stand once the player has left, and defers it before', async () => {
    // Two hostiles, so one is always OFF the current turn: the generation-time roster drops the
    // current-turn line, and with a single Swarm holding the turn nothing would be left to
    // block the end either way — the party-left rule would be untested.
    const [second] = await db
      .insert(combatParticipants)
      .values({
        encounterId,
        name: 'Light-Eater Swarm 2',
        participantType: 'monster',
        turnOrder: 2,
        initiative: 5,
        armorClass: 12,
        maxHp: 4,
        speed: 30,
      })
      .returning({ id: combatParticipants.id });
    await db
      .insert(combatParticipantStatus)
      .values({ participantId: second.id, currentHp: 4, maxHp: 4, isConscious: true });
    const board = await loadActiveTacticalMap(sessionId);
    board!.entities.push({
      id: second.id,
      slug: 'light-eater-swarm-2',
      x: 9,
      y: 4,
      size: 'medium',
      type: 'monster',
      speedFeet: 30,
      movementRemaining: 30,
    });
    await saveTacticalMap(board!);
    const enforce = (prompt: string) =>
      enforceCombatTransitionContract({
        result: {
          text: JSON.stringify(playerExitDmEnvelope({ combat_exits: [] })),
          provider: 'openrouter',
        },
        prompt,
        maxTokens: 4000,
        temperature: 0.9,
        provider: 'openrouter',
        responseSchema: { properties: { combat_transition: {}, roll_requests: {} } },
      });
    const promptWith = (block: string) =>
      `${block}\n<immutable_game_state>{"isInCombat":true,"encounterId":"${encounterId}"}</immutable_game_state>`;

    // Player still in the order: the standing Swarm holds the end, as #2524 requires.
    const before = await buildTurnOrderBlock(sessionId, userId);
    expect(before).toContain('role:player');
    const deferred = JSON.parse((await enforce(promptWith(before))).text) as {
      combat_transition: string;
    };
    expect(deferred.combat_transition).toBe('none');

    // After the exit the real block has no player line, and the end must reach the route. The
    // Swarms stay out of reach, so the exit is the only thing that changed.
    await setGap(3);
    await flee();
    const after = await buildTurnOrderBlock(sessionId, userId);
    expect(after).not.toContain('role:player');
    const accepted = JSON.parse((await enforce(promptWith(after))).text) as {
      combat_transition: string;
    };
    expect(accepted.combat_transition).toBe('end');
  });

  test('a second Flee click is refused: the player is already out of the order', async () => {
    await setGap(3);
    await flee();
    await expect(
      executeCombatIntent(
        encounterId,
        { type: 'flee', actorId: heroId, expectedVersion: await encounterVersion() },
        userId,
        'player',
        Date.now(),
        'action_bar',
      ),
    ).rejects.toThrow();
    expect(await consumeDmTacticalFacts(sessionId)).toEqual(['The Scholar flees the fight.']);
  });

  test('a downed player cannot Flee: no exit is recorded', async () => {
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 0, isConscious: false })
      .where(eq(combatParticipantStatus.participantId, heroId));
    await setGap(3);

    await expect(flee()).rejects.toThrow('Only a standing character can flee or yield');

    expect(await heroRow()).toMatchObject({ isActive: true });
    expect(await consumeDmTacticalFacts(sessionId)).toEqual([]);
  });

  test('with no player row, a live hostile still holds the DM end (#2524)', async () => {
    // The same roster shape as the no-player ending test, but the Swarm is alive: the guard has
    // to refuse, not read the missing player as a party that walked out.
    await db
      .update(combatParticipants)
      .set({ participantType: 'monster', isActive: false })
      .where(eq(combatParticipants.id, heroId));

    expect(await concludeEncounter(encounterId, sessionId, userId, 'dm_ended_scene')).toBe(false);
    expect(await encounterRow()).toMatchObject({ status: 'active', endedReason: null });
  });

  test('an encounter with no player row still ends when the last hostile is down', async () => {
    // Not a fled party: there was never a player in it. The party-left early return must not
    // hold such a fight open forever.
    await db
      .update(combatParticipants)
      .set({ participantType: 'monster', isActive: false })
      .where(eq(combatParticipants.id, heroId));
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 0, isConscious: false })
      .where(eq(combatParticipantStatus.participantId, swarmId));

    await executeCombatIntent(
      encounterId,
      { type: 'end_turn', actorId: swarmId },
      userId,
      'dm',
      Date.now(),
    ).catch(() => undefined);

    expect(await encounterRow()).toMatchObject({ status: 'completed' });
  });
});
