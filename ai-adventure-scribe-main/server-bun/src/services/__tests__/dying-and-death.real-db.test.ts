/* eslint-disable max-lines -- one fixture (campaign -> character -> session -> encounter ->
   board -> two participants) shared by every assertion. Splitting it would stand up the same
   seven-table chain once per file to make one point about one state machine. */
/**
 * Dying and death per SRD 5.1 (#2518): one death save per player turn, rolled by the player,
 * with the monsters' turns in between.
 *
 * Run D2 (#2516) dropped a character to 0 HP and, inside the SAME enemy resolution, rolled two
 * death saves for them: no player turn, no prompt, no monster action between. Everything below is
 * the sequence the rules actually specify, driven through the real intent gateway
 * (`executeCombatIntent`) against a real database, because the failure lived in the seam between
 * the damage write, the turn advance and the settlement, which a mocked `db` agrees with by
 * construction.
 *
 *   - Dropping to 0 never rolls a save in the same resolution; an overflow at or past the hit
 *     point maximum kills outright.
 *   - The turn order STOPS on a dying player, whose only legal action is the death save.
 *   - 10+ succeeds, 9 or less fails, a natural 1 is two failures, a natural 20 is 1 HP and awake;
 *     three failures are death, three successes are stability.
 *   - A melee blow within 5 ft of an unconscious player is an automatic critical hit; a ranged
 *     hit is one failure.
 *   - A stable player with nobody left to fight beside them ends the encounter as
 *     `player_down_stable`; the engine rolls 1d4 hours and puts them back on 1 HP.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { afterAll, beforeEach, expect, mock, spyOn, test } from 'bun:test';
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
  combatDamageLog,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
  tacticalMaps,
} from '../../../../db/schema/index';
import {
  DYING_SCHOLAR_ENCOUNTER,
  DYING_SCHOLAR_PARTICIPANT,
} from '../../../../shared/test-fixtures/dying-participant-wire';

type LogPayload = Record<string, unknown>;

const deathSaveLogs: LogPayload[] = [];

const record = (payload: LogPayload): void => {
  if (payload?.msg === 'COMBAT_DEATH_SAVE') deathSaveLogs.push(payload);
};

// Every export is stubbed: `mock.module` replaces the module for every importer in the run, so a
// missing child logger becomes a hard "Export named 'combatLogger' not found" elsewhere.
const stub = () => ({
  info: mock(record),
  warn: mock(record),
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
  default: stub(),
}));

const { executeCombatIntent, getLegalCombatActions } = await importWithRealDb(
  () => import('../combat/combat-intent-service.js'),
);
const { CombatEncounterService } = await importWithRealDb(
  () => import('../combat/combat-encounter-service.js'),
);
const { CombatHPService } = await importWithRealDb(() => import('../combat-hp-service.js'));
const { ConditionsService } = await importWithRealDb(() => import('../conditions-service.js'));
const { CombatInitiativeService } = await importWithRealDb(
  () => import('../combat-initiative-service.js'),
);
const { applyNonAttackDamage } = await importWithRealDb(
  () => import('../combat/non-attack-damage.js'),
);
const { updateCombatParticipantStatus } = await importWithRealDb(
  () => import('../combat/combat-persistence-service.js'),
);
const { advanceNpcTurns } = await importWithRealDb(() => import('../combat/npc-turn-runner.js'));
const { saveTacticalMap, loadActiveTacticalMap } = await importWithRealDb(
  () => import('../combat/tactical-map-store.js'),
);
const { consumeDmTacticalFacts } = await importWithRealDb(
  () => import('../combat/tactical-action-service.js'),
);
const { getActiveConditionNames } = await importWithRealDb(
  () => import('../combat/data-access.js'),
);

if (!hasRealDb) {
  console.warn(
    '[dying-and-death] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

const HERO_MAX_HP = 7;

describeWithDb('dying and death follow SRD 5.1, one death save per player turn', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('dying-user');
  const created = {
    campaigns: [] as string[],
    characters: [] as string[],
    sessions: [] as string[],
    encounters: [] as string[],
  };

  beforeEach(() => {
    deathSaveLogs.length = 0;
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    for (const sessionId of created.sessions) {
      await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    }
    if (created.encounters.length) {
      await db
        .delete(combatParticipants)
        .where(inArray(combatParticipants.encounterId, created.encounters));
      await db.delete(combatEncounters).where(inArray(combatEncounters.id, created.encounters));
    }
    if (created.sessions.length) {
      await db.delete(gameSessions).where(inArray(gameSessions.id, created.sessions));
    }
    if (created.characters.length) {
      await db
        .delete(characterStats)
        .where(inArray(characterStats.characterId, created.characters));
      await db.delete(characters).where(inArray(characters.id, created.characters));
    }
    if (created.campaigns.length) {
      await db.delete(campaigns).where(inArray(campaigns.id, created.campaigns));
    }
    await closeRealDb();
  });

  /**
   * One scene: the hero (turn order 0) and one spider (turn order 1), adjacent on a board, with
   * the hero's hit points set as the test needs. The spider's attack numbers are fixed: it hits
   * for `1d1 + damageBonus`, so the damage a test asserts is arithmetic, not luck.
   */
  const seedScene = async (options: {
    heroHp: number;
    /** The hero's hit point maximum (default {@link HERO_MAX_HP}). */
    heroMax?: number;
    spiderDamageBonus?: number;
    spiderRanged?: boolean;
    spiderDownedBehavior?: 'ignore';
    extraAlly?: boolean;
  }) => {
    const [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('camp') })
      .returning({ id: campaigns.id });
    created.campaigns.push(campaignId);
    const [{ id: characterId }] = await db
      .insert(characters)
      .values({ userId, campaignId, name: testId('hero'), level: 1, class: 'Wizard' })
      .returning({ id: characters.id });
    created.characters.push(characterId);
    await db.insert(characterStats).values({
      characterId,
      strength: 8,
      armorClass: 11,
      maxHitPoints: options.heroMax ?? HERO_MAX_HP,
      currentHitPoints: options.heroHp,
      isConscious: options.heroHp > 0,
      speed: 30,
    });
    const [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    created.sessions.push(sessionId);
    const [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });
    created.encounters.push(encounterId);

    const monsterAttack = {
      source: 'authored',
      attacks: [
        {
          name: 'Fangs',
          attackBonus: 5,
          damageDice: '1d1',
          damageBonus: options.spiderDamageBonus ?? 2,
          damageType: 'piercing',
          normalRange: options.spiderRanged ? 60 : 5,
          ranged: options.spiderRanged === true,
        },
      ],
    };
    const inserted = await db
      .insert(combatParticipants)
      .values([
        {
          encounterId,
          characterId,
          name: 'The Scholar',
          participantType: 'player',
          turnOrder: 0,
          initiative: 15,
          armorClass: 11,
          maxHp: options.heroMax ?? HERO_MAX_HP,
          speed: 30,
        },
        {
          encounterId,
          name: 'Vitruvian Spider',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 10,
          armorClass: 15,
          maxHp: 40,
          speed: 30,
          monsterAttack,
        },
        ...(options.extraAlly
          ? [
              {
                encounterId,
                name: 'Brother Aldric',
                participantType: 'player',
                turnOrder: 2,
                initiative: 5,
                armorClass: 12,
                maxHp: 20,
                speed: 30,
              },
            ]
          : []),
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
    const byOrder = new Map(inserted.map((row) => [row.turnOrder, row.id]));
    const heroId = byOrder.get(0)!;
    const spiderId = byOrder.get(1)!;
    const allyId = byOrder.get(2);
    await db.insert(combatParticipantStatus).values([
      {
        participantId: heroId,
        currentHp: options.heroHp,
        maxHp: options.heroMax ?? HERO_MAX_HP,
        isConscious: options.heroHp > 0,
      },
      { participantId: spiderId, currentHp: 40, maxHp: 40, isConscious: true },
      ...(allyId ? [{ participantId: allyId, currentHp: 20, maxHp: 20, isConscious: true }] : []),
    ]);

    await saveTacticalMap({
      id: crypto.randomUUID(),
      sessionId,
      width: 6,
      height: 3,
      cells: Array.from({ length: 3 }, () =>
        Array.from({ length: 6 }, () => ({
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
          x: 1,
          y: 1,
          size: 'medium' as const,
          type: 'pc' as const,
          speedFeet: 30,
          movementRemaining: 30,
        },
        {
          id: spiderId,
          slug: 'vitruvian-spider',
          x: options.spiderRanged ? 5 : 2,
          y: 1,
          size: 'medium' as const,
          type: 'monster' as const,
          speedFeet: 30,
          movementRemaining: 30,
        },
      ],
      round: 1,
      sceneDescription: 'dying and death fixture',
    });
    return { sessionId, encounterId, heroId, spiderId, allyId, characterId };
  };

  const giveTurnTo = async (encounterId: string, participantId: string): Promise<void> => {
    const [participant] = await db
      .select({ turnOrder: combatParticipants.turnOrder })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, participantId));
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false })
      .where(eq(combatParticipants.encounterId, encounterId));
    await db
      .update(combatEncounters)
      .set({ currentTurnOrder: participant.turnOrder, updatedAt: new Date() })
      .where(eq(combatEncounters.id, encounterId));
  };

  /** The spider's turn: it strikes the hero with the given natural d20 and the turn moves on. */
  const spiderStrikes = async (
    scene: { encounterId: string; heroId: string; spiderId: string },
    d20: number,
  ) => {
    await giveTurnTo(scene.encounterId, scene.spiderId);
    return (await executeCombatIntent(
      scene.encounterId,
      { type: 'attack', actorId: scene.spiderId, targetId: scene.heroId, d20 },
      userId,
      'dm',
    )) as Record<string, any>;
  };

  const deathSave = async (scene: { encounterId: string; heroId: string }, d20?: number) =>
    (await executeCombatIntent(
      scene.encounterId,
      { type: 'death_save', actorId: scene.heroId, ...(d20 === undefined ? {} : { d20 }) },
      userId,
      'dm',
      undefined,
      'dice_roll',
    )) as Record<string, any>;

  const statusOf = async (participantId: string) => {
    const [row] = await db
      .select()
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, participantId));
    return row;
  };
  const sheetOf = async (characterId: string) => {
    const [row] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, characterId));
    return row;
  };
  const encounterOf = async (encounterId: string) => {
    const [row] = await db
      .select()
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    return row;
  };
  /** The participant as the route sends it: the stored type does not list the derived wire fields. */
  type WireParticipant = Record<string, any> & { id: string; status?: Record<string, any> };
  const stateOf = async (encounterId: string) => {
    const state = await CombatEncounterService.getCombatState(encounterId, userId);
    return {
      ...state,
      participants: state.participants as unknown as WireParticipant[],
    };
  };

  /** Drops the hero to 0 with a plain hit (3 damage into 3 HP): dying {0,0}, never dead. */
  const dropHero = async () => {
    const scene = await seedScene({ heroHp: 3 });
    await spiderStrikes(scene, 15);
    return scene;
  };

  // -----------------------------------------------------------------------------------------
  // 1. Dropping to 0 HP
  // -----------------------------------------------------------------------------------------

  test('0 HP below the overflow is dying {0,0} and unconscious, and NO save is rolled in that resolution', async () => {
    const scene = await seedScene({ heroHp: 3 });
    const result = await spiderStrikes(scene, 15);

    // The blow: 1d1 + 2 = 3 damage into 3 HP. Overflow 0, far below the maximum of 7.
    expect(result.targetNewHp).toBe(0);
    expect(result.targetIsDead).toBe(false);
    expect(result.instantDeath).toBeUndefined();
    // The D2 bug: saves rolled in the same enemy resolution. None.
    expect(deathSaveLogs).toHaveLength(0);
    expect(result.deathSaves).toBeUndefined();

    const status = await statusOf(scene.heroId);
    expect(status).toMatchObject({
      currentHp: 0,
      isConscious: false,
      deathSavesSuccesses: 0,
      deathSavesFailures: 0,
    });
    // Sheet, tracker and the unconscious condition all agree: 0/7 and unconscious.
    const sheet = await sheetOf(scene.characterId);
    expect(sheet).toMatchObject({
      currentHitPoints: 0,
      maxHitPoints: HERO_MAX_HP,
      isConscious: false,
      vitalState: 'dying',
    });
    const hero = (await stateOf(scene.encounterId)).participants.find(
      (p) => p.id === scene.heroId,
    )!;
    expect(hero).toMatchObject({ vitalState: 'dying', maxHp: HERO_MAX_HP });
    expect(hero.status).toMatchObject({
      currentHp: 0,
      isConscious: false,
      deathSavesSuccesses: 0,
      deathSavesFailures: 0,
    });
    expect(await getActiveConditionNames(scene.heroId)).toContain('unconscious');
    // The fight goes on: a dying player is one lucky d20 from standing up.
    expect((await encounterOf(scene.encounterId)).status).toBe('active');
    const facts = (await consumeDmTacticalFacts(scene.sessionId)).join('\n');
    expect(facts).toContain('UNCONSCIOUS and still dying');
  });

  test('0 HP with the overflow at or past the hit point maximum is instant death: DEAD, terminal, no dying phase', async () => {
    // 1 HP left; a natural 20 doubles the dice and the spider's bonus is 20: 2 + 20 = 22 damage,
    // overflow 21 against a maximum of 7. (A non-critical hit is capped to half the maximum, so
    // only a critical can overflow a character this way.)
    const scene = await seedScene({ heroHp: 1, spiderDamageBonus: 20 });
    const result = await spiderStrikes(scene, 20);

    expect(result.instantDeath).toBe(true);
    expect(result.targetIsDead).toBe(true);
    expect(deathSaveLogs).toHaveLength(0);
    const status = await statusOf(scene.heroId);
    expect(status).toMatchObject({ currentHp: 0, deathSavesFailures: 3, deathSavesSuccesses: 0 });
    expect(await sheetOf(scene.characterId)).toMatchObject({
      currentHitPoints: 0,
      vitalState: 'dead',
    });
    expect((await sheetOf(scene.characterId)).diedAt).not.toBeNull();
    const encounter = await encounterOf(scene.encounterId);
    expect(encounter).toMatchObject({ status: 'completed', endedReason: 'party_defeated' });
    expect(result.endedReason).toBe('party_defeated');
    const facts = (await consumeDmTacticalFacts(scene.sessionId)).join('\n');
    expect(facts).toContain('massive damage');
    expect(facts).toContain('is DEAD');
  });

  test('the participant the client reads carries the death-save state, in the shape the shared fixture holds', async () => {
    // Server records 2 failures (a melee blow on the body: automatic critical)...
    const scene = await dropHero();
    await giveTurnTo(scene.encounterId, scene.spiderId);
    await executeCombatIntent(
      scene.encounterId,
      { type: 'attack', actorId: scene.spiderId, targetId: scene.heroId, d20: 2 },
      userId,
      'dm',
    );

    // ...and the wire (the same object the combat_state_updated broadcast and the active-combat
    // read carry) says so: this is the object `shared/test-fixtures/dying-participant-wire.ts`
    // was captured from, and the client tests read.
    const state = await stateOf(scene.encounterId);
    const hero = state.participants.find((p) => p.id === scene.heroId)!;
    expect(Object.keys(hero).sort()).toEqual(Object.keys(DYING_SCHOLAR_PARTICIPANT).sort());
    expect(Object.keys(hero.status!).sort()).toEqual(
      Object.keys(DYING_SCHOLAR_PARTICIPANT.status).sort(),
    );
    expect(Object.keys(state.encounter).sort()).toEqual(
      Object.keys(DYING_SCHOLAR_ENCOUNTER).sort(),
    );
    expect(hero.vitalState).toBe(DYING_SCHOLAR_PARTICIPANT.vitalState);
    const { currentHp, maxHp, tempHp, isConscious, deathSavesSuccesses, deathSavesFailures } =
      hero.status!;
    expect({
      currentHp,
      maxHp,
      tempHp,
      isConscious,
      deathSavesSuccesses,
      deathSavesFailures,
    }).toEqual({
      currentHp: DYING_SCHOLAR_PARTICIPANT.status.currentHp,
      maxHp: DYING_SCHOLAR_PARTICIPANT.status.maxHp,
      tempHp: DYING_SCHOLAR_PARTICIPANT.status.tempHp,
      isConscious: DYING_SCHOLAR_PARTICIPANT.status.isConscious,
      deathSavesSuccesses: DYING_SCHOLAR_PARTICIPANT.status.deathSavesSuccesses,
      deathSavesFailures: DYING_SCHOLAR_PARTICIPANT.status.deathSavesFailures,
    });
  });

  // -----------------------------------------------------------------------------------------
  // 2. The player's turn while dying
  // -----------------------------------------------------------------------------------------

  test('the turn order stops on a dying player: no save is rolled for them, and the only legal action is the death save', async () => {
    const scene = await dropHero();

    const state = await stateOf(scene.encounterId);
    expect(state.currentParticipant?.id).toBe(scene.heroId);
    expect(deathSaveLogs).toHaveLength(0);
    const legal = (await getLegalCombatActions(scene.encounterId, userId)) as unknown as {
      actions: Array<{ type: string; label: string }>;
    };
    expect(legal.actions).toEqual([{ type: 'death_save', label: 'Death saving throw' }]);
  });

  test('exactly one death save per player turn: 14 is a success, and the save is the whole turn', async () => {
    const scene = await dropHero();
    const result = await deathSave(scene, 14);

    expect(result.deathSaves).toHaveLength(1);
    expect(result.deathSaves[0]).toMatchObject({
      roll: 14,
      isSuccess: true,
      successes: 1,
      failures: 0,
    });
    expect(deathSaveLogs).toHaveLength(1);
    // The turn ended with the save: the spider holds it now, not the hero.
    expect(result.currentParticipant.id).toBe(scene.spiderId);
    expect((await statusOf(scene.heroId)).deathSavesSuccesses).toBe(1);
    expect((await encounterOf(scene.encounterId)).status).toBe('active');
  });

  test('9 or lower is a failure; a natural 1 is two failures', async () => {
    const scene = await dropHero();
    const nine = await deathSave(scene, 9);
    expect(nine.deathSaves[0]).toMatchObject({ roll: 9, isSuccess: false, failures: 1 });

    await giveTurnTo(scene.encounterId, scene.heroId);
    const one = await deathSave(scene, 1);
    expect(one.deathSaves[0]).toMatchObject({
      roll: 1,
      isCritical: true,
      failures: 3,
      isDead: true,
    });
  });

  test('a natural 20 is 1 HP, conscious, and the tallies reset; the save was the whole turn', async () => {
    const scene = await dropHero();
    await deathSave(scene, 14);
    await giveTurnTo(scene.encounterId, scene.heroId);
    const result = await deathSave(scene, 20);

    expect(result.deathSaves[0]).toMatchObject({ wasRevived: true, newCurrentHp: 1 });
    expect(await statusOf(scene.heroId)).toMatchObject({
      currentHp: 1,
      isConscious: true,
      deathSavesSuccesses: 0,
      deathSavesFailures: 0,
    });
    expect(await sheetOf(scene.characterId)).toMatchObject({
      currentHitPoints: 1,
      isConscious: true,
      vitalState: 'standing',
    });
    // The turn ended; the fight goes on and the hero acts normally on the NEXT turn.
    expect(result.currentParticipant.id).toBe(scene.spiderId);
    expect((await encounterOf(scene.encounterId)).status).toBe('active');
  });

  test('three failures are death: DEAD, terminal, the encounter ends as party_defeated', async () => {
    const scene = await dropHero();
    for (const d20 of [5, 6]) {
      await deathSave(scene, d20);
      await giveTurnTo(scene.encounterId, scene.heroId);
    }
    const third = await deathSave(scene, 4);

    expect(third.deathSaves[0]).toMatchObject({ failures: 3, isDead: true });
    expect(third.combatEnded).toBe(true);
    expect(third.endedReason).toBe('party_defeated');
    expect(await sheetOf(scene.characterId)).toMatchObject({ vitalState: 'dead' });
    expect((await encounterOf(scene.encounterId)).endedReason).toBe('party_defeated');
    const facts = (await consumeDmTacticalFacts(scene.sessionId)).join('\n');
    expect(facts).toContain('is DEAD');
  });

  test('a death save out of turn, or from a character who is not dying, is refused', async () => {
    const scene = await dropHero();
    await giveTurnTo(scene.encounterId, scene.spiderId);
    await expect(deathSave(scene, 14)).rejects.toThrow('Actor is not the current-turn participant');
    expect(deathSaveLogs).toHaveLength(0);
  });

  // -----------------------------------------------------------------------------------------
  // 3. A downed player cannot act
  // -----------------------------------------------------------------------------------------

  test('an action by a dying player is refused (an unconscious creature cannot act), and so is ending the turn', async () => {
    const scene = await dropHero();

    await expect(
      executeCombatIntent(
        scene.encounterId,
        { type: 'attack', actorId: scene.heroId, targetId: scene.spiderId, d20: 15 },
        userId,
        'dm',
      ),
    ).rejects.toThrow('A downed character cannot act');
    await expect(
      executeCombatIntent(
        scene.encounterId,
        { type: 'end_turn', actorId: scene.heroId },
        userId,
        'dm',
      ),
    ).rejects.toThrow('a death saving throw is owed');
    // Nothing moved: the save is still owed.
    expect((await stateOf(scene.encounterId)).currentParticipant?.id).toBe(scene.heroId);
    expect(deathSaveLogs).toHaveLength(0);
  });

  test("the DM naming the spider's action cannot skip a dying player's save", async () => {
    const scene = await dropHero();
    // The DM declares the spider's attack while the dying hero holds the turn. The turn cycle
    // tolerance absorbs a missing end_turn for a creature that spent its action; it must not
    // absorb a save nobody has rolled.
    await expect(
      executeCombatIntent(
        scene.encounterId,
        { type: 'attack', actorId: scene.spiderId, targetId: scene.heroId, d20: 15 },
        userId,
        'dm',
      ),
    ).rejects.toThrow('Actor is not the current-turn participant');
    expect((await stateOf(scene.encounterId)).currentParticipant?.id).toBe(scene.heroId);
  });

  // -----------------------------------------------------------------------------------------
  // 4. Monster turns while the player is down
  // -----------------------------------------------------------------------------------------

  test('a melee blow within 5 ft on an unconscious player is an automatic critical hit: two failures, whatever the die', async () => {
    const scene = await dropHero();
    // A natural 2 would miss a normal attack at +5 against AC 11? 2 + 5 = 7 < 11. It is a hit,
    // and a critical, because the target is unconscious and the spider is within 5 ft.
    const result = await spiderStrikes(scene, 2);

    expect(result).toMatchObject({
      hit: true,
      isCritical: true,
      autoCritOnDowned: true,
      deathSaveFailuresAdded: 2,
      deathSavesFailures: 2,
    });
    expect(await statusOf(scene.heroId)).toMatchObject({ deathSavesFailures: 2 });
    const facts = (await consumeDmTacticalFacts(scene.sessionId)).join('\n');
    expect(facts).toContain('strikes the unconscious');
    expect(facts).toContain('automatic critical hit');
    expect(facts).toContain('Two death-save failures');
    expect(facts).toContain('✕✕○');
  });

  test('a ranged hit on an unconscious player is one failure; a ranged critical is two', async () => {
    const scene = await seedScene({ heroHp: 3, spiderRanged: true });
    await spiderStrikes(scene, 15); // drops the hero (3 into 3 HP)
    expect((await statusOf(scene.heroId)).currentHp).toBe(0);

    const ranged = await spiderStrikes(scene, 15);
    expect(ranged).toMatchObject({ hit: true, isCritical: false, deathSaveFailuresAdded: 1 });
    expect(ranged.autoCritOnDowned).toBeUndefined();
    expect((await statusOf(scene.heroId)).deathSavesFailures).toBe(1);

    const critical = await spiderStrikes(scene, 20);
    expect(critical).toMatchObject({ isCritical: true, deathSaveFailuresAdded: 2 });
    // 1 + 2 = 3 failures: dead.
    expect(critical.targetIsDead).toBe(true);
    expect((await encounterOf(scene.encounterId)).endedReason).toBe('party_defeated');
  });

  test('the default monster behaviour keeps attacking the body: the NPC runner strikes a dying player in melee reach', async () => {
    const scene = await dropHero();
    // The hero's turn is spent on the death save (a 12: success), then the spider's turn runs.
    await deathSave(scene, 12);
    const advanced = await advanceNpcTurns(scene.encounterId, userId);

    expect(advanced.results).toHaveLength(1);
    expect(advanced.results[0].action).toMatchObject({
      actor_id: scene.spiderId,
      action_type: 'attack',
      target_ids: [scene.heroId],
    });
    const failures = (await statusOf(scene.heroId)).deathSavesFailures;
    expect(failures).toBeGreaterThanOrEqual(1);
    // And the turn comes back to the hero, who owes the next save: the monsters acted BETWEEN
    // the two saves, not inside one resolution.
    if (!advanced.combatEnded) expect(advanced.currentParticipant?.id).toBe(scene.heroId);
    expect(advanced.currentParticipant?.vitalState ?? 'dead').toMatch(/dying|dead/);
  });

  test('a creature whose bible says it does not finish the fallen leaves the body alone', async () => {
    const scene = await dropHero();
    await deathSave(scene, 12);
    const advanced = await advanceNpcTurns(scene.encounterId, userId, {
      // The authored behaviour rides on the participant the runner reads (npc.stats in production).
      getCombatState: async (encounterId, uid) => {
        const state = await CombatEncounterService.getCombatState(encounterId, uid);
        for (const participant of state.participants) {
          if (participant.id === scene.spiderId) {
            (participant as { downedBehavior?: string }).downedBehavior = 'ignore';
          }
        }
        return state;
      },
      getDefaultWeapon: async () => ({
        id: 'fangs',
        name: 'Fangs',
        damageDice: '1d1',
        damageType: 'piercing',
        normalRange: 5,
        magicBonus: 0,
        finesse: false,
        ranged: false,
        proficient: true,
      }),
      executeIntent: async (encounterId, intent, uid, source, startedAt) =>
        executeCombatIntent(encounterId, intent, uid, source, startedAt),
      recordDownedChoice: async () => {},
    });

    expect(advanced.results).toHaveLength(1);
    expect(advanced.results[0].action.action_type).toBe('end_turn');
    expect((await statusOf(scene.heroId)).deathSavesFailures).toBe(0);
    // The save is owed again on the hero's next turn.
    expect(advanced.currentParticipant?.id).toBe(scene.heroId);
  });

  // -----------------------------------------------------------------------------------------
  // 5. Stable, with nobody left to fight beside the player
  // -----------------------------------------------------------------------------------------

  test('three successes: stable, the encounter ends as player_down_stable, the engine rolls 1d4 hours and wakes the hero on 1 HP', async () => {
    const scene = await dropHero();
    // 0.3 -> floor(0.3 * 4) + 1 = 2 hours.
    const random = spyOn(Math, 'random');
    try {
      await deathSave(scene, 12);
      await giveTurnTo(scene.encounterId, scene.heroId);
      await deathSave(scene, 13);
      await giveTurnTo(scene.encounterId, scene.heroId);
      random.mockReturnValue(0.3);
      const third = await deathSave(scene, 15);

      expect(third.deathSaves[0]).toMatchObject({ successes: 3, isStabilized: true });
      expect(third.combatEnded).toBe(true);
      expect(third.endedReason).toBe('player_down_stable');
      expect(third.wake).toEqual([{ participantId: scene.heroId, name: 'The Scholar', hours: 2 }]);
    } finally {
      random.mockRestore();
    }

    // No death screen: the character is alive, awake and on 1 HP, in the sheet and the tracker.
    expect(await sheetOf(scene.characterId)).toMatchObject({
      currentHitPoints: 1,
      isConscious: true,
      vitalState: 'standing',
      deathSavesSuccesses: 0,
      deathSavesFailures: 0,
    });
    expect(await statusOf(scene.heroId)).toMatchObject({ currentHp: 1, isConscious: true });
    const encounter = await encounterOf(scene.encounterId);
    expect(encounter).toMatchObject({ status: 'completed', endedReason: 'player_down_stable' });
    // The DM is handed the "you wake" prompt with the elapsed time, and it is not a death.
    const facts = (await consumeDmTacticalFacts(scene.sessionId)).join('\n');
    expect(facts).toContain('2 hours');
    expect(facts).toContain('nobody died');
    expect(facts).toContain('wake with 1 HP');
    expect(await loadActiveTacticalMap(scene.sessionId)).toBeNull();
  });

  test('a stable player with a standing ally does not end the fight', async () => {
    const scene = await seedScene({ heroHp: 3, extraAlly: true });
    await spiderStrikes(scene, 15);
    // The ally's turn comes and goes; the hero's next turn holds the first save.
    await giveTurnTo(scene.encounterId, scene.heroId);
    for (const d20 of [12, 13]) {
      await deathSave(scene, d20);
      await giveTurnTo(scene.encounterId, scene.heroId);
    }
    const third = await deathSave(scene, 15);

    expect(third.deathSaves[0]).toMatchObject({ isStabilized: true });
    expect(third.combatEnded).toBeUndefined();
    expect((await encounterOf(scene.encounterId)).status).toBe('active');
    // Still unconscious, still stable, no wake: the fight is not over.
    expect(await statusOf(scene.heroId)).toMatchObject({ currentHp: 0, isConscious: false });
  });

  test('stabilising effect (Medicine DC 10): stable, and a hit on a stable character is dying again', async () => {
    const scene = await seedScene({ heroHp: 3, extraAlly: true });
    await spiderStrikes(scene, 15);
    const stabilised = await CombatHPService.stabilizeWithMedicine(
      scene.heroId,
      scene.encounterId,
      12,
      0,
      userId,
    );
    expect(stabilised.success).toBe(true);
    const stable = (await stateOf(scene.encounterId)).participants.find(
      (p) => p.id === scene.heroId,
    )!;
    expect(stable.vitalState).toBe('stabilized');
    expect(await sheetOf(scene.characterId)).toMatchObject({ vitalState: 'stabilized' });

    // A hit on the body: one failure and the tallies start over: dying again.
    await giveTurnTo(scene.encounterId, scene.spiderId);
    await executeCombatIntent(
      scene.encounterId,
      { type: 'attack', actorId: scene.spiderId, targetId: scene.heroId, d20: 15 },
      userId,
      'dm',
    );
    const status = await statusOf(scene.heroId);
    expect(status).toMatchObject({ deathSavesSuccesses: 0, deathSavesFailures: 2 });
    const hit = (await stateOf(scene.encounterId)).participants.find((p) => p.id === scene.heroId)!;
    expect(hit.vitalState).toBe('dying');
  });

  // -----------------------------------------------------------------------------------------
  // 6. Healing
  // -----------------------------------------------------------------------------------------

  test('any healing while dying: conscious on that HP, the tallies reset', async () => {
    const scene = await dropHero();
    await deathSave(scene, 5); // one failure on the board
    expect((await statusOf(scene.heroId)).deathSavesFailures).toBe(1);

    const healed = await CombatHPService.healDamage(
      scene.heroId,
      scene.encounterId,
      2,
      'a potion',
      userId,
    );
    expect(healed).toMatchObject({ wasRevived: true, newCurrentHp: 2, isConscious: true });
    expect(await statusOf(scene.heroId)).toMatchObject({
      currentHp: 2,
      isConscious: true,
      deathSavesSuccesses: 0,
      deathSavesFailures: 0,
    });
    expect(await sheetOf(scene.characterId)).toMatchObject({
      currentHitPoints: 2,
      vitalState: 'standing',
    });
  });

  test('the dead stay dead: healing a character on three failures revives nobody', async () => {
    const scene = await seedScene({ heroHp: 1, spiderDamageBonus: 20 });
    await spiderStrikes(scene, 20);
    const healed = await CombatHPService.healDamage(
      scene.heroId,
      scene.encounterId,
      5,
      'a potion',
      userId,
    );
    expect(healed).toMatchObject({ wasRevived: false, newCurrentHp: 0, healingApplied: 0 });
    expect(await sheetOf(scene.characterId)).toMatchObject({ vitalState: 'dead' });
  });

  test('the round-start condition expiry (advanceConditionDurations) never lifts unconscious from a dying player', async () => {
    // Unconscious is derived from the status row, not stored as a condition row, so the
    // duration sweep that expires timed conditions has nothing to expire for a dying player.
    const scene = await dropHero();
    expect(await getActiveConditionNames(scene.heroId)).toContain('unconscious');
    await ConditionsService.advanceConditionDurations(scene.encounterId, 99);
    expect(await getActiveConditionNames(scene.heroId)).toContain('unconscious');
    const state = await stateOf(scene.encounterId);
    expect(state.participants.find((p) => p.id === scene.heroId)?.vitalState).toBe('dying');
  });

  // -----------------------------------------------------------------------------------------
  // 6. Every writer goes through the one dying transition (run D8, #2622)
  // -----------------------------------------------------------------------------------------

  test('D8: a non-attack writer takes a 7 HP player to 0: a dying line, the combat row written, no silent HP change, and the fight stays open', async () => {
    const scene = await seedScene({ heroHp: 7 });
    const damageRowsBefore = (
      await db
        .select()
        .from(combatDamageLog)
        .where(eq(combatDamageLog.encounterId, scene.encounterId))
    ).length;

    const { vitals, engineLines } = await applyNonAttackDamage(
      scene.characterId,
      userId,
      7,
      'collapsing ceiling',
    );

    // The combat row is what the tracker and the turn order read, and it was written (before this
    // fix only the sheet moved, so the fight carried on as if the player stood at 7 HP).
    expect(await statusOf(scene.heroId)).toMatchObject({
      currentHp: 0,
      isConscious: false,
      deathSavesSuccesses: 0,
      deathSavesFailures: 0,
    });
    expect(vitals).toMatchObject({ currentHitPoints: 0, vitalState: 'dying' });
    expect(await sheetOf(scene.characterId)).toMatchObject({
      currentHitPoints: 0,
      vitalState: 'dying',
    });
    const hero = (await stateOf(scene.encounterId)).participants.find(
      (p) => p.id === scene.heroId,
    )!;
    expect(hero.vitalState).toBe('dying');

    // The engine line the player reads is the one the DM is handed, and the HP change is logged.
    expect(engineLines).toHaveLength(1);
    expect(engineLines[0]).toContain('The Scholar has dropped to 0 HP and is UNCONSCIOUS');
    expect((await consumeDmTacticalFacts(scene.sessionId)).join('\n')).toContain(engineLines[0]);
    const damageRows = await db
      .select()
      .from(combatDamageLog)
      .where(eq(combatDamageLog.encounterId, scene.encounterId));
    expect(damageRows.length).toBe(damageRowsBefore + 1);
    expect(damageRows.at(-1)).toMatchObject({ damageAmount: 7 });

    // Combat does not conclude while the player is dying: they owe a save, and it is accepted.
    expect((await encounterOf(scene.encounterId)).status).toBe('active');
    const saved = await deathSave(scene, 12);
    expect(saved.combatEnded).not.toBe(true);
    expect((await encounterOf(scene.encounterId)).status).toBe('active');

    // More damage at 0 HP is a failure with its own line, from the same writer.
    const again = await applyNonAttackDamage(scene.characterId, userId, 2, 'falling rubble');
    expect(again.engineLines[0]).toContain('takes damage at 0 HP');
    expect(await statusOf(scene.heroId)).toMatchObject({ currentHp: 0, deathSavesFailures: 1 });
  });

  test('a non-attack hit that clears the maximum from partial HP is instant death, with its line', async () => {
    const scene = await seedScene({ heroHp: 3 });
    const { vitals, engineLines } = await applyNonAttackDamage(
      scene.characterId,
      userId,
      3 + HERO_MAX_HP,
      'a long fall',
    );
    expect(vitals.vitalState).toBe('dead');
    expect(engineLines[0]).toContain('takes massive damage');
    expect(await statusOf(scene.heroId)).toMatchObject({ currentHp: 0, deathSavesFailures: 3 });
  });

  test('a status patch that takes a character to 0 HP is damage: the same transition and the same line', async () => {
    const scene = await seedScene({ heroHp: 7 });
    await updateCombatParticipantStatus(
      scene.heroId,
      { currentHp: 0, isConscious: true, deathSavesFailures: 0 },
      userId,
    );
    // The raw columns the patch carried do not win: unconscious and dying are the transition's.
    expect(await statusOf(scene.heroId)).toMatchObject({ currentHp: 0, isConscious: false });
    expect(await sheetOf(scene.characterId)).toMatchObject({ vitalState: 'dying' });
    expect((await consumeDmTacticalFacts(scene.sessionId)).join('\n')).toContain('dropped to 0 HP');
  });

  test('out of a fight the same writer starts the dying state and reports the line', async () => {
    const scene = await seedScene({ heroHp: 4 });
    await db
      .update(combatEncounters)
      .set({ status: 'completed' })
      .where(eq(combatEncounters.id, scene.encounterId));
    const { vitals, engineLines } = await applyNonAttackDamage(
      scene.characterId,
      userId,
      4,
      'poison',
    );
    expect(vitals).toMatchObject({ currentHitPoints: 0, isConscious: false, vitalState: 'dying' });
    expect(engineLines[0]).toContain('dropped to 0 HP');
  });

  // -----------------------------------------------------------------------------------------
  // 7. One save per turn is atomic
  // -----------------------------------------------------------------------------------------

  test('two death-save commits for the same turn: one is accepted, the other is refused, and one save is recorded', async () => {
    const scene = await dropHero();
    const outcomes = await Promise.allSettled([deathSave(scene, 14), deathSave(scene, 3)]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const status = await statusOf(scene.heroId);
    expect(status.deathSavesSuccesses + status.deathSavesFailures).toBe(1);
    expect(deathSaveLogs).toHaveLength(1);
  });

  test('the compare-and-set itself: a save that read stale tallies is refused', async () => {
    const scene = await dropHero();
    await deathSave(scene, 14);
    // A second writer holding the pre-save tallies (0, 0) must not land its roll.
    await expect(
      CombatHPService.rollDeathSave(scene.heroId, scene.encounterId, userId, 3, {
        successes: 0,
        failures: 0,
      }),
    ).rejects.toThrow(/already recorded/);
  });

  // -----------------------------------------------------------------------------------------
  // 8. Endings: the order of claim and wake, and a win with a player on the floor
  // -----------------------------------------------------------------------------------------

  const fellSpider = async (spiderId: string) =>
    db
      .update(combatParticipantStatus)
      .set({ currentHp: 0, isConscious: false })
      .where(eq(combatParticipantStatus.participantId, spiderId));

  test('the last hostile falls while the player is dying: the fight stays open until they are stable, then they wake', async () => {
    const scene = await dropHero();
    await fellSpider(scene.spiderId);
    const first = await deathSave(scene, 12);
    expect(first.combatEnded).not.toBe(true);
    expect((await encounterOf(scene.encounterId)).status).toBe('active');
    await giveTurnTo(scene.encounterId, scene.heroId);
    await deathSave(scene, 13);
    await giveTurnTo(scene.encounterId, scene.heroId);
    const third = await deathSave(scene, 15);
    expect(third.deathSaves[0]).toMatchObject({ isStabilized: true });
    expect(third.combatEnded).toBe(true);
    expect(third.endedReason).toBe('last_hostile_defeated');
    expect(third.wake).toHaveLength(1);
    // Not stranded at 0 HP: a victory with a stable player wakes them (1 HP, conscious).
    expect(await statusOf(scene.heroId)).toMatchObject({ currentHp: 1, isConscious: true });
    expect(await sheetOf(scene.characterId)).toMatchObject({ vitalState: 'standing' });
    expect((await consumeDmTacticalFacts(scene.sessionId)).join('\n')).toContain('wake with 1 HP');
  });

  test('run D8, shaped like its log: an NPC strike for 3 at 3 HP inside advance-npc-turns leaves {0,0}, rolls no save in that request, stops at the player, and the fight stays open', async () => {
    const scene = await seedScene({ heroHp: 3 });
    await giveTurnTo(scene.encounterId, scene.spiderId);
    // d20 = floor(0.7 * 20) + 1 = 15 (a hit on AC 11); 1d1 + 2 = 3 damage.
    const random = spyOn(Math, 'random').mockReturnValue(0.7);
    let advanced: Awaited<ReturnType<typeof advanceNpcTurns>>;
    try {
      advanced = await advanceNpcTurns(scene.encounterId, userId);
    } finally {
      random.mockRestore();
    }

    // On main this request went on to auto-roll three saves (14, 18, 17), stabilise the player
    // and conclude `party_defeated` inside the one call. Here the strike is the whole of it.
    expect(advanced.results).toHaveLength(1);
    expect(advanced.results[0].action).toMatchObject({
      actor_id: scene.spiderId,
      action_type: 'attack',
      target_ids: [scene.heroId],
    });
    expect(await statusOf(scene.heroId)).toMatchObject({
      currentHp: 0,
      isConscious: false,
      deathSavesSuccesses: 0,
      deathSavesFailures: 0,
    });
    expect(deathSaveLogs).toHaveLength(0);
    expect(JSON.stringify(advanced)).not.toContain('"deathSaves"');
    expect(advanced.combatEnded).toBe(false);
    expect(advanced.currentParticipant?.id).toBe(scene.heroId);
    expect((await encounterOf(scene.encounterId)).status).toBe('active');
    expect((await sheetOf(scene.characterId)).vitalState).toBe('dying');

    // Asking the loop again changes nothing: it is the player's turn, and it is not the loop's
    // to roll their save.
    const again = await advanceNpcTurns(scene.encounterId, userId);
    expect(again.results).toHaveLength(0);
    expect(deathSaveLogs).toHaveLength(0);
    expect(await statusOf(scene.heroId)).toMatchObject({
      deathSavesSuccesses: 0,
      deathSavesFailures: 0,
    });
    expect((await encounterOf(scene.encounterId)).status).toBe('active');
  });

  test('run D8 continued: the player rolls their own saves, one per turn; stable and alone ends player_down_stable, never party_defeated', async () => {
    const scene = await seedScene({ heroHp: 3 });
    await giveTurnTo(scene.encounterId, scene.spiderId);
    const random = spyOn(Math, 'random').mockReturnValue(0.7);
    try {
      await advanceNpcTurns(scene.encounterId, userId);
    } finally {
      random.mockRestore();
    }
    // Three player-rolled successes (14, 18, 17: the log's rolls), each on the player's own turn,
    // with the monsters' turns in between. The spider's blow on the body is set aside here by
    // downing its attack: it ignores the fallen.
    await db
      .update(combatParticipants)
      .set({ monsterAttack: null })
      .where(eq(combatParticipants.id, scene.spiderId));
    const finalSave = async () => {
      let last: Record<string, any> | undefined;
      for (const roll of [14, 18, 17]) {
        await giveTurnTo(scene.encounterId, scene.heroId);
        last = await deathSave(scene, roll);
      }
      return last!;
    };
    const third = await finalSave();
    expect(deathSaveLogs).toHaveLength(3);
    expect(third.endedReason).toBe('player_down_stable');
    expect(third.endedReason).not.toBe('party_defeated');
    expect(third.wake).toHaveLength(1);
    expect(await statusOf(scene.heroId)).toMatchObject({ currentHp: 1, isConscious: true });
    expect(await encounterOf(scene.encounterId)).toMatchObject({
      status: 'completed',
      endedReason: 'player_down_stable',
    });
  });

  // -----------------------------------------------------------------------------------------
  // 9. Flee / Yield (#2580): a player downed by the opportunity attack enters THIS dying flow
  // -----------------------------------------------------------------------------------------

  test('a player downed by the opportunity attack on Flee is dying {0,0}, stays in the order, owes a save, and is not an exit', async () => {
    const scene = await seedScene({ heroHp: 3 });
    const encounter = await encounterOf(scene.encounterId);
    // Math.random pinned high: the reaction's d20 is a natural 20, so the blow lands and downs them.
    const random = spyOn(Math, 'random').mockReturnValue(0.99);
    try {
      await executeCombatIntent(
        scene.encounterId,
        { type: 'flee', actorId: scene.heroId, expectedVersion: encounter.version },
        userId,
        'player',
        Date.now(),
        'action_bar',
      );
    } finally {
      random.mockRestore();
    }

    // The flee did not take them out of the order: they are dying, at 0 HP, unconscious.
    expect(await statusOf(scene.heroId)).toMatchObject({
      currentHp: 0,
      isConscious: false,
      deathSavesSuccesses: 0,
      deathSavesFailures: 0,
    });
    const [seat] = await db
      .select({ isActive: combatParticipants.isActive })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, scene.heroId));
    expect(seat.isActive).toBe(true);
    const hero = (await stateOf(scene.encounterId)).participants.find(
      (p) => p.id === scene.heroId,
    )!;
    expect(hero.vitalState).toBe('dying');
    expect(await sheetOf(scene.characterId)).toMatchObject({ vitalState: 'dying' });
    expect((await encounterOf(scene.encounterId)).status).toBe('active');
    const facts = (await consumeDmTacticalFacts(scene.sessionId)).join('\n');
    expect(facts).toContain('UNCONSCIOUS');
    expect(facts).not.toContain('flees the fight');

    // Nobody rolled a save for them, and when the turn is theirs the only legal action is the
    // death save, which the player rolls and which works.
    expect(deathSaveLogs).toHaveLength(0);
    await giveTurnTo(scene.encounterId, scene.heroId);
    const legal = (await getLegalCombatActions(scene.encounterId, userId)) as unknown as {
      actions: Array<{ type: string }>;
    };
    expect(legal.actions.map((action) => action.type)).toEqual(['death_save']);
    const saved = await deathSave(scene, 14);
    expect(saved.deathSaves[0]).toMatchObject({ roll: 14, successes: 1 });
    expect(deathSaveLogs).toHaveLength(1);
    expect((await encounterOf(scene.encounterId)).status).toBe('active');
  });

  // -----------------------------------------------------------------------------------------
  // 10. Out of a fight, damage at 0 HP is the same rule (round 4, item 1)
  // -----------------------------------------------------------------------------------------

  test('out of combat: 7 HP to 0, then damage at 0 HP is a failure, a critical is two, and the third failure is death', async () => {
    const scene = await seedScene({ heroHp: 7 });
    await db
      .update(combatEncounters)
      .set({ status: 'completed' })
      .where(eq(combatEncounters.id, scene.encounterId));
    const hit = (amount: number, critical = false) =>
      applyNonAttackDamage(scene.characterId, userId, amount, 'poison', { critical });

    // 7 -> 0: dying {0,0}, the going-down line, no failure for the blow that dropped them.
    const drop = await hit(7);
    expect(drop.vitals).toMatchObject({
      currentHitPoints: 0,
      isConscious: false,
      vitalState: 'dying',
      deathSavesSuccesses: 0,
      deathSavesFailures: 0,
    });
    expect(drop.engineLines[0]).toContain('dropped to 0 HP');

    // At 0 HP: one failure.
    const first = await hit(1);
    expect(first.vitals).toMatchObject({ vitalState: 'dying', deathSavesFailures: 1 });
    expect(first.engineLines[0]).toContain('takes damage at 0 HP');
    expect(first.engineLines[0]).toContain('1 of 3 failures');

    // A critical hit at 0 HP: two failures, which is the third: dead.
    const crit = await hit(1, true);
    expect(crit.vitals).toMatchObject({ vitalState: 'dead', deathSavesFailures: 3 });
    expect(crit.vitals.diedAt).not.toBeNull();
    expect(crit.engineLines[0]).toContain('DEAD');
    expect(await sheetOf(scene.characterId)).toMatchObject({
      vitalState: 'dead',
      deathSavesFailures: 3,
    });

    // The dead take nothing further.
    const after = await hit(3);
    expect(after.vitals).toMatchObject({ vitalState: 'dead', deathSavesFailures: 3 });
    expect(after.engineLines).toEqual([]);
  });

  test('out of combat: one failure per hit at 0 HP, step by step to dead; massive damage at 0 HP is dead at once', async () => {
    const scene = await seedScene({ heroHp: 7 });
    await db
      .update(combatEncounters)
      .set({ status: 'completed' })
      .where(eq(combatEncounters.id, scene.encounterId));
    const hit = (amount: number) => applyNonAttackDamage(scene.characterId, userId, amount, 'fire');
    await hit(7);
    expect((await hit(1)).vitals.deathSavesFailures).toBe(1);
    expect((await hit(1)).vitals.deathSavesFailures).toBe(2);
    const last = await hit(1);
    expect(last.vitals).toMatchObject({ vitalState: 'dead', deathSavesFailures: 3 });

    const other = await seedScene({ heroHp: 7 });
    await db
      .update(combatEncounters)
      .set({ status: 'completed' })
      .where(eq(combatEncounters.id, other.encounterId));
    await applyNonAttackDamage(other.characterId, userId, 7, 'fire');
    const massive = await applyNonAttackDamage(other.characterId, userId, HERO_MAX_HP, 'fire');
    expect(massive.vitals).toMatchObject({ vitalState: 'dead' });
  });

  // -----------------------------------------------------------------------------------------
  // 11. The wake runs after the claim, and only for the call that made it (round 4, item 2)
  // -----------------------------------------------------------------------------------------

  const stabiliseHero = async (scene: { encounterId: string; heroId: string }) => {
    await deathSave(scene, 12);
    await giveTurnTo(scene.encounterId, scene.heroId);
    await deathSave(scene, 13);
    await giveTurnTo(scene.encounterId, scene.heroId);
  };

  test('the heal that wakes the player runs only after the encounter is claimed', async () => {
    const scene = await dropHero();
    await stabiliseHero(scene);
    const statusAtHeal: string[] = [];
    const original = CombatHPService.healDamage.bind(CombatHPService);
    const heal = spyOn(CombatHPService, 'healDamage').mockImplementation(async (...args) => {
      statusAtHeal.push((await encounterOf(scene.encounterId)).status);
      return original(...args);
    });
    try {
      const third = await deathSave(scene, 15);
      expect(third.endedReason).toBe('player_down_stable');
    } finally {
      heal.mockRestore();
    }
    // One heal (the wake), and the encounter was already `completed` when it ran.
    expect(statusAtHeal).toEqual(['completed']);
  });

  test('a refused claim wakes nobody: the player stays stable at 0 HP and no heal runs', async () => {
    const scene = await dropHero();
    await stabiliseHero(scene);
    const heal = spyOn(CombatHPService, 'healDamage');
    // Someone else holds the ending: this call's claim of the terminal transition is refused.
    const claim = spyOn(CombatEncounterService, 'endCombat').mockResolvedValue(null as never);
    let third: Record<string, any>;
    try {
      third = await deathSave(scene, 15);
    } finally {
      claim.mockRestore();
    }
    const healCalls = heal.mock.calls.length;
    heal.mockRestore();
    expect(healCalls).toBe(0);
    expect(third.wake ?? []).toEqual([]);
    expect(await statusOf(scene.heroId)).toMatchObject({ currentHp: 0, isConscious: false });
    expect(await sheetOf(scene.characterId)).toMatchObject({ vitalState: 'stabilized' });
  });

  // -----------------------------------------------------------------------------------------
  // 12. A recorded save is not rolled twice when the turn change fails (round 4, item 3)
  // -----------------------------------------------------------------------------------------

  test('a death save is recorded and the turn change throws: the retry does not roll that save again, it finishes the turn', async () => {
    const scene = await dropHero();
    const advance = spyOn(CombatInitiativeService, 'advanceTurn').mockRejectedValueOnce(
      new Error('turn change failed'),
    );
    try {
      await expect(deathSave(scene, 14)).rejects.toThrow('turn change failed');
    } finally {
      advance.mockRestore();
    }
    // The save is on the books: one success, one log line.
    expect(await statusOf(scene.heroId)).toMatchObject({
      deathSavesSuccesses: 1,
      deathSavesFailures: 0,
    });
    expect(deathSaveLogs).toHaveLength(1);

    // The client retries (this time with a die that would be a failure): nothing is rolled.
    const retry = await deathSave(scene, 3);
    expect(retry.deathSaves).toEqual([]);
    expect(deathSaveLogs).toHaveLength(1);
    expect(await statusOf(scene.heroId)).toMatchObject({
      deathSavesSuccesses: 1,
      deathSavesFailures: 0,
    });
    // ...and the retry finished the turn: it is no longer the hero's.
    expect((await stateOf(scene.encounterId)).currentParticipant?.id).not.toBe(scene.heroId);

    // The next turn the hero owes a fresh save, and it rolls.
    await giveTurnTo(scene.encounterId, scene.heroId);
    const next = await deathSave(scene, 15);
    expect(next.deathSaves[0]).toMatchObject({ successes: 2 });
    expect(deathSaveLogs).toHaveLength(2);
  });

  // -----------------------------------------------------------------------------------------
  // 13. Run D9 (#2640): massive damage is the OVERFLOW past 0 HP, and a natural 18 is no crit
  // -----------------------------------------------------------------------------------------

  /** The D9 shape: a 12-max hero at `hp`, and a hit rolled `d20` that deals `damage` unless capped. */
  const d9Strike = async (hp: number, damage: number, d20: number) => {
    // 1d1 + bonus: the damage is arithmetic.
    const scene = await seedScene({ heroHp: hp, heroMax: 12, spiderDamageBonus: damage - 1 });
    const result = await spiderStrikes(scene, d20);
    return { scene, result };
  };

  test('D9: a conscious hero at 1 HP (max 12) hit by a natural 18 takes a NORMAL hit: no critical, dying {0,0}, not dead', async () => {
    const { scene, result } = await d9Strike(1, 12, 18);
    expect(result.isCritical).toBe(false);
    expect(result.instantDeath).toBeUndefined();
    expect(result.targetIsDead).not.toBe(true);
    // Normal dice, and the per-hit cap (half of max) applies to a non-critical blow.
    expect(result.finalDamage).toBe(6);
    expect(await statusOf(scene.heroId)).toMatchObject({
      currentHp: 0,
      isConscious: false,
      deathSavesSuccesses: 0,
      deathSavesFailures: 0,
    });
    expect(await sheetOf(scene.characterId)).toMatchObject({ vitalState: 'dying' });
    const facts = (await consumeDmTacticalFacts(scene.sessionId)).join('\n');
    expect(facts).not.toContain('CRITICAL HIT');
    expect(facts).not.toContain('massive damage');
  });

  test('D9: a real natural 20 critical totalling 12 at 1 HP (max 12) leaves 11 damage over: dying, and the line says so', async () => {
    // 1d1 doubled is 2, plus 10: 12 in all.
    const { scene, result } = await d9Strike(1, 11, 20);
    expect(result.isCritical).toBe(true);
    expect(result.finalDamage).toBe(12);
    expect(result.instantDeath).toBeUndefined();
    expect(await statusOf(scene.heroId)).toMatchObject({
      currentHp: 0,
      deathSavesSuccesses: 0,
      deathSavesFailures: 0,
    });
    expect(
      (await stateOf(scene.encounterId)).participants.find((p) => p.id === scene.heroId)
        ?.vitalState,
    ).toBe('dying');
    const facts = (await consumeDmTacticalFacts(scene.sessionId)).join('\n');
    expect(facts).toContain('11 damage remains; HP max 12 — dying');
    expect(facts).not.toContain('massive damage');
  });

  test('D9: a critical totalling 13 at 1 HP (max 12) leaves 12 over, which is the maximum: dead, and the line states the numbers', async () => {
    const { scene, result } = await d9Strike(1, 12, 20);
    expect(result.isCritical).toBe(true);
    expect(result.finalDamage).toBe(13);
    expect(result.instantDeath).toBe(true);
    expect(await statusOf(scene.heroId)).toMatchObject({ currentHp: 0, deathSavesFailures: 3 });
    const facts = (await consumeDmTacticalFacts(scene.sessionId)).join('\n');
    expect(facts).toContain('12 damage remains after 0 HP, and the hit point maximum is 12');
  });

  test('D9: a stale is_conscious=false on a hero WITH hit points left is not "unconscious": a natural 18 is a normal hit', async () => {
    const scene = await seedScene({ heroHp: 1, heroMax: 12, spiderDamageBonus: 11 });
    // The inconsistent row: hit points left, but the column still says unconscious.
    await db
      .update(combatParticipantStatus)
      .set({ isConscious: false })
      .where(eq(combatParticipantStatus.participantId, scene.heroId));
    expect(await getActiveConditionNames(scene.heroId)).not.toContain('unconscious');
    const result = await spiderStrikes(scene, 18);
    expect(result.isCritical).toBe(false);
    expect(result.autoCritOnDowned).toBeUndefined();
    expect(result.finalDamage).toBe(6);
    expect(result.instantDeath).toBeUndefined();
  });

  test('D9 through the non-attack writer: 12 at 1 HP (max 12) is dying with the numbers; 13 is dead; both in and out of a fight', async () => {
    for (const inFight of [true, false]) {
      const dying = await seedScene({ heroHp: 1, heroMax: 12 });
      const dead = await seedScene({ heroHp: 1, heroMax: 12 });
      if (!inFight) {
        for (const scene of [dying, dead]) {
          await db
            .update(combatEncounters)
            .set({ status: 'completed' })
            .where(eq(combatEncounters.id, scene.encounterId));
        }
      }
      const twelve = await applyNonAttackDamage(dying.characterId, userId, 12, 'fall');
      expect(twelve.vitals).toMatchObject({
        currentHitPoints: 0,
        vitalState: 'dying',
        deathSavesFailures: 0,
      });
      expect(twelve.engineLines[0]).toContain('11 damage remains; HP max 12 — dying');

      const thirteen = await applyNonAttackDamage(dead.characterId, userId, 13, 'fall');
      expect(thirteen.vitals).toMatchObject({ vitalState: 'dead', deathSavesFailures: 3 });
      expect(thirteen.engineLines[0]).toContain(
        '12 damage remains after 0 HP, and the hit point maximum is 12',
      );
    }
  });

  test('D9 through the non-attack writer, hero ALREADY at 0 HP (max 12): 12 is dead with three failures and the numbers; 11 stays dying; in and out of a fight', async () => {
    for (const inFight of [true, false]) {
      const dying = await seedScene({ heroHp: 0, heroMax: 12 });
      const dead = await seedScene({ heroHp: 0, heroMax: 12 });
      for (const scene of [dying, dead]) {
        // A player at 0 HP is dying on the sheet too (the dying transition wrote it).
        await db
          .update(characterStats)
          .set({ vitalState: 'dying' })
          .where(eq(characterStats.characterId, scene.characterId));
        if (!inFight) {
          await db
            .update(combatEncounters)
            .set({ status: 'completed' })
            .where(eq(combatEncounters.id, scene.encounterId));
        }
      }

      const eleven = await applyNonAttackDamage(dying.characterId, userId, 11, 'fall');
      expect(eleven.vitals).toMatchObject({ vitalState: 'dying', deathSavesFailures: 1 });
      expect(eleven.engineLines[0]).toContain('takes damage at 0 HP');

      const twelve = await applyNonAttackDamage(dead.characterId, userId, 12, 'fall');
      expect(twelve.vitals).toMatchObject({ vitalState: 'dead', deathSavesFailures: 3 });
      expect(twelve.engineLines).toHaveLength(1);
      expect(twelve.engineLines[0]).toContain(
        '12 damage remains after 0 HP, and the hit point maximum is 12',
      );
      expect(twelve.engineLines[0]).toContain('DEAD');
    }
  });

  test('a fractional amount is truncated the way the sheet truncates it: 12.9 at 0 HP (max 12) is 12, dead', async () => {
    const scene = await seedScene({ heroHp: 0, heroMax: 12 });
    await db
      .update(characterStats)
      .set({ vitalState: 'dying' })
      .where(eq(characterStats.characterId, scene.characterId));
    await db
      .update(combatEncounters)
      .set({ status: 'completed' })
      .where(eq(combatEncounters.id, scene.encounterId));
    const result = await applyNonAttackDamage(scene.characterId, userId, 12.9, 'fall');
    expect(result.vitals.vitalState).toBe('dead');
    expect(result.engineLines[0]).toContain('12 damage remains after 0 HP');
  });

  test('the engine line says WHY a hit is critical: the auto-critical names the unconscious target; a natural 20 keeps the plain wording', async () => {
    // A non-20 die on an unconscious (dying) hero: critical by the rule, and the line says so.
    const down = await dropHero();
    await consumeDmTacticalFacts(down.sessionId);
    const auto = await spiderStrikes(down, 15);
    expect(auto.isCritical).toBe(true);
    expect(auto.autoCritReason).toBe('unconscious');
    const autoFacts = (await consumeDmTacticalFacts(down.sessionId)).join('\n');
    expect(autoFacts).toContain('CRITICAL HIT (the target is unconscious)');

    // A natural 20 on a conscious hero: critical by the die, plain wording, no reason.
    const standing = await seedScene({ heroHp: 7 });
    const natural = await spiderStrikes(standing, 20);
    expect(natural.isCritical).toBe(true);
    expect(natural.autoCritReason).toBeUndefined();
    const naturalFacts = (await consumeDmTacticalFacts(standing.sessionId)).join('\n');
    expect(naturalFacts).toContain('CRITICAL HIT');
    expect(naturalFacts).not.toContain('the target is unconscious');

    // A natural 20 on an unconscious hero is still the die's critical: plain wording.
    const downToo = await dropHero();
    await consumeDmTacticalFacts(downToo.sessionId);
    const twenty = await spiderStrikes(downToo, 20);
    expect(twenty.autoCritReason).toBeUndefined();
    expect((await consumeDmTacticalFacts(downToo.sessionId)).join('\n')).not.toContain(
      'the target is unconscious)',
    );
  });
});
