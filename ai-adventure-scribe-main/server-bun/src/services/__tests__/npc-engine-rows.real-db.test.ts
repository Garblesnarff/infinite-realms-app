import { afterAll, beforeAll, expect, mock, spyOn, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { Elysia } from 'elysia';

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
  characters,
  characterStats,
  gameSessions,
  combatEncounters,
  combatParticipants,
  combatParticipantStatus,
  dialogueHistory,
} from '../../../../db/schema/index';
import { ENEMY_HITS_PLAYER, REEVES } from '../../../../shared/test-fixtures/engine-results';
import { resolveMonsterAttackProfile } from '../combat/monster-attack-profile.js';

const userId = testId('npc-engine-rows-user');
mock.module('../../lib/dice.js', () => ({ rollD20: () => 14 }));
mock.module('../../lib/auth.js', () => ({
  authenticateRequest: async () => ({ user: { userId }, error: null }),
}));
process.env.PORT ??= '8892';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';
const { intentRoutes } = await importWithRealDb(() => import('../../routes/v1/combat/intents.js'));
const { writeNpcEngineRow } = await importWithRealDb(() => import('../combat/npc-engine-row.js'));
const { CombatEncounterService } = await importWithRealDb(
  () => import('../combat/combat-encounter-service.js'),
);
const { SessionMessageService } = await importWithRealDb(
  () => import('../session/session-message-service.js'),
);
const { rooms } = await importWithRealDb(() => import('../collaboration/room-manager.js'));
const { runNpcTurnsToPlayer, resumeStrandedNpcTurns } = await importWithRealDb(
  () => import('../combat/npc-turn-drain.js'),
);
const { getLegalCombatActions } = await importWithRealDb(
  () => import('../combat/combat-intent-service.js'),
);

describeWithDb('server NPC engine rows through the real routes (#2658 step 2)', () => {
  const database = hasRealDb ? realDb() : (null as never);
  let campaignId: string, characterId: string, sessionId: string, encounterId: string;
  let playerId: string;
  const sockets: Array<{ engineRows?: unknown[] }> = [];
  const app = hasRealDb ? new Elysia({ prefix: '/v1/combat' }).use(intentRoutes) : null;
  const post = async (path: string, body: unknown) => {
    const response = await app!.handle(
      new Request(`http://localhost/v1/combat/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(200);
    return response.json();
  };
  const storedRows = () =>
    database
      .select()
      .from(dialogueHistory)
      .where(
        and(eq(dialogueHistory.sessionId, sessionId), eq(dialogueHistory.speakerType, 'system')),
      );
  beforeAll(async () => {
    [{ id: campaignId }] = await database
      .insert(campaigns)
      .values({ userId, name: testId('camp') })
      .returning();
    [{ id: characterId }] = await database
      .insert(characters)
      .values({ userId, campaignId, name: 'The Scholar', class: 'Fighter', level: 1 })
      .returning();
    await database
      .insert(characterStats)
      .values({ characterId, currentHitPoints: 500, maxHitPoints: 500, armorClass: 11 });
    [{ id: sessionId }] = await database
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning();
    [{ id: encounterId }] = await database
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning();
    // Real producer: resolveMonsterAttackProfile, rather than a hand-built partial profile.
    const monsterAttack = resolveMonsterAttackProfile({
      authored: {
        attackName: 'Strike',
        attackBonus: 20,
        damageDice: '1d1 + 2',
        damageType: 'slashing',
      },
    });
    const participants = await database
      .insert(combatParticipants)
      .values([
        {
          encounterId,
          characterId,
          name: 'The Scholar',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 11,
          maxHp: 500,
          speed: 30,
        },
        {
          encounterId,
          name: 'Captain Sarah Reeves',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 15,
          armorClass: 11,
          maxHp: 50,
          speed: 30,
          monsterAttack,
        },
        {
          encounterId,
          name: 'Second Guard',
          participantType: 'monster',
          turnOrder: 2,
          initiative: 10,
          armorClass: 11,
          maxHp: 50,
          speed: 30,
          monsterAttack,
        },
      ])
      .returning();
    playerId = participants[0].id;
    await database.insert(combatParticipantStatus).values(
      participants.map((participant) => ({
        participantId: participant.id,
        currentHp: participant.maxHp,
        maxHp: participant.maxHp,
        isConscious: true,
      })),
    );
    rooms.set(
      sessionId,
      new Set([
        {
          readyState: 1,
          data: { user: { userId, email: '' }, roomId: sessionId, requestId: '' },
          send: (payload) => {
            sockets.push(JSON.parse(String(payload)));
          },
          close: () => {},
        },
      ]),
    );
  });
  afterAll(async () => {
    rooms.delete(sessionId);
    await database.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await database.delete(characters).where(eq(characters.id, characterId));
    await database.delete(campaigns).where(eq(campaigns.id, campaignId));
  });
  test('one End turn triggers two NPC attacks: exactly two rows; response and socket rows equal persisted DB rows', async () => {
    // #2658 step 3: the End turn response itself carries the creatures' turns.
    const ended = await post(`${encounterId}/intent`, {
      intent: { type: 'end_turn', actorId: playerId },
    });
    const advanced = { ...ended.result.npcTurns, engineRows: ended.engineRows };
    expect(advanced.results).toHaveLength(2);
    expect(advanced.results.map((result: any) => result.engineResult.finalDamage)).toEqual([3, 3]);
    const [hp] = await database
      .select()
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, playerId));
    expect(hp.currentHp).toBe(494);
    expect(advanced.results.map((result: any) => result.action.action_type)).toEqual([
      'attack',
      'attack',
    ]);
    const rows = await storedRows();
    expect(rows).toHaveLength(2);
    const wire = rows
      .map((row) => ({
        id: row.id,
        sequence: row.sequenceNumber,
        text: row.message,
        kind: 'npc',
        sessionId: row.sessionId,
        timestamp: row.timestamp!.toISOString(),
        context: row.context,
        actionId: (row.context as { actionId: string }).actionId,
      }))
      .sort((a, b) => a.sequence! - b.sequence!);
    expect(advanced.engineRows).toEqual(wire);
    expect(sockets.flatMap((event) => event.engineRows ?? [])).toEqual(wire);
    expect(advanced.results.map((result: any) => result.engineResult.actionId)).toEqual(
      wire.map((row) => row.actionId),
    );
    for (const result of advanced.results) {
      await post(`${encounterId}/intent`, {
        source: 'dm',
        intent: {
          type: 'attack',
          actorId: result.action.actor_id,
          targetId: playerId,
          actionId: result.engineResult.actionId,
        },
      });
    }
    expect(await storedRows()).toEqual(rows);
    const [replayedHp] = await database
      .select()
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, playerId));
    expect(replayedHp.currentHp).toBe(494);
  });
  test('an insert failure rolls back NPC damage and turn advance; retry saves exactly one row per action', async () => {
    const [hpBefore] = await database
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, characterId));
    const count = (await storedRows()).length;
    const socketRows = () => sockets.flatMap((event) => event.engineRows ?? []).length;
    const sent = socketRows();
    const fail = spyOn(SessionMessageService, 'addMessages').mockImplementationOnce(async () => {
      throw new Error('insert failure');
    });
    // The player's End turn commits; the first creature's write fails, and its whole turn rolls
    // back. The End turn still answers: a failed drain must not fail the request that committed.
    const ended = await post(`${encounterId}/intent`, {
      intent: { type: 'end_turn', actorId: playerId },
    });
    fail.mockRestore();
    expect(ended.result.npcTurns).toBeUndefined();
    const after = await CombatEncounterService.getCombatState(encounterId, userId);
    expect(after.currentParticipant?.name).toBe('Captain Sarah Reeves');
    const [hpAfter] = await database
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, characterId));
    expect(hpAfter.currentHitPoints).toBe(hpBefore.currentHitPoints);
    expect(await storedRows()).toHaveLength(count);
    expect(socketRows()).toBe(sent);
    // Nothing in the browser asks again: the server's sweep picks the stranded creature up.
    await resumeStrandedNpcTurns();
    const resumed = await CombatEncounterService.getCombatState(encounterId, userId);
    expect(resumed.currentParticipant?.id).toBe(playerId);
    expect(await storedRows()).toHaveLength(count + 2);
  });
  // Migrated from show-npc-turn-lines.cards.test.ts: the formatter receives the full
  // CombatAttackService.resolveAttack + exposeAttackVisibility fixture from engine-results.
  test('arrive as a card on the enemy side, with the player HP, and keep the engine line as text', async () => {
    const state = await CombatEncounterService.getCombatState(encounterId, userId);
    const rows = await writeNpcEngineRow(
      {
        ...state,
        participants: state.participants.map((participant) =>
          participant.id === playerId ? { ...participant, maxHp: 7 } : participant,
        ),
      },
      { type: 'attack', actorId: REEVES.id, targetId: playerId },
      'migrated-card',
      { ...ENEMY_HITS_PLAYER, targetId: playerId },
      userId,
    );
    const [stored] = await database
      .select()
      .from(dialogueHistory)
      .where(eq(dialogueHistory.id, rows[0].id));
    expect(stored.message).toContain('Captain Sarah Reeves rolled 14 + 0 = 14 vs AC 11');
    const [card] = (stored.context as { engineCards: any[] }).engineCards;
    expect(card.side).toBe('enemy');
    expect(card.badge).toEqual({ word: 'HIT', tone: 'red', icon: 'alert' });
    expect(card.hp).toEqual({ name: 'The Scholar', newHp: 4, lost: 3, maxHp: 7 });
  });
  test('has no cards for a line with no result behind it', async () => {
    const state = await CombatEncounterService.getCombatState(encounterId, userId);
    const rows = await writeNpcEngineRow(
      state,
      { type: 'end_turn', actorId: state.participants[1].id },
      'migrated-boundary',
      {},
      userId,
    );
    const [stored] = await database
      .select()
      .from(dialogueHistory)
      .where(eq(dialogueHistory.id, rows[0].id));
    expect(stored.message).toContain('ended their turn');
    expect((stored.context as { engineCards: unknown[] }).engineCards).toEqual([]);
  });
});

/**
 * #2658 step 3: the server runs the creatures when the player ends the turn. Real routes, real
 * DB; no client follow-up call exists any more, so none is made. Each fight is its own session,
 * because a session holds one active encounter.
 */
describeWithDb('the server runs NPC turns on End turn (#2658 step 3)', () => {
  const database = hasRealDb ? realDb() : (null as never);
  const app = hasRealDb ? new Elysia({ prefix: '/v1/combat' }).use(intentRoutes) : null;
  const created: Array<{ campaignId: string; characterId: string | null; sessionId: string }> = [];
  const post = async (path: string, body: unknown) => {
    const response = await app!.handle(
      new Request(`http://localhost/v1/combat/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(200);
    return response.json();
  };
  const rowsOf = (sessionId: string) =>
    database
      .select()
      .from(dialogueHistory)
      .where(
        and(eq(dialogueHistory.sessionId, sessionId), eq(dialogueHistory.speakerType, 'system')),
      );
  /** A player and two creatures that hit for 3 (the step-2 fixture), or two creatures alone. */
  const seedFight = async ({ playerHp = 500, withPlayer = true, currentTurnOrder = 0 } = {}) => {
    const [{ id: campaignId }] = await database
      .insert(campaigns)
      .values({ userId, name: testId('camp') })
      .returning();
    let characterId: string | null = null;
    if (withPlayer) {
      [{ id: characterId }] = await database
        .insert(characters)
        .values({ userId, campaignId, name: 'The Scholar', class: 'Fighter', level: 1 })
        .returning();
      await database.insert(characterStats).values({
        characterId: characterId!,
        currentHitPoints: playerHp,
        maxHitPoints: 500,
        armorClass: 11,
      });
    }
    const [{ id: sessionId }] = await database
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning();
    created.push({ campaignId, characterId, sessionId });
    const [{ id: encounterId }] = await database
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder, version: 1 })
      .returning();
    // Real producer: resolveMonsterAttackProfile, as in the step-2 fixture above.
    const monsterAttack = resolveMonsterAttackProfile({
      authored: {
        attackName: 'Strike',
        attackBonus: 20,
        damageDice: '1d1 + 2',
        damageType: 'slashing',
      },
    });
    const seats = [
      ...(withPlayer
        ? [
            {
              encounterId,
              characterId,
              name: 'The Scholar',
              participantType: 'player',
              turnOrder: 0,
              initiative: 20,
              armorClass: 11,
              maxHp: 500,
              speed: 30,
            },
          ]
        : []),
      {
        encounterId,
        name: 'Captain Sarah Reeves',
        participantType: 'monster',
        turnOrder: 1,
        initiative: 15,
        armorClass: 11,
        maxHp: 50,
        speed: 30,
        monsterAttack,
      },
      {
        encounterId,
        name: 'Second Guard',
        participantType: 'monster',
        turnOrder: 2,
        initiative: 10,
        armorClass: 11,
        maxHp: 50,
        speed: 30,
        monsterAttack,
      },
    ];
    const participants = await database
      .insert(combatParticipants)
      .values(seats as never)
      .returning();
    await database.insert(combatParticipantStatus).values(
      participants.map((participant) => ({
        participantId: participant.id,
        currentHp: participant.participantType === 'player' ? playerHp : participant.maxHp,
        maxHp: participant.maxHp,
        isConscious: true,
      })),
    );
    return {
      sessionId,
      encounterId,
      playerId: participants.find((participant) => participant.participantType === 'player')?.id,
    };
  };
  const finish = (encounterId: string) =>
    database
      .update(combatEncounters)
      .set({ status: 'completed' })
      .where(eq(combatEncounters.id, encounterId));
  afterAll(async () => {
    for (const { campaignId, characterId, sessionId } of created) {
      await database.delete(gameSessions).where(eq(gameSessions.id, sessionId));
      if (characterId) await database.delete(characters).where(eq(characters.id, characterId));
      await database.delete(campaigns).where(eq(campaigns.id, campaignId));
    }
    await closeRealDb();
  });

  test('End turn with no client follow-up returns the player turn, and replaying it writes nothing new', async () => {
    const { sessionId, encounterId, playerId } = await seedFight();
    const endTurn = {
      intent: { type: 'end_turn', actorId: playerId, actionId: testId('end-turn') },
    };

    const ended = await post(`${encounterId}/intent`, endTurn);

    expect(ended.result.npcTurns.results.map((result: any) => result.action.action_type)).toEqual([
      'attack',
      'attack',
    ]);
    expect(ended.result.npcTurns.currentParticipant).toMatchObject({
      id: playerId,
      participantType: 'player',
    });
    const state = await CombatEncounterService.getCombatState(encounterId, userId);
    expect(state.currentParticipant?.id).toBe(playerId);
    // One row for the player's End turn, one per creature attack.
    const rows = await rowsOf(sessionId);
    expect(rows).toHaveLength(3);
    expect(ended.engineRows.map((row: { id: string }) => row.id).sort()).toEqual(
      rows.map((row) => row.id).sort(),
    );
    // The player's own End turn row is the player's; the creatures' rows are theirs.
    expect(ended.engineRows.map((row: { kind: string }) => row.kind).sort()).toEqual([
      'npc',
      'npc',
      'player',
    ]);
    const ownRow = rows.find((row) => row.message.includes('The Scholar ended their turn'));
    expect(
      (ownRow?.context as { combatEngineBlocks: Array<{ source: string }> }).combatEngineBlocks[0]
        .source,
    ).toBe('player');

    const replayed = await post(`${encounterId}/intent`, endTurn);

    expect(replayed.engineRows).toEqual([]);
    expect(await rowsOf(sessionId)).toEqual(rows);
    const after = await CombatEncounterService.getCombatState(encounterId, userId);
    expect(after.currentParticipant?.id).toBe(playerId);
    expect(after.encounter.currentRound).toBe(state.encounter.currentRound);
    const [hp] = await database
      .select()
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, playerId!));
    expect(hp.currentHp).toBe(494);
    await finish(encounterId);
  });

  test('End turn that downs the player stops on the death save it owes', async () => {
    const { encounterId, playerId } = await seedFight({ playerHp: 3 });

    const ended = await post(`${encounterId}/intent`, {
      intent: { type: 'end_turn', actorId: playerId, actionId: testId('end-turn') },
    });

    expect(ended.result.npcTurns.currentParticipant).toMatchObject({
      id: playerId,
      vitalState: 'dying',
    });
    const legal = await getLegalCombatActions(encounterId, userId);
    expect(legal.actorId).toBe(playerId!);
    expect(legal.actions.map((action) => action.type)).toEqual(['death_save']);
    await finish(encounterId);
  });

  test('a restart that left a creature holding the turn resumes it at boot', async () => {
    // As a restart leaves it: the player's turn is over, the first creature is up, and nothing
    // in any browser will ever ask for it again.
    const { sessionId, encounterId, playerId } = await seedFight({ currentTurnOrder: 1 });

    await resumeStrandedNpcTurns();

    const state = await CombatEncounterService.getCombatState(encounterId, userId);
    expect(state.currentParticipant?.id).toBe(playerId);
    expect(await rowsOf(sessionId)).toHaveLength(2);
    await finish(encounterId);
  });

  test.each([
    ['its participant id', (playerId: string) => playerId],
    ['its slug', () => 'the-scholar'],
  ])(
    'a player intent addressed by %s while a creature holds the turn runs the creatures first',
    async (_label, actorRef) => {
      // A creature left holding the turn (a restart, a failed drain), and the player acts before
      // the sweep comes round: the route runs the creatures first instead of refusing the turn.
      const { sessionId, encounterId, playerId } = await seedFight({ currentTurnOrder: 1 });

      const ended = await post(`${encounterId}/intent`, {
        intent: { type: 'end_turn', actorId: actorRef(playerId!) },
      });

      expect(ended.accepted).toBe(true);
      // Two creature attacks before the player's turn, and two after it ends.
      expect(ended.result.npcTurns.results.map((result: any) => result.action.action_type)).toEqual(
        ['attack', 'attack', 'attack', 'attack'],
      );
      const creatureRows = (await rowsOf(sessionId)).filter((row) =>
        (
          row.context as { combatEngineBlocks?: Array<{ source: string }> }
        )?.combatEngineBlocks?.every((block) => block.source === 'npc'),
      );
      expect(creatureRows).toHaveLength(4);
      const state = await CombatEncounterService.getCombatState(encounterId, userId);
      expect(state.currentParticipant?.id).toBe(playerId);
      await finish(encounterId);
    },
  );

  test('a fled player leaves nothing to hand the turn to: the route runs no creature', async () => {
    const { sessionId, encounterId, playerId } = await seedFight();

    const fled = await post(`${encounterId}/intent`, {
      intent: { type: 'flee', actorId: playerId, expectedVersion: 1 },
    });

    expect(fled.result.exit).toBe('fled');
    expect(fled.result.npcTurns).toBeUndefined();
    expect(await rowsOf(sessionId)).toHaveLength(0);
    await finish(encounterId);
  });

  test('a loop that stays at the safety cap writes the cap line as one row', async () => {
    // The same fled fight, run directly: nobody to fight and nobody to hand the turn to, so only
    // the cap stops the creatures (2 x 3 participants = six iterations, one call).
    const { sessionId, encounterId, playerId } = await seedFight();
    await post(`${encounterId}/intent`, {
      intent: { type: 'flee', actorId: playerId, expectedVersion: 1 },
    });

    const drained = await runNpcTurnsToPlayer(encounterId, userId);

    expect(drained.capReached).toBe(true);
    expect(drained.iterationCount).toBe(6);
    const capRows = (await rowsOf(sessionId)).filter((row) =>
      row.message.includes('NPC turn loop stopped after'),
    );
    expect(capRows).toHaveLength(1);
    expect(drained.engineRows?.map((row) => row.id)).toContain(capRows[0].id);
    await finish(encounterId);
  });
});
