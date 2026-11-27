/**
 * #1758 (Hark N24-006): a hero walked out of an adjacent foe's reach with the small-map Move, no
 * Disengage, and the foe made no opportunity attack on four turns.
 *
 * 2014 SRD: leaving a hostile creature's reach without Disengage provokes one opportunity attack,
 * if that creature can see you and has its reaction. One hero, one foe, one board, through
 * `executeCombatIntent` — the function the Move control's intent route calls.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { afterAll, afterEach, beforeEach, expect, spyOn, test, mock } from 'bun:test';
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
  dialogueHistory,
  narrativeFacts,
  tacticalMaps,
} from '../../../../db/schema/index';

import type { MonsterAttackProfile } from '../combat/monster-attack-profile.js';

const userId = testId('dutch-route-user');
mock.module('../../lib/auth.js', () => ({
  authenticateRequest: async () => ({ user: { userId }, error: null }),
}));
const { createRequestPipelineApp } = await importWithRealDb(() => import('../../http-pipeline.js'));
const { intentRoutes } = await importWithRealDb(() => import('../../routes/v1/combat/intents.js'));
const app = hasRealDb
  ? createRequestPipelineApp().group('/v1/combat', (group) => group.use(intentRoutes))
  : null;
const { consumeDmTacticalFacts } = await importWithRealDb(
  () => import('../combat/tactical-action-service.js'),
);
const { saveTacticalMap, loadActiveTacticalMap } = await importWithRealDb(
  () => import('../combat/tactical-map-store.js'),
);
const HERO_HP = 30;
const FISTS: MonsterAttackProfile['attacks'][number] = {
  name: 'Unarmed Strike',
  attackBonus: 4,
  damageDice: '1d1',
  damageBonus: 2,
  damageType: 'bludgeoning',
  ranged: false,
  normalRange: 5,
};
describeWithDb(
  'a foe makes an opportunity attack when the hero walks out of its reach (#1758)',
  () => {
    const db = hasRealDb ? realDb() : (null as never);

    let campaignId: string;
    let characterId: string;
    let sessionId: string;
    let encounterId: string;
    let heroId: string;
    let foeId: string;
    const createdSessionIds: string[] = [];

    const floorCell = () => ({
      terrain: 'floor' as const,
      blocksMovement: false,
      blocksSight: false,
      cover: 0 as const,
      elevation: 0,
    });

    const setFoeAttacks = async (attacks: MonsterAttackProfile['attacks']) => {
      const profile: MonsterAttackProfile = { source: 'authored', attacks };
      await db
        .update(combatParticipants)
        .set({ monsterAttack: profile })
        .where(eq(combatParticipants.id, foeId));
    };

    beforeEach(async () => {
      if (!hasRealDb) return;
      if (!campaignId) {
        [{ id: campaignId }] = await db
          .insert(campaigns)
          .values({ userId, name: testId('oa-move-camp') })
          .returning({ id: campaigns.id });
        [{ id: characterId }] = await db
          .insert(characters)
          .values({ userId, campaignId, name: 'Esme', level: 3, class: 'Fighter' })
          .returning({ id: characters.id });
        await db.insert(characterStats).values({
          characterId,
          strength: 14,
          armorClass: 18,
          maxHitPoints: HERO_HP,
          currentHitPoints: HERO_HP,
          speed: 30,
        });
      }
      [{ id: sessionId }] = await db
        .insert(gameSessions)
        .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
        .returning({ id: gameSessions.id });
      createdSessionIds.push(sessionId);
      [{ id: encounterId }] = await db
        .insert(combatEncounters)
        .values({ sessionId, status: 'active', currentRound: 2, currentTurnOrder: 0, version: 1 })
        .returning({ id: combatEncounters.id });
      const inserted = await db
        .insert(combatParticipants)
        .values([
          {
            encounterId,
            characterId,
            name: 'Esme',
            participantType: 'player',
            turnOrder: 0,
            initiative: 18,
            armorClass: 18,
            maxHp: HERO_HP,
            speed: 30,
          },
          {
            encounterId,
            name: 'Dutch Pellam',
            participantType: 'monster',
            turnOrder: 1,
            initiative: 9,
            armorClass: 12,
            maxHp: 20,
            speed: 30,
          },
        ])
        .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
      heroId = inserted.find((row) => row.turnOrder === 0)!.id;
      foeId = inserted.find((row) => row.turnOrder === 1)!.id;
      await db.insert(combatParticipantStatus).values([
        { participantId: heroId, currentHp: HERO_HP, maxHp: HERO_HP, isConscious: true },
        { participantId: foeId, currentHp: 20, maxHp: 20, isConscious: true },
      ]);
      await setFoeAttacks([FISTS]);
      // Hero and Dutch start adjacent on the 10 × 10 board. The tested move walks three cells west.
      await saveTacticalMap({
        id: crypto.randomUUID(),
        sessionId,
        width: 10,
        height: 10,
        cells: Array.from({ length: 10 }, () => Array.from({ length: 10 }, floorCell)),
        entities: [
          {
            id: heroId,
            slug: 'the-boxer',
            x: 5,
            y: 4,
            size: 'medium',
            type: 'pc',
            speedFeet: 30,
            movementRemaining: 30,
          },
          {
            id: foeId,
            slug: 'dutch-pellam',
            x: 6,
            y: 4,
            size: 'medium',
            type: 'monster',
            speedFeet: 30,
            movementRemaining: 30,
          },
        ],
        round: 2,
        sceneDescription: 'ring',
      });
      await consumeDmTacticalFacts(sessionId);
    });

    afterEach(() => {
      (Math.random as unknown as { mockRestore?: () => void }).mockRestore?.();
    });

    afterAll(async () => {
      if (!hasRealDb) return;
      const rows = await db
        .select({ id: combatParticipants.id })
        .from(combatParticipants)
        .innerJoin(combatEncounters, eq(combatParticipants.encounterId, combatEncounters.id))
        .where(inArray(combatEncounters.sessionId, createdSessionIds));
      const ids = rows.map((row) => row.id);
      if (ids.length) {
        await db
          .delete(combatParticipantStatus)
          .where(inArray(combatParticipantStatus.participantId, ids));
        await db.delete(combatParticipants).where(inArray(combatParticipants.id, ids));
      }
      await db.delete(narrativeFacts).where(inArray(narrativeFacts.sessionId, createdSessionIds));
      await db.delete(tacticalMaps).where(inArray(tacticalMaps.sessionId, createdSessionIds));
      await db
        .delete(combatEncounters)
        .where(inArray(combatEncounters.sessionId, createdSessionIds));
      await db.delete(gameSessions).where(inArray(gameSessions.id, createdSessionIds));
      await db.delete(characterStats).where(eq(characterStats.characterId, characterId));
      await db.delete(characters).where(eq(characters.id, characterId));
      await db.delete(campaigns).where(eq(campaigns.id, campaignId));
      await closeRealDb();
    });

    const move = () =>
      app!.handle(
        new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
          method: 'POST',
          headers: { authorization: `Bearer ${userId}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            intent: { type: 'move', actorId: heroId, x: 2, y: 4 },
            source: 'player',
            origin: 'action_bar',
          }),
        }),
      );

    const foeRow = async () => {
      const [row] = await db
        .select({
          actionUsed: combatParticipants.actionUsed,
          reactionUsed: combatParticipants.reactionUsed,
        })
        .from(combatParticipants)
        .where(eq(combatParticipants.id, foeId));
      return row;
    };

    const heroAt = async () =>
      (await loadActiveTacticalMap(sessionId))?.entities.find((entity) => entity.id === heroId);

    const attackLines = async () =>
      (await consumeDmTacticalFacts(sessionId)).filter((fact) =>
        fact.includes('Dutch Pellam attacked Esme'),
      );

    test('a round-two, 15 ft small-map click provokes one Unarmed Strike from adjacent Dutch', async () => {
      spyOn(Math, 'random').mockReturnValue(0.37);
      const response = await move();
      expect(response.status).toBe(200);
      const { result } = await response.json();
      expect(result.path).toHaveLength(4);
      expect(await heroAt()).toMatchObject({ x: 2, y: 4 });
      expect(await attackLines()).toEqual([expect.stringContaining('with its Unarmed Strike')]);
      expect(await foeRow()).toMatchObject({ actionUsed: false, reactionUsed: true });
      const rows = await db
        .select({ text: dialogueHistory.message })
        .from(dialogueHistory)
        .where(eq(dialogueHistory.sessionId, sessionId));
      const reactions = rows.filter(({ text }) => text.startsWith('Opportunity attack:'));
      expect(reactions).toEqual([
        { text: expect.stringMatching(/Dutch Pellam.*Unarmed Strike.*miss/i) },
      ]);
    });
  },
);
