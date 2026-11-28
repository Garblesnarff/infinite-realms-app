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

import type { MonsterAttackProfile } from '../combat/monster-attack-profile.js';

const { consumeDmTacticalFacts } = await importWithRealDb(
  () => import('../combat/tactical-action-service.js'),
);
const { saveTacticalMap, loadActiveTacticalMap } = await importWithRealDb(
  () => import('../combat/tactical-map-store.js'),
);
const { executeCombatIntent } = await importWithRealDb(
  () => import('../combat/combat-intent-service.js'),
);

const HERO_HP = 30;

const SHORTSWORD: MonsterAttackProfile['attacks'][number] = {
  name: 'Shortsword',
  attackBonus: 4,
  damageDice: '1d6',
  damageBonus: 2,
  damageType: 'piercing',
  ranged: false,
  normalRange: 5,
};

const LIGHT_CROSSBOW: MonsterAttackProfile['attacks'][number] = {
  name: 'Light Crossbow',
  attackBonus: 3,
  damageDice: '1d8',
  damageBonus: 1,
  damageType: 'piercing',
  ranged: true,
  normalRange: 80,
  longRange: 320,
};

describeWithDb(
  'a foe makes an opportunity attack when the hero walks out of its reach (#1758)',
  () => {
    const db = hasRealDb ? realDb() : (null as never);
    const userId = testId('oa-move-user');

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
          .values({ userId, campaignId, name: 'The Boxer', level: 3, class: 'Fighter' })
          .returning({ id: characters.id });
        await db.insert(characterStats).values({
          characterId,
          strength: 14,
          armorClass: 10,
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
            name: 'The Boxer',
            participantType: 'player',
            turnOrder: 0,
            initiative: 18,
            armorClass: 10,
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
      await setFoeAttacks([SHORTSWORD]);
      // Hero at (5,4), foe adjacent at (6,4). The board is wide enough that a 20 ft move west
      // stays off the outer ring, so no exit is recorded and the case measures only the reaction.
      await saveTacticalMap({
        id: crypto.randomUUID(),
        sessionId,
        width: 14,
        height: 10,
        cells: Array.from({ length: 10 }, () => Array.from({ length: 14 }, floorCell)),
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

    const move = (x: number, y: number) =>
      executeCombatIntent(
        encounterId,
        { type: 'move', actorId: heroId, x, y },
        userId,
        'player',
        Date.now(),
        'action_bar',
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
        fact.includes('Dutch Pellam attacked The Boxer'),
      );

    test('a 20 ft Move away with no Disengage provokes exactly one opportunity attack, as a reaction', async () => {
      spyOn(Math, 'random').mockReturnValue(0.5);
      await move(1, 4);
      expect(await heroAt()).toMatchObject({ x: 1, y: 4 });
      const attacks = await attackLines();
      expect(attacks).toHaveLength(1);
      expect(attacks[0]).toMatch(/with its Shortsword/);
      expect(attacks[0]).toMatch(/MISS|for \d+ damage/);
      expect(await foeRow()).toMatchObject({ actionUsed: false, reactionUsed: true });
    });

    test('with Disengage first, the same Move provokes nothing', async () => {
      await executeCombatIntent(
        encounterId,
        { type: 'disengage', actorId: heroId, expectedVersion: 1 },
        userId,
        'player',
        Date.now(),
        'action_bar',
      );
      await consumeDmTacticalFacts(sessionId);
      await move(1, 4);
      expect(await heroAt()).toMatchObject({ x: 1, y: 4 });
      expect(await attackLines()).toHaveLength(0);
      expect(await foeRow()).toMatchObject({ reactionUsed: false });
    });

    test('a second Move out of reach in the same round provokes nothing: the reaction is spent', async () => {
      spyOn(Math, 'random').mockReturnValue(0.5);
      await move(3, 4);
      expect(await attackLines()).toHaveLength(1);
      // The foe closes again (its position only; its reaction stays spent this round).
      const map = await loadActiveTacticalMap(sessionId);
      if (!map) throw new Error('fixture board missing');
      map.entities.find((entity) => entity.id === foeId)!.x = 4;
      await saveTacticalMap(map);
      await consumeDmTacticalFacts(sessionId);
      await move(1, 4);
      expect(await heroAt()).toMatchObject({ x: 1, y: 4 });
      expect(await attackLines()).toHaveLength(0);
    });

    const dagger = {
      ...SHORTSWORD,
      name: 'Dagger',
      damageDice: '1d4',
      ranged: true,
      normalRange: 20,
      longRange: 60,
    };
    test.each([SHORTSWORD, dagger])(
      'a foe whose first attack is ranged makes an opportunity attack with $name',
      async (meleeWeapon) => {
        // The opportunity attack is a melee attack, so a creature that HAS a melee weapon in reach
        // gets one even when its first listed attack is a crossbow.
        await setFoeAttacks([LIGHT_CROSSBOW, meleeWeapon]);
        spyOn(Math, 'random').mockReturnValue(0.5);
        await move(1, 4);
        const attacks = await attackLines();
        expect(attacks).toHaveLength(1);
        expect(attacks[0]).toContain(`with its ${meleeWeapon.name}`);
        expect(await foeRow()).toMatchObject({ actionUsed: false, reactionUsed: true });
      },
    );
    test('a ranged-only foe uses an unarmed strike when the hero leaves melee reach', async () => {
      await setFoeAttacks([LIGHT_CROSSBOW]);
      spyOn(Math, 'random').mockReturnValue(0.5);
      await move(1, 4);
      expect(await attackLines()).toEqual([expect.stringContaining('with its Unarmed Strike')]);
      expect(await foeRow()).toMatchObject({ actionUsed: false, reactionUsed: true });
    });
  },
);
