import { readFileSync } from 'node:fs';
import path from 'node:path';

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
  characterSpellSlots,
  gameSessions,
  combatEncounters,
  combatParticipants,
  combatParticipantStatus,
  combatBossState,
  combatDamageLog,
  dialogueHistory,
  inventoryItems,
  tacticalMaps,
} from '../../../../db/schema/index';
import { ENEMY_HITS_PLAYER, REEVES } from '../../../../shared/test-fixtures/engine-results';
import { parseAuthoredStatBlock } from '../combat/authored-stat-block-parser.js';
import { resolveMonsterAttackProfile } from '../combat/monster-attack-profile.js';

const userId = testId('npc-engine-rows-user');
mock.module('../../lib/dice.js', () => ({
  rollD20: () => 14,
  rollD20Pair: () => ({ kept: 14 }),
}));
mock.module('../../lib/auth.js', () => ({
  authenticateRequest: async () => ({ user: { userId }, error: null }),
}));
process.env.PORT ??= '8892';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';
// #974: a roll's first resolution can fail after its damage has landed — a later step of
// the same resolution throws, the spent-action claim is released, and the retried roll
// resolves a second time. The player-damage provocation write is the first step after
// the damage itself inside the resolver, so the #974 test arms this counter to make it
// throw once. The module's only export is this function. Unarmed, the stub answers []
// for every call: that matches the real function for every other test in this file
// (their damage is a creature's, for which the real function returns [] immediately),
// and on the #974 test's own success path it also suppresses the real function's
// provoked flip and "turns hostile" line, which no assertion here reads. Same stub
// shape as the AoE route tests use.
const provocationFailure = { remaining: 0 };
mock.module('../combat/npc-provocation.js', () => ({
  markPlayerDamageProvocation: async () => {
    if (provocationFailure.remaining > 0) {
      provocationFailure.remaining -= 1;
      throw new Error('post-damage step failed (simulated by the #974 test)');
    }
    return [];
  },
}));
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
const { runBossMoveWindow, armDefy } = await importWithRealDb(
  () => import('../combat/boss-move-window.js'),
);
const { saveTacticalMap } = await importWithRealDb(() => import('../combat/tactical-map-store.js'));

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

  test("a fled player ends the fight (#1169): the route runs no creature, and the only row is the flee's own", async () => {
    const { sessionId, encounterId, playerId } = await seedFight();

    const fled = await post(`${encounterId}/intent`, {
      intent: { type: 'flee', actorId: playerId, expectedVersion: 1 },
    });

    expect(fled.result.exit).toBe('fled');
    expect(fled.result.npcTurns).toBeUndefined();
    expect(fled.result.combatEnded).toBe(true);
    expect(fled.result.endedReason).toBe('abandoned');
    const rows = await rowsOf(sessionId);
    expect(rows).toHaveLength(1);
    expect(
      (rows[0].context as { combatEngineBlocks: Array<{ source: string }> }).combatEngineBlocks[0]
        .source,
    ).toBe('player');
    expect(rows[0].message).toContain('fled from combat');
    expect(
      rows.some((row) =>
        (
          row.context as { combatEngineBlocks?: Array<{ source: string }> }
        )?.combatEngineBlocks?.some((block) => block.source === 'npc'),
      ),
    ).toBe(false);
    await finish(encounterId);
  });

  test('a flee whose opportunity attack downs the player (#1169): no exit, the fight stays open, one player row carries the downed line', async () => {
    const { sessionId, encounterId, playerId } = await seedFight({ playerHp: 1 });
    const participants = await database
      .select()
      .from(combatParticipants)
      .where(eq(combatParticipants.encounterId, encounterId));
    const reeves = participants.find((participant) => participant.name === 'Captain Sarah Reeves')!;
    const guard = participants.find((participant) => participant.name === 'Second Guard')!;
    // Adjacent, one cell apart: five feet, inside the reach of the Strike this guard fights
    // with. Without a board there is no opportunity attack at all (the selector returns null
    // with no map), so the board is what makes this the downed-by-the-blow case. The second
    // guard sits far away so only the adjacent one provokes.
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
          id: playerId!,
          slug: 'the-scholar',
          x: 4,
          y: 4,
          size: 'medium',
          type: 'pc',
          speedFeet: 30,
          movementRemaining: 30,
        },
        {
          id: reeves.id,
          slug: 'captain-sarah-reeves',
          x: 5,
          y: 4,
          size: 'medium',
          type: 'monster',
          speedFeet: 30,
          movementRemaining: 30,
        },
        {
          id: guard.id,
          slug: 'second-guard',
          x: 10,
          y: 8,
          size: 'medium',
          type: 'monster',
          speedFeet: 30,
          movementRemaining: 30,
        },
      ],
      round: 1,
      sceneDescription: 'D5 gallery',
    });

    const fled = await post(`${encounterId}/intent`, {
      intent: { type: 'flee', actorId: playerId, expectedVersion: 1 },
    });

    // The blow downed the hero, so the flee is not an exit and the fight does not close.
    // Dice are the file's module mock (rollD20 14 + bonus 20 vs AC 11 hits for 3), so the
    // 1 HP hero goes to 0 on a pinned hit, not on a lucky roll.
    expect(fled.result.exit).toBeNull();
    expect(fled.result.opportunityAttack).toMatchObject({
      attackerName: 'Captain Sarah Reeves',
      hit: true,
      finalDamage: 3,
    });
    const [encounter] = await database
      .select()
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    expect(encounter.status).toBe('active');
    expect(encounter.endedReason).toBeNull();
    // No exit is recorded: the hero stays in the turn order for the death-save flow.
    const [hero] = await database
      .select()
      .from(combatParticipants)
      .where(eq(combatParticipants.id, playerId!));
    expect(hero.isActive).toBe(true);
    const [heroStatus] = await database
      .select()
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, playerId!));
    expect(heroStatus.currentHp).toBe(0);
    expect(heroStatus.isConscious).toBe(false);
    // Exactly one source 'player' row, and it carries the downed line the strategist quotes.
    const rows = await rowsOf(sessionId);
    const playerRows = rows.filter((row) =>
      (row.context as { combatEngineBlocks?: Array<{ source: string }> })?.combatEngineBlocks?.some(
        (block) => block.source === 'player',
      ),
    );
    expect(playerRows).toHaveLength(1);
    expect(playerRows[0].message).toContain('did not get away; they are downed');
    // Death saves are owed: the hero's next end_turn is refused until a death_save pays it.
    const refused = await app!.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intent: { type: 'end_turn', actorId: playerId } }),
      }),
    );
    expect(refused.status).toBe(422);
    const refusedBody = (await refused.json()) as { details?: { reason?: string } };
    expect(refusedBody.details?.reason).toBe('death_save_required');
    await database.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    await finish(encounterId);
  });

  test('a loop that stays at the safety cap writes the cap line as one row', async () => {
    // The player's exit is marked directly because a flee intent now concludes the encounter (#1169).
    // The same fled fight, run directly: nobody to fight and nobody to hand the turn to, so only
    // the cap stops the creatures (2 x 3 participants = six iterations, one call).
    const { sessionId, encounterId, playerId } = await seedFight();
    await CombatEncounterService.markParticipantExited(encounterId, playerId!);

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

describeWithDb('Boss Move window through the real database (#728)', () => {
  const bossUserId = testId('boss-move-user');
  let encounterId: string;
  let heroId: string;
  let campaignId: string;
  let characterId: string;

  // Read the shared connection at use time: an earlier block in this file closes it.
  const freshState = () => CombatEncounterService.getCombatState(encounterId, bossUserId);
  const setRound = (round: number) =>
    realDb()
      .update(combatEncounters)
      .set({ currentRound: round })
      .where(eq(combatEncounters.id, encounterId));
  const windowNow = async () =>
    runBossMoveWindow({ encounterId, userId: bossUserId, state: await freshState() });
  // The Opener's damage is rolled, so the hero can leave round 1 bloodied. Each test sets the hero's
  // HP and dodging explicitly rather than inheriting them from the test before.
  const setHero = (currentHp: number, isDodging = false) =>
    Promise.all([
      realDb()
        .update(combatParticipantStatus)
        .set({ currentHp })
        .where(eq(combatParticipantStatus.participantId, heroId)),
      realDb()
        .update(combatParticipants)
        .set({ isDodging })
        .where(eq(combatParticipants.id, heroId)),
    ]);

  beforeAll(async () => {
    const [campaign] = await realDb()
      .insert(campaigns)
      .values({ userId: bossUserId, name: testId('boss-camp') })
      .returning();
    campaignId = campaign!.id;
    const [character] = await realDb()
      .insert(characters)
      .values({
        userId: bossUserId,
        campaignId: campaign!.id,
        name: 'The Stranger',
        class: 'Fighter',
        level: 1,
      })
      .returning();
    characterId = character!.id;
    await realDb().insert(characterStats).values({
      characterId: character!.id,
      currentHitPoints: 40,
      maxHitPoints: 40,
      armorClass: 13,
    });
    const [session] = await realDb()
      .insert(gameSessions)
      .values({
        campaignId: campaign!.id,
        characterId: character!.id,
        sessionNumber: 1,
        status: 'active',
      })
      .returning();
    const [encounter] = await realDb()
      .insert(combatEncounters)
      .values({
        sessionId: session!.id,
        status: 'active',
        currentRound: 1,
        currentTurnOrder: 0,
        version: 1,
      })
      .returning();
    encounterId = encounter!.id;

    // Real producers: the pilot boss's stat block is parsed by the authored parser, and its attack
    // and Boss Moves are stored exactly as seating stores them.
    const stat = parseAuthoredStatBlock(
      readFileSync(
        path.join(import.meta.dir, '../combat/__tests__/fixtures/thing-below-stat-block.md'),
        'utf8',
      ),
    );
    const [hero, boss] = await realDb()
      .insert(combatParticipants)
      .values([
        {
          encounterId,
          characterId: character!.id,
          name: 'The Stranger',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 13,
          maxHp: 40,
          speed: 30,
        },
        {
          encounterId,
          name: 'The Thing Below (Avatar)',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 10,
          armorClass: stat.armorClass!,
          maxHp: stat.maxHp!,
          speed: 30,
          monsterAttack: resolveMonsterAttackProfile({ authored: stat, maxHp: stat.maxHp }),
          bossMoves: stat.bossMoves ?? null,
        },
      ])
      .returning();
    heroId = hero!.id;
    await realDb()
      .insert(combatParticipantStatus)
      .values([
        { participantId: heroId, currentHp: 40, maxHp: 40 },
        { participantId: boss!.id, currentHp: 200, maxHp: 200 },
      ]);
  });

  test('Opener fires right after the hero first ends a turn, and never twice in a round', async () => {
    await setRound(1);
    const first = await windowNow();
    expect(first.lines).toHaveLength(1);
    expect(first.lines[0]).toStartWith('Boss Move: Starlit Lash (Opener)');
    expect(first.engineRows.length).toBeGreaterThan(0);

    const sameRound = await windowNow();
    expect(sameRound.lines).toEqual([]);
  });

  test('a round with no trigger leaves the hero alone', async () => {
    await setHero(40);
    await setRound(2);
    const quiet = await windowNow();
    expect(quiet.lines).toEqual([]);
  });

  test('the Finale is telegraphed in round 3, one round before it can fire', async () => {
    await setHero(40);
    await setRound(3);
    const telegraph = await windowNow();
    expect(telegraph.lines).toHaveLength(1);
    expect(telegraph.lines[0]).toStartWith('Boss Move telegraph: Reality Break (Finale)');
  });

  test('counterplay (dodging) spends the telegraphed Finale in round 4', async () => {
    await setRound(4);
    await setHero(40, true);
    const countered = await windowNow();
    expect(countered.lines).toHaveLength(1);
    expect(countered.lines[0]).toStartWith('Boss Move: Reality Break (Finale)');
    expect(countered.lines[0]).toContain('countered');

    const after = await windowNow();
    expect(after.lines).toEqual([]);
  });

  test('two drains that race into the same round fire one move between them', async () => {
    await setRound(8);
    // Bloodied, so Turnabout is due. Two windows run at once, as a hero's end_turn drain and the
    // sweep can. Only the one that claims the round may act.
    await setHero(20);
    const [a, b] = await Promise.all([windowNow(), windowNow()]);
    expect(a.lines.length + b.lines.length).toBe(1);
    const fired = [...a.lines, ...b.lines][0] ?? '';
    expect(fired).toStartWith('Boss Move: Gaze of the Void (Turnabout)');
  });

  test('a solo hero has one Defy per fight: armed once, then refused', async () => {
    expect(await armDefy(encounterId)).toBe(true);
    expect(await armDefy(encounterId)).toBe(false);
    const [row] = await realDb()
      .select()
      .from(combatBossState)
      .where(eq(combatBossState.encounterId, encounterId));
    expect(row?.defyLeft).toBe(1);
    expect(row?.defyArmed).toBe(true);
  });

  test('armDefy arms the Defy on a new encounter before the first window runs', async () => {
    // A fresh encounter: the boss-state row does not exist yet, because the window only
    // creates it after the hero's first end_turn. The Defy button must still arm, so the
    // Defy can cover the Opener. (One active encounter per session, so a fresh session.)
    const [freshSession] = await realDb()
      .insert(gameSessions)
      .values({
        campaignId,
        characterId,
        sessionNumber: 2,
        status: 'active',
      })
      .returning();
    const [fresh] = await realDb()
      .insert(combatEncounters)
      .values({
        sessionId: freshSession!.id,
        status: 'active',
        currentRound: 1,
        currentTurnOrder: 0,
        version: 1,
      })
      .returning();
    const [freshHero] = await realDb()
      .insert(combatParticipants)
      .values({
        encounterId: fresh!.id,
        name: 'Fresh Hero',
        participantType: 'player',
        turnOrder: 0,
        initiative: 20,
        armorClass: 13,
        maxHp: 40,
        speed: 30,
      })
      .returning();
    await realDb()
      .insert(combatParticipantStatus)
      .values({ participantId: freshHero!.id, currentHp: 40, maxHp: 40 });

    const before = await realDb()
      .select()
      .from(combatBossState)
      .where(eq(combatBossState.encounterId, fresh!.id));
    expect(before).toHaveLength(0);

    expect(await armDefy(fresh!.id)).toBe(true);

    const [row] = await realDb()
      .select()
      .from(combatBossState)
      .where(eq(combatBossState.encounterId, fresh!.id));
    expect(row?.defyLeft).toBe(1);
    expect(row?.defyArmed).toBe(true);
  });
});

/**
 * #974: one Attack tray roll produced two damage resolutions (8 then 10 slashing), both
 * dated round 1 and both counted in the Combat Summary. A roll is keyed by its actionId;
 * the gateway already returns a stored result when a keyed intent is posted again, but a
 * player's attack never stored one — and when the first resolution failed after its
 * damage had landed, the spent-action claim was released, so the retried roll resolved
 * again with a fresh damage roll. This fight is the player's own: one Scholar, one
 * target, the identical roll body posted three times.
 */
describeWithDb('a keyed player attack roll resolves exactly once (#974)', () => {
  const app = hasRealDb ? new Elysia({ prefix: '/v1/combat' }).use(intentRoutes) : null;
  let campaignId: string, characterId: string, sessionId: string, encounterId: string;
  let playerId: string, monsterId: string;
  const duels: Array<{ campaignId: string; characterId: string; sessionId: string }> = [];
  const postTo = async (targetEncounterId: string, body: unknown) => {
    const response = await app!.handle(
      new Request(`http://localhost/v1/combat/${targetEncounterId}/intent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };
  const postRaw = (body: unknown) => postTo(encounterId, body);
  /** A fresh Scholar-vs-Balthazar duel in its own session, for a test that needs a
   *  fight the first test has not already spent. */
  const seedDuel = async (monsterHp: number) => {
    const database = realDb();
    const [{ id: duelCampaignId }] = await database
      .insert(campaigns)
      .values({ userId, name: testId('camp') })
      .returning();
    const [{ id: duelCharacterId }] = await database
      .insert(characters)
      .values({
        userId,
        campaignId: duelCampaignId,
        name: 'The Scholar',
        class: 'Fighter',
        level: 1,
      })
      .returning();
    await database.insert(characterStats).values({
      characterId: duelCharacterId,
      strength: 16,
      currentHitPoints: 500,
      maxHitPoints: 500,
      armorClass: 11,
    });
    await database.insert(inventoryItems).values({
      characterId: duelCharacterId,
      name: 'Longsword',
      itemType: 'weapon',
      isEquipped: true,
    });
    const [{ id: duelSessionId }] = await database
      .insert(gameSessions)
      .values({
        campaignId: duelCampaignId,
        characterId: duelCharacterId,
        sessionNumber: 1,
        status: 'active',
      })
      .returning();
    const [{ id: duelEncounterId }] = await database
      .insert(combatEncounters)
      .values({
        sessionId: duelSessionId,
        status: 'active',
        currentRound: 1,
        currentTurnOrder: 0,
        version: 1,
      })
      .returning();
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
          encounterId: duelEncounterId,
          characterId: duelCharacterId,
          name: 'The Scholar',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 11,
          maxHp: 500,
          speed: 30,
        },
        {
          encounterId: duelEncounterId,
          name: 'Balthazar',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 10,
          armorClass: 11,
          maxHp: monsterHp,
          speed: 30,
          monsterAttack,
        },
      ])
      .returning();
    await database.insert(combatParticipantStatus).values(
      participants.map((participant) => ({
        participantId: participant.id,
        currentHp: participant.maxHp,
        maxHp: participant.maxHp,
        isConscious: true,
      })),
    );
    duels.push({
      campaignId: duelCampaignId,
      characterId: duelCharacterId,
      sessionId: duelSessionId,
    });
    return {
      sessionId: duelSessionId,
      encounterId: duelEncounterId,
      playerId: participants[0].id,
      monsterId: participants[1].id,
    };
  };
  const damageRowsOf = (targetEncounterId: string, targetId: string) =>
    realDb()
      .select()
      .from(combatDamageLog)
      .where(
        and(
          eq(combatDamageLog.encounterId, targetEncounterId),
          eq(combatDamageLog.participantId, targetId),
        ),
      );
  const keyedRowsOf = async (targetSessionId: string, rollId: string) =>
    (
      await realDb()
        .select()
        .from(dialogueHistory)
        .where(eq(dialogueHistory.sessionId, targetSessionId))
    ).filter((row) => (row.context as { actionId?: string } | null)?.actionId === rollId);
  const hpOf = async (participantId: string) => {
    const [row] = await realDb()
      .select()
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, participantId));
    return row.currentHp;
  };
  beforeAll(async () => {
    const database = realDb();
    [{ id: campaignId }] = await database
      .insert(campaigns)
      .values({ userId, name: testId('camp') })
      .returning();
    [{ id: characterId }] = await database
      .insert(characters)
      .values({ userId, campaignId, name: 'The Scholar', class: 'Fighter', level: 1 })
      .returning();
    await database.insert(characterStats).values({
      characterId,
      strength: 16,
      currentHitPoints: 500,
      maxHitPoints: 500,
      armorClass: 11,
    });
    // The equipped weapon is an inventory row, exactly as the sheet writes it; the attack
    // grounds to it through the SRD catalog (Longsword, 1d8 slashing).
    await database.insert(inventoryItems).values({
      characterId,
      name: 'Longsword',
      itemType: 'weapon',
      isEquipped: true,
    });
    [{ id: sessionId }] = await database
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning();
    [{ id: encounterId }] = await database
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning();
    // Real producer: resolveMonsterAttackProfile, as in the fixtures above.
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
          name: 'Balthazar',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 10,
          armorClass: 11,
          maxHp: 50,
          speed: 30,
          monsterAttack,
        },
      ])
      .returning();
    playerId = participants[0].id;
    monsterId = participants[1].id;
    await database.insert(combatParticipantStatus).values(
      participants.map((participant) => ({
        participantId: participant.id,
        currentHp: participant.maxHp,
        maxHp: participant.maxHp,
        isConscious: true,
      })),
    );
  });
  afterAll(async () => {
    const database = realDb();
    await database.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await database.delete(characters).where(eq(characters.id, characterId));
    await database.delete(campaigns).where(eq(campaigns.id, campaignId));
    for (const duel of duels) {
      await database.delete(gameSessions).where(eq(gameSessions.id, duel.sessionId));
      await database.delete(characters).where(eq(characters.id, duel.characterId));
      await database.delete(campaigns).where(eq(campaigns.id, duel.campaignId));
    }
  });

  test('the same roll reposted after a post-damage failure, and again after success, lands one damage event', async () => {
    const rollId = testId('tray-roll');
    const body = {
      source: 'dm',
      intent: { type: 'attack', actorId: playerId, targetId: monsterId, actionId: rollId, d20: 14 },
    };
    // The first post's damage lands, then a later step of the same resolution fails —
    // the failure that used to release the claim and invite the re-resolve. The armed
    // attempt answers an error on both builds: on the broken build it strands the
    // landed damage behind the released claim; on the fixed build the whole attempt
    // rolls back and nothing landed, so the repost below is the first resolution.
    provocationFailure.remaining = 1;
    const first = await postRaw(body);
    expect(first.status).toBe(500);
    const resolved = await postRaw(body);
    expect(resolved.status).toBe(200);

    const database = realDb();
    const damageRows = await damageRowsOf(encounterId, monsterId);
    expect(damageRows).toHaveLength(1);
    expect(await hpOf(monsterId)).toBe(50 - damageRows[0].damageAmount);
    expect(resolved.body.result.finalDamage).toBe(damageRows[0].damageAmount);
    // The one resolution spent the action and bumped the encounter version once.
    const [afterResolve] = await database
      .select()
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    expect(afterResolve.version).toBe(2);
    const [actorAfter] = await database
      .select()
      .from(combatParticipants)
      .where(eq(combatParticipants.id, playerId));
    expect(actorAfter.actionUsed).toBe(true);

    // A further duplicate of the same roll returns the first result and writes nothing.
    const replayed = await postRaw(body);
    expect(replayed.status).toBe(200);
    // The first result itself, not a re-render of it: identical apart from the row
    // payload the first response carried and the replay omits.
    const firstResult = { ...resolved.body.result };
    delete firstResult.engineRows;
    delete firstResult.sessionId;
    expect(replayed.body.result).toEqual({ ...firstResult, engineRows: [] });
    expect(replayed.body.engineRows).toEqual([]);
    expect(await damageRowsOf(encounterId, monsterId)).toEqual(damageRows);
    const [afterReplay] = await database
      .select()
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    expect(afterReplay.version).toBe(2);
    expect(await keyedRowsOf(sessionId, rollId)).toHaveLength(1);
    const sessionRows = await database
      .select()
      .from(dialogueHistory)
      .where(eq(dialogueHistory.sessionId, sessionId));
    expect(sessionRows).toHaveLength(1);
  });

  test('two posts of the same roll in flight at once resolve it once', async () => {
    const duel = await seedDuel(50);
    const rollId = testId('tray-roll-race');
    const body = {
      source: 'dm',
      intent: {
        type: 'attack',
        actorId: duel.playerId,
        targetId: duel.monsterId,
        actionId: rollId,
        d20: 14,
      },
    };
    const [a, b] = await Promise.all([
      postTo(duel.encounterId, body),
      postTo(duel.encounterId, body),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const damageRows = await damageRowsOf(duel.encounterId, duel.monsterId);
    expect(damageRows).toHaveLength(1);
    expect(await hpOf(duel.monsterId)).toBe(50 - damageRows[0].damageAmount);
    // One response is the resolution, the other the replay of it: same damage, and
    // exactly one of them carries the stored row.
    expect(a.body.result.finalDamage).toBe(damageRows[0].damageAmount);
    expect(b.body.result.finalDamage).toBe(damageRows[0].damageAmount);
    expect([a, b].filter((response) => response.body.engineRows.length === 1)).toHaveLength(1);
    expect([a, b].filter((response) => response.body.engineRows.length === 0)).toHaveLength(1);
    expect(await keyedRowsOf(duel.sessionId, rollId)).toHaveLength(1);
  });

  test('a keyed killing blow lands once, concludes the fight, and replays after conclusion', async () => {
    const duel = await seedDuel(4);
    const rollId = testId('tray-roll-kill');
    const body = {
      source: 'dm',
      intent: {
        type: 'attack',
        actorId: duel.playerId,
        targetId: duel.monsterId,
        actionId: rollId,
        d20: 14,
      },
    };
    const blown = await postTo(duel.encounterId, body);
    expect(blown.status).toBe(200);
    const database = realDb();
    const [encounter] = await database
      .select()
      .from(combatEncounters)
      .where(eq(combatEncounters.id, duel.encounterId));
    expect(encounter.status).toBe('completed');
    const damageRows = await damageRowsOf(duel.encounterId, duel.monsterId);
    expect(damageRows).toHaveLength(1);
    expect(await hpOf(duel.monsterId)).toBe(0);
    expect(blown.body.result.finalDamage).toBe(damageRows[0].damageAmount);
    // The actor's row is stored before the victory notice that follows it (#570):
    // both rows exist, and the notice's timestamp does not precede the blow's
    // (createdAt is millisecond-resolution, so an exact order can tie).
    const rows = await database
      .select()
      .from(dialogueHistory)
      .where(eq(dialogueHistory.sessionId, duel.sessionId));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const blowRow = rows.find((row) => (row.context as { actionId?: string }).actionId === rollId);
    const victoryRow = rows.find((row) => row.message.includes('Victory'));
    expect(blowRow).toBeDefined();
    expect(victoryRow).toBeDefined();
    expect(victoryRow!.createdAt?.getTime() ?? 0).toBeGreaterThanOrEqual(
      blowRow!.createdAt?.getTime() ?? 0,
    );

    // A duplicate of the killing roll, posted after the fight ended, returns the
    // stored blow — not the concluded-encounter marker and not a second resolution.
    const replayed = await postTo(duel.encounterId, body);
    expect(replayed.status).toBe(200);
    expect(replayed.body.result.finalDamage).toBe(damageRows[0].damageAmount);
    expect(replayed.body.result.encounterAlreadyConcluded).toBeUndefined();
    expect(replayed.body.engineRows).toEqual([]);
    expect(await damageRowsOf(duel.encounterId, duel.monsterId)).toEqual(damageRows);
    expect(
      await database
        .select()
        .from(dialogueHistory)
        .where(eq(dialogueHistory.sessionId, duel.sessionId)),
    ).toHaveLength(rows.length);
  });

  test('a keyed killing blow whose row write fails rolls back whole; the same roll then lands it once', async () => {
    const duel = await seedDuel(4);
    const rollId = testId('tray-roll-kill-retry');
    const body = {
      source: 'dm',
      intent: {
        type: 'attack',
        actorId: duel.playerId,
        targetId: duel.monsterId,
        actionId: rollId,
        d20: 14,
      },
    };
    // Fail only the write of this roll's own engine row: the blow, the ending and the
    // award are one transaction for a keyed action, so the whole attempt must roll
    // back and the retry of the same roll must land it — exactly once.
    const original = SessionMessageService.addMessages.bind(SessionMessageService);
    let armed = true;
    const failKeyedRow = spyOn(SessionMessageService, 'addMessages').mockImplementation((async (
      messages: Array<{ context?: Record<string, unknown> }>,
      userId: string,
    ) => {
      if (armed && messages.some((message) => message.context?.actionId === rollId)) {
        armed = false;
        throw new Error('engine row insert failed (simulated by the #974 test)');
      }
      return original(messages as never, userId);
    }) as never);
    const failed = await postTo(duel.encounterId, body);
    failKeyedRow.mockRestore();
    expect(failed.status).toBe(500);
    const database = realDb();
    const [duringFailure] = await database
      .select()
      .from(combatEncounters)
      .where(eq(combatEncounters.id, duel.encounterId));
    expect(duringFailure.status).toBe('active');
    expect(await hpOf(duel.monsterId)).toBe(4);
    expect(await damageRowsOf(duel.encounterId, duel.monsterId)).toHaveLength(0);
    expect(await keyedRowsOf(duel.sessionId, rollId)).toHaveLength(0);

    const landed = await postTo(duel.encounterId, body);
    expect(landed.status).toBe(200);
    const [afterRetry] = await database
      .select()
      .from(combatEncounters)
      .where(eq(combatEncounters.id, duel.encounterId));
    expect(afterRetry.status).toBe('completed');
    expect(await damageRowsOf(duel.encounterId, duel.monsterId)).toHaveLength(1);
    expect(await hpOf(duel.monsterId)).toBe(0);
    expect(await keyedRowsOf(duel.sessionId, rollId)).toHaveLength(1);
  });

  test('a keyed multi-target spell resolves once: per-target damage, one slot, duplicate replays whole', async () => {
    const database = realDb();
    const [{ id: wizCampaignId }] = await database
      .insert(campaigns)
      .values({ userId, name: testId('camp') })
      .returning();
    const [{ id: wizCharacterId }] = await database
      .insert(characters)
      .values({
        userId,
        campaignId: wizCampaignId,
        name: 'The Wizard',
        class: 'Wizard',
        level: 1,
        knownSpells: 'Burning Hands',
      })
      .returning();
    await database.insert(characterStats).values({
      characterId: wizCharacterId,
      intelligence: 16,
      currentHitPoints: 30,
      maxHitPoints: 30,
      armorClass: 12,
    });
    // The slot row the sheet writes (dm-reply-reconcile's slot-wizard shape).
    await database.insert(characterSpellSlots).values({
      characterId: wizCharacterId,
      spellLevel: 1,
      totalSlots: 2,
      usedSlots: 0,
    });
    const [{ id: wizSessionId }] = await database
      .insert(gameSessions)
      .values({
        campaignId: wizCampaignId,
        characterId: wizCharacterId,
        sessionNumber: 1,
        status: 'active',
      })
      .returning();
    const [{ id: wizEncounterId }] = await database
      .insert(combatEncounters)
      .values({
        sessionId: wizSessionId,
        status: 'active',
        currentRound: 1,
        currentTurnOrder: 0,
        version: 1,
      })
      .returning();
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
          encounterId: wizEncounterId,
          characterId: wizCharacterId,
          name: 'The Wizard',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 12,
          maxHp: 30,
          speed: 30,
        },
        {
          encounterId: wizEncounterId,
          name: 'First Acolyte',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 10,
          armorClass: 11,
          maxHp: 30,
          speed: 30,
          monsterAttack,
        },
        {
          encounterId: wizEncounterId,
          name: 'Second Acolyte',
          participantType: 'monster',
          turnOrder: 2,
          initiative: 5,
          armorClass: 11,
          maxHp: 30,
          speed: 30,
          monsterAttack,
        },
      ])
      .returning();
    await database.insert(combatParticipantStatus).values(
      participants.map((participant) => ({
        participantId: participant.id,
        currentHp: participant.maxHp,
        maxHp: participant.maxHp,
        isConscious: true,
      })),
    );
    duels.push({
      campaignId: wizCampaignId,
      characterId: wizCharacterId,
      sessionId: wizSessionId,
    });
    const wizardId = participants[0].id;
    const targetIds = [participants[1].id, participants[2].id];
    const usedSlots = async () => {
      const [row] = await realDb()
        .select()
        .from(characterSpellSlots)
        .where(eq(characterSpellSlots.characterId, wizCharacterId));
      return row.usedSlots;
    };

    const rollId = testId('tray-roll-spell');
    const body = {
      source: 'dm',
      intent: {
        type: 'spell',
        actorId: wizardId,
        targetIds,
        spellName: 'Burning Hands',
        slotLevel: 1,
        actionId: rollId,
      },
    };
    const cast = await postTo(wizEncounterId, body);
    expect(cast.status).toBe(200);
    // Per-target results align with targetIds by index (the resolver's result
    // objects carry finalDamage and targetNewHp, not the target's id).
    const results = cast.body.result.results as Array<{
      finalDamage: number;
      targetNewHp: number;
    }>;
    expect(results).toHaveLength(2);
    const allDamage = await database
      .select()
      .from(combatDamageLog)
      .where(eq(combatDamageLog.encounterId, wizEncounterId));
    expect(allDamage).toHaveLength(2);
    for (const [index, targetId] of targetIds.entries()) {
      const [row] = allDamage.filter((entry) => entry.participantId === targetId);
      expect(await hpOf(targetId)).toBe(30 - row.damageAmount);
      expect(results[index].finalDamage).toBe(row.damageAmount);
      expect(results[index].targetNewHp).toBe(30 - row.damageAmount);
    }
    expect(await usedSlots()).toBe(1);
    expect(await keyedRowsOf(wizSessionId, rollId)).toHaveLength(1);

    // The duplicate returns the first cast whole and spends nothing again.
    const replayed = await postTo(wizEncounterId, body);
    expect(replayed.status).toBe(200);
    expect(replayed.body.result.results).toEqual(results);
    expect(replayed.body.engineRows).toEqual([]);
    expect(
      await database
        .select()
        .from(combatDamageLog)
        .where(eq(combatDamageLog.encounterId, wizEncounterId)),
    ).toEqual(allDamage);
    expect(await usedSlots()).toBe(1);
    expect(await keyedRowsOf(wizSessionId, rollId)).toHaveLength(1);
  });
});
