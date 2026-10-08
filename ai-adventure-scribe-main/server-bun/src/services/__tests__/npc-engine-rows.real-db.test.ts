import { afterAll, beforeAll, expect, mock, spyOn, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { Elysia } from 'elysia';

import { closeRealDb, describeWithDb, hasRealDb, importWithRealDb, realDb, testId } from './fixtures/real-db.js';
import { campaigns, characters, characterStats, gameSessions, combatEncounters, combatParticipants, combatParticipantStatus, dialogueHistory } from '../../../../db/schema/index';
import { ENEMY_HITS_PLAYER, REEVES } from '../../../../shared/test-fixtures/engine-results';
import { resolveMonsterAttackProfile } from '../combat/monster-attack-profile.js';

const userId = testId('npc-engine-rows-user');
mock.module('../../lib/dice.js', () => ({ rollD20: () => 14 }));
mock.module('../../lib/auth.js', () => ({ authenticateRequest: async () => ({ user: { userId }, error: null }) }));
process.env.PORT ??= '8892';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';
const { advanceNpcTurnRoutes } = await importWithRealDb(() => import('../../routes/v1/combat/advance-npc-turns.js'));
const { intentRoutes } = await importWithRealDb(() => import('../../routes/v1/combat/intents.js'));
const { writeNpcEngineRow } = await importWithRealDb(() => import('../combat/npc-engine-row.js'));
const { CombatEncounterService } = await importWithRealDb(() => import('../combat/combat-encounter-service.js'));
const { SessionMessageService } = await importWithRealDb(() => import('../session/session-message-service.js'));
const { rooms } = await importWithRealDb(() => import('../collaboration/room-manager.js'));

describeWithDb('server NPC engine rows through the real routes (#2658 step 2)', () => {
  const database = hasRealDb ? realDb() : (null as never);
  let campaignId: string, characterId: string, sessionId: string, encounterId: string;
  let playerId: string;
  const sockets: Array<{ engineRows?: unknown[] }> = [];
  const app = hasRealDb ? new Elysia({ prefix: '/v1/combat' }).use(intentRoutes).use(advanceNpcTurnRoutes) : null;
  const post = async (path: string, body: unknown) => {
    const response = await app!.handle(new Request(`http://localhost/v1/combat/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));
    expect(response.status).toBe(200);
    return response.json();
  };
  const storedRows = () => database.select().from(dialogueHistory).where(and(
    eq(dialogueHistory.sessionId, sessionId), eq(dialogueHistory.speakerType, 'system'),
  ));
  beforeAll(async () => {
    [{ id: campaignId }] = await database.insert(campaigns).values({ userId, name: testId('camp') }).returning();
    [{ id: characterId }] = await database.insert(characters).values({ userId, campaignId, name: 'The Scholar', class: 'Fighter', level: 1 }).returning();
    await database.insert(characterStats).values({ characterId, currentHitPoints: 500, maxHitPoints: 500, armorClass: 11 });
    [{ id: sessionId }] = await database.insert(gameSessions).values({ campaignId, characterId, sessionNumber: 1, status: 'active' }).returning();
    [{ id: encounterId }] = await database.insert(combatEncounters).values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 }).returning();
    // Real producer: resolveMonsterAttackProfile, rather than a hand-built partial profile.
    const monsterAttack = resolveMonsterAttackProfile({ authored: { attackName: 'Strike', attackBonus: 20, damageDice: '1d1 + 2', damageType: 'slashing' } });
    const participants = await database.insert(combatParticipants).values([
      { encounterId, characterId, name: 'The Scholar', participantType: 'player', turnOrder: 0, initiative: 20, armorClass: 11, maxHp: 500, speed: 30 },
      { encounterId, name: 'Captain Sarah Reeves', participantType: 'monster', turnOrder: 1, initiative: 15, armorClass: 11, maxHp: 50, speed: 30, monsterAttack },
      { encounterId, name: 'Second Guard', participantType: 'monster', turnOrder: 2, initiative: 10, armorClass: 11, maxHp: 50, speed: 30, monsterAttack },
    ]).returning();
    playerId = participants[0].id;
    await database.insert(combatParticipantStatus).values(participants.map((participant) => ({ participantId: participant.id, currentHp: participant.maxHp, maxHp: participant.maxHp, isConscious: true })));
    rooms.set(sessionId, new Set([{ readyState: 1, data: { user: { userId, email: '' }, roomId: sessionId, requestId: '' }, send: (payload) => { sockets.push(JSON.parse(String(payload))); }, close: () => {} }]));
  });
  afterAll(async () => {
    rooms.delete(sessionId);
    await database.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await database.delete(characters).where(eq(characters.id, characterId));
    await database.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });
  test('one End turn triggers two NPC attacks: exactly two rows; response and socket rows equal persisted DB rows', async () => {
    await post(`${encounterId}/intent`, { intent: { type: 'end_turn', actorId: playerId } });
    const advanced = await post(`sessions/${sessionId}/advance-npc-turns`, {});
    expect(advanced.results).toHaveLength(2);
    expect(advanced.results.map((result: any) => result.engineResult.finalDamage)).toEqual([3, 3]);
    const [hp] = await database.select().from(combatParticipantStatus).where(eq(combatParticipantStatus.participantId, playerId));
    expect(hp.currentHp).toBe(494);
    expect(advanced.results.map((result: any) => result.action.action_type)).toEqual(['attack', 'attack']);
    const rows = await storedRows();
    expect(rows).toHaveLength(2);
    const wire = rows.map((row) => ({ id: row.id, sequence: row.sequenceNumber, text: row.message, kind: 'npc', sessionId: row.sessionId, timestamp: row.timestamp!.toISOString(), context: row.context, actionId: (row.context as { actionId: string }).actionId })).sort((a,b) => a.sequence! - b.sequence!);
    expect(advanced.engineRows).toEqual(wire);
    expect(sockets.flatMap((event) => event.engineRows ?? [])).toEqual(wire);
    expect(advanced.results.map((result: any) => result.engineResult.actionId)).toEqual(wire.map((row) => row.actionId));
    for (const result of advanced.results) {
      await post(`${encounterId}/intent`, { source: 'dm', intent: { type: 'attack', actorId: result.action.actor_id, targetId: playerId, actionId: result.engineResult.actionId } });
    }
    expect(await storedRows()).toEqual(rows);
    const [replayedHp] = await database.select().from(combatParticipantStatus).where(eq(combatParticipantStatus.participantId, playerId));
    expect(replayedHp.currentHp).toBe(494);
  });
  test('an insert failure rolls back NPC damage and turn advance; retry saves exactly one row per action', async () => {
    await post(`${encounterId}/intent`, { intent: { type: 'end_turn', actorId: playerId } });
    const before = await CombatEncounterService.getCombatState(encounterId, userId);
    const [hpBefore] = await database.select().from(characterStats).where(eq(characterStats.characterId, characterId));
    const count = (await storedRows()).length;
    const sent = sockets.length;
    const fail = spyOn(SessionMessageService, 'addMessages').mockImplementationOnce(async () => { throw new Error('insert failure'); });
    const response = await app!.handle(new Request(`http://localhost/v1/combat/sessions/${sessionId}/advance-npc-turns`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }));
    fail.mockRestore();
    expect(response.status).toBe(500);
    const after = await CombatEncounterService.getCombatState(encounterId, userId);
    expect(after.currentParticipant?.id).toBe(before.currentParticipant?.id);
    const [hpAfter] = await database.select().from(characterStats).where(eq(characterStats.characterId, characterId));
    expect(hpAfter.currentHitPoints).toBe(hpBefore.currentHitPoints);
    expect(await storedRows()).toHaveLength(count);
    expect(sockets).toHaveLength(sent);
    const retried = await post(`sessions/${sessionId}/advance-npc-turns`, {});
    expect(retried.engineRows).toHaveLength(2);
    expect(await storedRows()).toHaveLength(count + 2);
  });
  // Migrated from show-npc-turn-lines.cards.test.ts: the formatter receives the full
  // CombatAttackService.resolveAttack + exposeAttackVisibility fixture from engine-results.
  test('arrive as a card on the enemy side, with the player HP, and keep the engine line as text', async () => {
    const state = await CombatEncounterService.getCombatState(encounterId, userId);
    const rows = await writeNpcEngineRow({ ...state, participants: state.participants.map((participant) => participant.id === playerId ? { ...participant, maxHp: 7 } : participant) },
      { type: 'attack', actorId: REEVES.id, targetId: playerId }, 'migrated-card', { ...ENEMY_HITS_PLAYER, targetId: playerId }, userId);
    const [stored] = await database.select().from(dialogueHistory).where(eq(dialogueHistory.id, rows[0].id));
    expect(stored.message).toContain('Captain Sarah Reeves rolled 14 + 0 = 14 vs AC 11');
    const [card] = (stored.context as { engineCards: any[] }).engineCards;
    expect(card.side).toBe('enemy');
    expect(card.badge).toEqual({ word: 'HIT', tone: 'red', icon: 'alert' });
    expect(card.hp).toEqual({ name: 'The Scholar', newHp: 4, lost: 3, maxHp: 7 });
  });
  test('has no cards for a line with no result behind it', async () => {
    const state = await CombatEncounterService.getCombatState(encounterId, userId);
    const rows = await writeNpcEngineRow(state, { type: 'end_turn', actorId: state.participants[1].id }, 'migrated-boundary', {}, userId);
    const [stored] = await database.select().from(dialogueHistory).where(eq(dialogueHistory.id, rows[0].id));
    expect(stored.message).toContain('ended their turn');
    expect((stored.context as { engineCards: unknown[] }).engineCards).toEqual([]);
  });
});
