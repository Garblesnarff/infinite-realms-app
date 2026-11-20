/**
 * #1635: Cunning Action, a Rogue's bonus action from level 2 (Dash, Disengage or Hide).
 *
 * Real database throughout, through `executeCombatIntent` -- the function the intent route calls.
 * Each test builds its own campaign, Rogue, session, encounter and board, so one test's spent
 * bonus action or moved token cannot leak into another.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL -- see fixtures/real-db.ts.
 */
import { afterAll, afterEach, expect, spyOn, test } from 'bun:test';
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

const { consumeDmTacticalFacts } = await importWithRealDb(
  () => import('../combat/tactical-action-service.js'),
);
const { saveTacticalMap, loadActiveTacticalMap } = await importWithRealDb(
  () => import('../combat/tactical-map-store.js'),
);
const { executeCombatIntent, getLegalCombatActions } = await importWithRealDb(
  () => import('../combat/combat-intent-service.js'),
);
const { isHiddenAttacker } = await importWithRealDb(() => import('../combat/combat-turn-flags.js'));

if (!hasRealDb) {
  console.warn(
    '[cunning-action] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

describeWithDb('Cunning Action is a Rogue bonus action (#1635)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('cunning-user');
  const campaignIds: string[] = [];
  const sessionIds: string[] = [];
  const characterIds: string[] = [];

  let sessionId: string;
  let encounterId: string;
  let rogueId: string;
  let goblinId: string;

  /** A fresh campaign, Rogue of `level`, encounter at turn 0, and a board with the Rogue adjacent to a hostile. */
  const build = async (level: number): Promise<void> => {
    const [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('cunning-camp') })
      .returning({ id: campaigns.id });
    campaignIds.push(campaignId);
    const [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId,
        ownerId: userId,
        campaignId,
        name: testId('cunning-rogue'),
        class: 'Rogue',
        level,
        classLevels: [{ className: 'Rogue', level }],
      })
      .returning({ id: characters.id });
    characterIds.push(characterId);
    await db.insert(characterStats).values({
      characterId,
      strength: 8,
      dexterity: 16,
      constitution: 12,
      maxHitPoints: 9,
      currentHitPoints: 9,
      speed: 30,
      armorClass: 14,
    });
    const [{ id: newSessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    sessionId = newSessionId;
    sessionIds.push(sessionId);
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
          name: 'The Rogue',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 14,
          maxHp: 9,
          speed: 30,
        },
        {
          encounterId,
          name: 'Goblin Guard',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 5,
          armorClass: 12,
          maxHp: 20,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
    rogueId = inserted.find((row) => row.turnOrder === 0)!.id;
    goblinId = inserted.find((row) => row.turnOrder === 1)!.id;
    await db.insert(combatParticipantStatus).values([
      { participantId: rogueId, currentHp: 9, maxHp: 9, isConscious: true },
      { participantId: goblinId, currentHp: 20, maxHp: 20, isConscious: true },
    ]);

    // The Rogue at (4,4), the Goblin one cell east at (5,4): inside reach. The board is wide
    // enough that stepping west to (2,4) leaves the Goblin's reach on clear floor.
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
          id: rogueId,
          slug: 'the-rogue',
          x: 4,
          y: 4,
          size: 'medium',
          type: 'pc',
          speedFeet: 30,
          movementRemaining: 30,
        },
        {
          id: goblinId,
          slug: 'goblin-guard',
          x: 5,
          y: 4,
          size: 'medium',
          type: 'monster',
          speedFeet: 30,
          movementRemaining: 30,
        },
      ],
      round: 1,
      sceneDescription: 'Cunning Action gallery',
    });
    await consumeDmTacticalFacts(sessionId);
  };

  const versionOf = async (): Promise<number> => {
    const [row] = await db
      .select({ version: combatEncounters.version })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    return row.version;
  };

  const participantRow = async (id: string) => {
    const [row] = await db
      .select({
        actionUsed: combatParticipants.actionUsed,
        bonusActionUsed: combatParticipants.bonusActionUsed,
        isDisengaged: combatParticipants.isDisengaged,
      })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, id));
    return row;
  };

  const heroCell = async () => {
    const map = await loadActiveTacticalMap(sessionId);
    return map?.entities.find((entity) => entity.id === rogueId);
  };

  /** A Cunning Action intent, sent the way the action bar sends a player chip. */
  const cunning = async (mode: 'dash' | 'disengage' | 'hide') =>
    executeCombatIntent(
      encounterId,
      { type: 'cunning_action', actorId: rogueId, mode, expectedVersion: await versionOf() },
      userId,
      'player',
      Date.now(),
      'action_bar',
    );

  const boardMove = (x: number, y: number) =>
    executeCombatIntent(
      encounterId,
      { type: 'move', actorId: rogueId, x, y },
      userId,
      'player',
      Date.now(),
      'action_bar',
    );

  const randomSpy = (value: number) => spyOn(Math, 'random').mockReturnValue(value);
  afterEach(() => {
    (Math.random as unknown as { mockRestore?: () => void }).mockRestore?.();
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    const encounterRows = await db
      .select({ id: combatEncounters.id })
      .from(combatEncounters)
      .where(inArray(combatEncounters.sessionId, sessionIds));
    const participantRows = await db
      .select({ id: combatParticipants.id })
      .from(combatParticipants)
      .where(
        inArray(
          combatParticipants.encounterId,
          encounterRows.map((row) => row.id),
        ),
      );
    await db.delete(combatParticipantStatus).where(
      inArray(
        combatParticipantStatus.participantId,
        participantRows.map((row) => row.id),
      ),
    );
    await db.delete(narrativeFacts).where(inArray(narrativeFacts.sessionId, sessionIds));
    await db.delete(tacticalMaps).where(inArray(tacticalMaps.sessionId, sessionIds));
    for (const row of encounterRows) {
      await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, row.id));
    }
    await db.delete(combatEncounters).where(inArray(combatEncounters.sessionId, sessionIds));
    await db.delete(gameSessions).where(inArray(gameSessions.id, sessionIds));
    await db.delete(characterStats).where(inArray(characterStats.characterId, characterIds));
    await db.delete(characters).where(inArray(characters.id, characterIds));
    await db.delete(campaigns).where(inArray(campaigns.id, campaignIds));
    await closeRealDb();
  });

  test('Cunning Dash spends the bonus action, not the Action, and doubles movement', async () => {
    await build(2);
    await cunning('dash');
    const row = await participantRow(rogueId);
    expect(row).toMatchObject({ bonusActionUsed: true, actionUsed: false });
    expect((await heroCell())?.movementRemaining).toBe(60);
  });

  test('Cunning Disengage spends the bonus action and marks the Rogue disengaged', async () => {
    await build(2);
    await cunning('disengage');
    const row = await participantRow(rogueId);
    expect(row).toMatchObject({ bonusActionUsed: true, actionUsed: false, isDisengaged: true });
  });

  test('a Cunning Hide that wins sets the same hidden mark a Hide action sets (#1685)', async () => {
    await build(2);
    // A d20 of 20 beats the Goblin's passive Perception, so the hide is won.
    randomSpy(0.99);
    await cunning('hide');
    const row = await participantRow(rogueId);
    expect(row).toMatchObject({ bonusActionUsed: true, actionUsed: false });
    expect(await isHiddenAttacker(encounterId, rogueId)).toBe(true);
  });

  test('a level-1 Rogue is refused in plain words, and nothing is spent', async () => {
    await build(1);
    const before = await versionOf();
    await expect(cunning('dash')).rejects.toThrow(
      'Cunning Action needs a Rogue of level 2 or higher.',
    );
    expect(await participantRow(rogueId)).toMatchObject({ bonusActionUsed: false });
    expect(await versionOf()).toBe(before);
  });

  test('a level-1 Rogue is offered no Cunning Action chip, and a level-2 Rogue is offered all three', async () => {
    await build(1);
    const low = await getLegalCombatActions(encounterId, userId);
    expect(low.actions.filter((action) => action.type === 'cunning_action')).toHaveLength(0);

    await db
      .update(characters)
      .set({ level: 2, classLevels: [{ className: 'Rogue', level: 2 }] })
      .where(eq(characters.id, characterIds[characterIds.length - 1]));
    const high = await getLegalCombatActions(encounterId, userId);
    const modes = high.actions
      .filter((action) => action.type === 'cunning_action')
      .map((action) => (action as { mode?: string }).mode);
    expect(modes.sort()).toEqual(['dash', 'disengage', 'hide']);
  });

  test('a second bonus action in one turn is refused in plain words', async () => {
    await build(2);
    await cunning('dash');
    const before = await versionOf();
    await expect(cunning('disengage')).rejects.toThrow(
      'Cunning Action needs the bonus action, and it is already spent this turn.',
    );
    expect(await versionOf()).toBe(before);
    expect(await participantRow(rogueId)).toMatchObject({ isDisengaged: false });
  });

  test('Cunning Disengage then a move out of reach draws no opportunity attack', async () => {
    await build(2);
    await cunning('disengage');
    randomSpy(0.01);
    await boardMove(2, 4);
    const attacks = (await consumeDmTacticalFacts(sessionId)).filter((fact) =>
      fact.includes('attacked The Rogue'),
    );
    expect(attacks).toHaveLength(0);
    expect((await heroCell())?.x).toBe(2);
  });

  test('control: a move out of reach without Disengage draws the opportunity attack', async () => {
    await build(2);
    randomSpy(0.01);
    await boardMove(2, 4);
    const attacks = (await consumeDmTacticalFacts(sessionId)).filter((fact) =>
      fact.includes('attacked The Rogue'),
    );
    expect(attacks.length).toBeGreaterThan(0);
  });
});
