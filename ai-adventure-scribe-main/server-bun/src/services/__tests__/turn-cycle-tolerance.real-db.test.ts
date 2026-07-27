/* eslint-disable max-lines -- one fixture (campaign -> character -> session -> encounter ->
   four-participant order) shared by every assertion. Splitting it would mean standing up the
   same five-table chain three times to make three halves of the same point. */
/**
 * The turn cycle stops refusing the DM's mistakes and absorbs them instead.
 *
 * Playtest run 18's encounter 2 was ABANDONED mid-fight: the monster sat at 2 of 11 hit
 * points, no `combat_ended` was ever logged, the row said `completed`, and the next encounter
 * opened with no acknowledgement that a fight had happened. The cause was a run of
 * "Actor is not the current-turn participant" refusals. Since b489957b that message is
 * precise — an unresolvable actor throws a separate 404 — so it genuinely meant the DM had
 * declared an action for a participant whose turn it was not.
 *
 * The DM is `gemini-3.1-flash-lite` and it cannot emit `end_turn`: the `combat_actions`
 * vocabulary has no such action type. Every turn boundary in production is synthesized by the
 * client after an action it accepted, so any path that resolves an action outside that loop
 * leaves a participant that has spent its action sitting as `current` forever. Three previous
 * waves tried to instruct this model out of a habit and lost all three. This one translates
 * instead.
 *
 * What is pinned here:
 *
 *   1. An action for a non-current participant, where the current one has SPENT its action, is
 *      accepted, and the implicit advance is logged.
 *   2. The same action, where the current participant has NOT spent its action, is still
 *      refused with the existing message. That is one creature acting twice in a round — a
 *      real rules violation, and no amount of tolerance should manufacture a turn.
 *   3. The bound: exactly one position. `advanceTurn` refunds the action of whoever it lands
 *      on, so a second step could only ever be taken by skipping a creature that had its whole
 *      turn still to take. A creature two positions away is refused.
 *   4. An `end_turn` is never absorbed — it is itself a turn boundary — and neither is a
 *      player-sourced intent.
 *
 * Real database, not a mock. The behaviour is a sequence of writes across three services —
 * initiative advance, turn-resource reset, death-save settlement — and a mocked `db` returns
 * whatever the test author expected those writes to have produced.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

import { closeRealDb, describeWithDb, hasRealDb, realDb, testId } from './fixtures/real-db.js';
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
const refusalLogs: LogPayload[] = [];

const record = (payload: LogPayload): void => {
  if (payload?.msg === 'DM_IMPLICIT_TURN_ADVANCE') advanceLogs.push(payload);
  if (payload?.msg === 'COMBAT_INTENT_OUT_OF_TURN') refusalLogs.push(payload);
};

const warn = mock(record);

// Every export is stubbed: `mock.module` replaces the module for every importer in the run, so
// a missing child logger becomes a hard "Export named 'combatLogger' not found" elsewhere in
// a directory run rather than a quiet miss in this file.
const stub = () => ({
  info: mock(record),
  warn,
  error: mock(() => {}),
  debug: mock(() => {}),
  child: () => stub(),
});
mock.module('../../lib/logger.js', () => ({
  logger: stub(),
  combatLogger: stub(),
  default: stub(),
}));

const { executeCombatIntent } = await import('../combat/combat-intent-service.js');

if (!hasRealDb) {
  console.warn(
    '[turn-cycle-tolerance] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

describeWithDb(
  'an out-of-turn DM action is absorbed when the current turn is already spent',
  () => {
    const db = hasRealDb ? realDb() : (null as never);
    const userId = testId('turncycle-user');

    let campaignId: string;
    let characterId: string;
    let sessionId: string;
    let encounterId: string;
    /** Turn order 0..3: hero, then three monsters. The hero always acts first. */
    let heroId: string;
    let firstMonsterId: string;
    let secondMonsterId: string;
    let thirdMonsterId: string;

    const MONSTER_HP = 500;

    beforeEach(async () => {
      advanceLogs.length = 0;
      refusalLogs.length = 0;
      if (!hasRealDb) return;
      if (encounterId) {
        // The order is put back to the top with everybody's action refunded, so each test states
        // its own starting position rather than inheriting the previous one's.
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
        .values({ userId, campaignId, name: testId('hero'), level: 5, class: 'Fighter' })
        .returning({ id: characters.id });

      await db.insert(characterStats).values({
        characterId,
        strength: 20,
        armorClass: 15,
        maxHitPoints: 200,
        currentHitPoints: 200,
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

      // Four participants, because the bound on multi-step advancement cannot be stated with
      // two: it takes a creature to pass, a creature to be blocked by, and a creature to be
      // addressed. Hit points are large on both sides so no test in this file can end the fight
      // by accident and change what a later one is looking at.
      const inserted = await db
        .insert(combatParticipants)
        .values([
          {
            encounterId,
            characterId,
            name: 'Cycle Hero',
            participantType: 'player',
            turnOrder: 0,
            initiative: 20,
            armorClass: 15,
            maxHp: 200,
            speed: 30,
          },
          ...[1, 2, 3].map((index) => ({
            encounterId,
            name: `Cycle Golem ${index}`,
            participantType: 'monster',
            turnOrder: index,
            initiative: 20 - index,
            armorClass: 1,
            maxHp: MONSTER_HP,
            speed: 30,
          })),
        ])
        .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });

      const byOrder = new Map(inserted.map((row) => [row.turnOrder, row.id]));
      heroId = byOrder.get(0)!;
      firstMonsterId = byOrder.get(1)!;
      secondMonsterId = byOrder.get(2)!;
      thirdMonsterId = byOrder.get(3)!;

      await db.insert(combatParticipantStatus).values(
        inserted.map((row) => ({
          participantId: row.id,
          currentHp: row.turnOrder === 0 ? 200 : MONSTER_HP,
          maxHp: row.turnOrder === 0 ? 200 : MONSTER_HP,
          isConscious: true,
        })),
      );
    });

    afterAll(async () => {
      if (!hasRealDb) return;
      await db
        .delete(combatParticipantStatus)
        .where(
          inArray(combatParticipantStatus.participantId, [
            heroId,
            firstMonsterId,
            secondMonsterId,
            thirdMonsterId,
          ]),
        );
      await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
      await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
      await db.delete(inventoryItems).where(eq(inventoryItems.characterId, characterId));
      await db.delete(characterStats).where(eq(characterStats.characterId, characterId));
      await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
      await db.delete(characters).where(eq(characters.id, characterId));
      await db.delete(campaigns).where(eq(campaigns.id, campaignId));
      await closeRealDb();
    });

    /** Marks `participantId`'s action as spent, exactly as a resolved attack leaves it. */
    const spendActionOf = async (participantId: string): Promise<void> => {
      await db
        .update(combatParticipants)
        .set({ actionUsed: true })
        .where(eq(combatParticipants.id, participantId));
    };

    const currentTurnOrder = async (): Promise<number> => {
      const [row] = await db
        .select({ order: combatEncounters.currentTurnOrder })
        .from(combatEncounters)
        .where(eq(combatEncounters.id, encounterId));
      return row.order;
    };

    const attackBy = (actorId: string, targetId: string) =>
      executeCombatIntent(encounterId, { type: 'attack', actorId, targetId }, userId, 'dm');

    test('the DM acts for the next creature without ending the turn, and it is accepted', async () => {
      // The exact production shape: the hero's action was resolved by a path that never ended
      // the turn, so the hero is still `current` with `action_used` set, and the DM's next
      // declaration is for the monster after it.
      await spendActionOf(heroId);
      expect(await currentTurnOrder()).toBe(0);

      await attackBy(firstMonsterId, heroId);

      expect(await currentTurnOrder()).toBe(1);
      expect(advanceLogs).toHaveLength(1);
      expect(advanceLogs[0]).toMatchObject({
        addressedActorId: firstMonsterId,
        turnWasActorId: heroId,
        positionsAdvanced: 1,
        intentType: 'attack',
      });
      // Who was passed is named, not merely counted: the log is read against DM transcripts to
      // work out which creature lost a turn, and a count cannot answer that.
      expect(advanceLogs[0].skipped).toEqual([{ id: heroId, slug: null }]);
    });

    test('the same action is still refused when the current participant has NOT acted', async () => {
      // Nothing has spent an action. This is the DM trying to make one creature act twice in a
      // round, and it must keep failing exactly as it does today.
      expect(await currentTurnOrder()).toBe(0);

      await expect(attackBy(firstMonsterId, heroId)).rejects.toThrow(
        'Actor is not the current-turn participant',
      );

      expect(await currentTurnOrder()).toBe(0);
      expect(advanceLogs).toHaveLength(0);
      expect(refusalLogs).toHaveLength(1);
    });

    test('THE BOUND: exactly one position — a creature two away is still refused', async () => {
      // The hero has acted; the first monster has not, because advancing onto it is what gives
      // it its action back. The DM addresses the second monster, two positions away. A second
      // step would have to skip the first monster's whole turn, so it is refused, and the
      // refusal names the participant that blocked it.
      await spendActionOf(heroId);

      await expect(attackBy(secondMonsterId, heroId)).rejects.toThrow(
        'Actor is not the current-turn participant',
      );

      // The one position WAS absorbed — the hero genuinely had finished — and the board is left
      // where it now honestly stands rather than rolled back to a position already wrong.
      expect(await currentTurnOrder()).toBe(1);
      expect(advanceLogs).toHaveLength(0);
      expect(refusalLogs).toHaveLength(1);
      expect(refusalLogs[0]).toMatchObject({
        actorId: secondMonsterId,
        currentParticipantId: firstMonsterId,
      });
    });

    test('advancement never laps backwards to a creature already behind the pointer', async () => {
      // Everyone has acted and the DM addresses the hero, which the order has already passed.
      // One step forward lands on the third monster, not the hero, so this refuses rather than
      // walking the order all the way round to hand out a second turn in the same round.
      for (const id of [heroId, firstMonsterId, secondMonsterId, thirdMonsterId])
        await spendActionOf(id);
      await db
        .update(combatEncounters)
        .set({ currentTurnOrder: 2 })
        .where(eq(combatEncounters.id, encounterId));

      await expect(attackBy(heroId, firstMonsterId)).rejects.toThrow(
        'Actor is not the current-turn participant',
      );
      expect(advanceLogs).toHaveLength(0);
      expect(await currentTurnOrder()).toBe(3);
    });

    test('an end_turn is never absorbed, because it is itself a turn boundary', async () => {
      // Absorbing this would consume two turns for one instruction: one to reach the addressed
      // actor, and the one the intent itself asks for.
      await spendActionOf(heroId);

      await expect(
        executeCombatIntent(
          encounterId,
          { type: 'end_turn', actorId: firstMonsterId },
          userId,
          'dm',
        ),
      ).rejects.toThrow('Actor is not the current-turn participant');

      expect(await currentTurnOrder()).toBe(0);
      expect(advanceLogs).toHaveLength(0);
    });

    test('a player-sourced intent is never absorbed; tolerance is for the DM alone', async () => {
      // A player client acting out of turn is a client bug or a race, and it must still be told
      // so. The absorb exists because one specific model cannot emit `end_turn`, not because
      // out-of-turn actions became acceptable.
      await spendActionOf(heroId);

      await expect(
        executeCombatIntent(
          encounterId,
          { type: 'attack', actorId: firstMonsterId, targetId: heroId, expectedVersion: 1 },
          userId,
          'player',
        ),
      ).rejects.toThrow('Actor is not the current-turn participant');

      expect(await currentTurnOrder()).toBe(0);
      expect(advanceLogs).toHaveLength(0);
    });
  },
);
