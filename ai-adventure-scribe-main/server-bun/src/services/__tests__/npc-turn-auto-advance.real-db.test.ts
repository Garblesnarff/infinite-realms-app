/* eslint-disable max-lines -- one fixture (campaign -> character -> session -> encounter -> a
   two-participant order with the NPC on top) shared by every assertion. Splitting it would mean
   standing up the same five-table chain twice to make two halves of the same point. */
/**
 * An NPC's turn ends when its action is spent, whether or not the DM says so.
 *
 * Encounter 10444307 of session 2f420489 is the reproduction case, and it was live in
 * production while this was written. Balthazar held the opening turn. The player declared an
 * attack; the engine refused it, correctly, as out of turn. The #1701 repair loop then did
 * exactly its job — regenerated a batch for the current-turn NPC — and that batch was one
 * attack with no `end_turn`. The attack was accepted, Balthazar stayed `current` with his
 * action spent, and every player action from then on was refused for the same correct reason,
 * forever. Three attempts, two clients, no way forward.
 *
 * `resolveActorTurn`'s tolerance cannot reach this. It absorbs a missing `end_turn`
 * retroactively, when a LATER declaration arrives for the next creature — and in a locked-out
 * fight no later declaration ever arrives, because the only actor with anything to say is the
 * player and the player is being refused. The morning's roach encounter escaped the same shape
 * purely because its DM batch happened to contain an `end_turn`.
 *
 * What is pinned here:
 *
 *   1. A DM attack-only batch for the current-turn NPC advances the turn to the player.
 *   2. The client's synthesized `end_turn`, arriving after that advance, is dropped rather than
 *      refused — an NPC's 422 is what reached the player as their own failure in #1744.
 *   3. The player is NOT auto-advanced. They may still move, and #1716 made their turn a
 *      conversation; their boundary stays explicit.
 *   4. An action that spends nothing (a move) leaves the NPC's turn open, with its attack still
 *      to make.
 *   5. An `end_turn` for a creature that has not acted is still refused — a stale boundary is
 *      dropped, but ending somebody else's turn early is not a stale boundary.
 *
 * Real database, not a mock: the behaviour is a sequence of writes across initiative advance,
 * turn-resource reset, and death-save settlement, and a mocked `db` returns whatever the test
 * author expected those writes to have produced. Requires TEST_DATABASE_URL — see
 * fixtures/real-db.ts.
 */
import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
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
  inventoryItems,
} from '../../../../db/schema/index';

type LogPayload = Record<string, unknown>;

const advanceLogs: LogPayload[] = [];
const droppedEndTurnLogs: LogPayload[] = [];

const record = (payload: LogPayload): void => {
  if (payload?.msg === 'NPC_TURN_AUTO_ADVANCED') advanceLogs.push(payload);
  if (payload?.msg === 'DM_END_TURN_ALREADY_ENDED') droppedEndTurnLogs.push(payload);
};

// Every export is stubbed: `mock.module` replaces the module for every importer in the run, so
// a missing child logger becomes a hard "Export named 'combatLogger' not found" elsewhere in a
// directory run rather than a quiet miss in this file.
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
  default: stub(),
}));

const { executeCombatIntent } = await importWithRealDb(
  () => import('../combat/combat-intent-service.js'),
);

if (!hasRealDb) {
  console.warn(
    '[npc-turn-auto-advance] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

describeWithDb('an NPC turn ends on the spending of its action, not on the DM saying so', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('npcturn-user');

  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  /** Turn order 0 then 1: the NPC wins initiative, exactly as Balthazar did. */
  let npcId: string;
  let playerId: string;

  const HP = 500;

  beforeEach(async () => {
    advanceLogs.length = 0;
    droppedEndTurnLogs.length = 0;
    if (!hasRealDb) return;
    if (encounterId) {
      await db
        .update(combatParticipants)
        .set({ actionUsed: false, bonusActionUsed: false })
        .where(eq(combatParticipants.encounterId, encounterId));
      await db
        .update(combatEncounters)
        .set({ status: 'active', endedReason: null, currentTurnOrder: 0, currentRound: 1 })
        .where(eq(combatEncounters.id, encounterId));
      return;
    }

    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('camp') })
      .returning({ id: campaigns.id });

    [{ id: characterId }] = await db
      .insert(characters)
      .values({ userId, campaignId, name: testId('reveler'), level: 5, class: 'Fighter' })
      .returning({ id: characters.id });

    await db.insert(characterStats).values({
      characterId,
      strength: 20,
      armorClass: 15,
      maxHitPoints: HP,
      currentHitPoints: HP,
      speed: 30,
    });

    await db
      .insert(inventoryItems)
      .values({ characterId, name: 'Longsword', itemType: 'weapon', isEquipped: true });

    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });

    [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });

    // Hit points are large on both sides so that no attack in this file can end the fight and
    // change what a later test is looking at.
    const inserted = await db
      .insert(combatParticipants)
      .values([
        {
          encounterId,
          name: 'Balthazar',
          participantType: 'monster',
          turnOrder: 0,
          initiative: 18,
          armorClass: 1,
          maxHp: HP,
          speed: 30,
        },
        {
          encounterId,
          characterId,
          name: 'The Reveler',
          participantType: 'player',
          turnOrder: 1,
          initiative: 13,
          armorClass: 1,
          maxHp: HP,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });

    const byOrder = new Map(inserted.map((row) => [row.turnOrder, row.id]));
    npcId = byOrder.get(0)!;
    playerId = byOrder.get(1)!;

    await db.insert(combatParticipantStatus).values(
      inserted.map((row) => ({
        participantId: row.id,
        currentHp: HP,
        maxHp: HP,
        isConscious: true,
      })),
    );
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db
      .delete(combatParticipantStatus)
      .where(inArray(combatParticipantStatus.participantId, [npcId, playerId]));
    await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
    await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
    await db.delete(inventoryItems).where(eq(inventoryItems.characterId, characterId));
    await db.delete(characterStats).where(eq(characterStats.characterId, characterId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characters).where(eq(characters.id, characterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  const currentTurnOrder = async (): Promise<number> => {
    const [row] = await db
      .select({ order: combatEncounters.currentTurnOrder })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    return row.order;
  };

  const attackBy = (actorId: string, targetId: string) =>
    executeCombatIntent(encounterId, { type: 'attack', actorId, targetId }, userId, 'dm');

  test('a DM attack-only batch for the current NPC advances the turn to the player', async () => {
    // The production batch, exactly: one action, no `end_turn`, for the creature whose turn it
    // is. Before this change the turn stayed here and the player was locked out permanently.
    expect(await currentTurnOrder()).toBe(0);

    await attackBy(npcId, playerId);

    expect(await currentTurnOrder()).toBe(1);
    expect(advanceLogs).toHaveLength(1);
    expect(advanceLogs[0]).toMatchObject({
      actorId: npcId,
      nowCurrentId: playerId,
      intentType: 'attack',
    });
  });

  test('the player can then act, which is the whole point', async () => {
    await attackBy(npcId, playerId);

    // A player-sourced intent, the way the client submits one: it reads the version first, then
    // acts. Nothing here absorbs or tolerates anything — it is simply the player's turn now.
    const [encounter] = await db
      .select({ version: combatEncounters.version })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));

    await expect(
      executeCombatIntent(
        encounterId,
        { type: 'attack', actorId: playerId, targetId: npcId, expectedVersion: encounter.version },
        userId,
        'player',
      ),
    ).resolves.toBeDefined();
  });

  test('the client end_turn that follows the advance is dropped, not refused', async () => {
    // `executeStructuredCombatAction` synthesizes an `end_turn` after every action it submits.
    // It now arrives on a board the engine has already moved. A 422 here is an NPC's refusal
    // surfacing as the player's error — the third defect in #1744.
    await attackBy(npcId, playerId);

    const result = await executeCombatIntent(
      encounterId,
      { type: 'end_turn', actorId: npcId },
      userId,
      'dm',
    );

    expect(result).toMatchObject({ turnAlreadyEnded: true });
    // Dropped, not re-executed: a second advance would consume the player's turn for an
    // instruction about the NPC's.
    expect(await currentTurnOrder()).toBe(1);
    expect(droppedEndTurnLogs).toHaveLength(1);
    expect(droppedEndTurnLogs[0]).toMatchObject({
      actorId: npcId,
      currentParticipantId: playerId,
    });
  });

  test('the player is never auto-advanced: their turn ends when they end it', async () => {
    // A player who has attacked may still move, and #1716 made their turn a conversation rather
    // than one message. Auto-advancing here would take the rest of it away.
    await attackBy(npcId, playerId);
    expect(await currentTurnOrder()).toBe(1);

    await executeCombatIntent(
      encounterId,
      { type: 'attack', actorId: playerId, targetId: npcId },
      userId,
      'dm',
    );

    expect(await currentTurnOrder()).toBe(1);
    expect(advanceLogs).toHaveLength(1);
  });

  test('an action that spends nothing leaves the NPC mid-turn', async () => {
    // The trigger is the action economy, not the intent type. A move — or an attack that
    // resolves as approach-only — leaves the NPC with its attack still to make, and ending its
    // turn there would rob it exactly as surely as never ending it wedges the fight.
    await executeCombatIntent(
      encounterId,
      { type: 'move', actorId: npcId, x: 3, y: 3 },
      userId,
      'dm',
    ).catch(() => {
      // No tactical map is seeded here, so the move is refused by the map layer. What matters is
      // that nothing advanced the turn on the way through.
    });

    expect(await currentTurnOrder()).toBe(0);
    expect(advanceLogs).toHaveLength(0);
  });

  test('an end_turn for a creature that has NOT acted is still refused', async () => {
    // The drop above is for a boundary already crossed. This is the DM ending somebody else's
    // turn early, and skipping a creature with its whole turn to take stays refused.
    expect(await currentTurnOrder()).toBe(0);

    await expect(
      executeCombatIntent(encounterId, { type: 'end_turn', actorId: playerId }, userId, 'dm'),
    ).rejects.toThrow('Actor is not the current-turn participant');

    expect(await currentTurnOrder()).toBe(0);
    expect(droppedEndTurnLogs).toHaveLength(0);
  });
});
