/**
 * #1227: a save, auto-hit or area spell chip commits to the engine with the chip's slot and
 * target. These are the exact bodies the ActionBar sends (shared fixture, asserted on the client
 * in use-combat-legal-actions.spell-chips.test.tsx), posted through the real routes against a
 * real database:
 *
 * - Burning Hands upcast with a 2nd-level slot (1st-level slots spent): the Cast menu offers the
 *   chip aimed at the creature, the area route resolves the cone at its cell, a 2nd-level slot
 *   is spent, and the engine's damage row matches the result.
 * - Magic Missile at 1st level through the intent route: a 1st-level slot is spent and the
 *   engine resolves the three darts (3d4 + 3) with no player die.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see services/__tests__/fixtures/real-db.ts.
 */
import { afterAll, expect, mock, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';

import {
  campaigns,
  characters,
  characterSpellSlots,
  characterStats,
  combatDamageLog,
  combatEncounters,
  combatParticipants,
  combatParticipantStatus,
  gameSessions,
  tacticalMaps,
} from '../../../../../db/schema/index';
import {
  burningHandsChipAoECast,
  magicMissileChipIntent,
} from '../../../../../shared/test-fixtures/spell-chip-casts';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../services/__tests__/fixtures/real-db.js';

import type { TacticalMap } from '../../../tactical/types.js';

process.env.PORT ??= '8894';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';

const USER_PREFIX = 'spell-chip-casts-user-';
const userId = `${USER_PREFIX}${process.pid}`;

// Only authentication is replaced: a bearer of `Bearer <userId>` is that user.
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
    return token?.startsWith(USER_PREFIX)
      ? { user: { userId: token, email: 'player@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' };
  },
}));

const { createRequestPipelineApp } = await importWithRealDb(
  () => import('../../../http-pipeline.js'),
);
const { tacticalMapRoutes } = await importWithRealDb(() => import('../tactical-maps.js'));
const { combatRoutes } = await importWithRealDb(() => import('../combat/index.js'));

if (!hasRealDb) {
  console.warn('[spell-chip-casts] SKIPPED: set TEST_DATABASE_URL to run these.');
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describeWithDb('save, auto-hit and area spell chips through the real routes (#1227)', () => {
  const app = hasRealDb
    ? createRequestPipelineApp().use(tacticalMapRoutes).use(combatRoutes)
    : (null as never);
  const seeded: Array<{ campaignId: string; characterId: string; sessionId: string }> = [];

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { authorization: `Bearer ${userId}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: response.status, json: (await response.json()) as Json };
  };

  /** An L3 Wizard holding the turn against one Rubble Sentinel two cells away on a board. */
  const seedWizardFight = async () => {
    const db = realDb();
    const [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('1227-camp') })
      .returning({ id: campaigns.id });
    const [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: 'Adda',
        class: 'Wizard',
        level: 3,
        preparedSpells: 'Burning Hands, Magic Missile',
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      intelligence: 16,
      currentHitPoints: 20,
      maxHitPoints: 20,
      armorClass: 12,
      speed: 30,
    });
    await db.insert(characterSpellSlots).values([
      { characterId, spellLevel: 1, totalSlots: 4, usedSlots: 0 },
      { characterId, spellLevel: 2, totalSlots: 2, usedSlots: 0 },
    ]);
    const [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    seeded.push({ campaignId, characterId, sessionId });
    const [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });
    const participants = await db
      .insert(combatParticipants)
      .values([
        {
          encounterId,
          characterId,
          name: 'Adda',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 12,
          maxHp: 20,
          speed: 30,
        },
        {
          encounterId,
          name: 'Rubble Sentinel',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 10,
          armorClass: 11,
          maxHp: 60,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
    const wizardId = participants.find((row) => row.turnOrder === 0)!.id;
    const sentinelId = participants.find((row) => row.turnOrder === 1)!.id;
    await db.insert(combatParticipantStatus).values([
      { participantId: wizardId, currentHp: 20, maxHp: 20, isConscious: true },
      { participantId: sentinelId, currentHp: 60, maxHp: 60, isConscious: true },
    ]);
    const mapId = crypto.randomUUID();
    const state: TacticalMap = {
      id: mapId,
      sessionId,
      width: 12,
      height: 10,
      round: 1,
      sceneDescription: 'A collapsed quarry',
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
          id: wizardId,
          slug: 'adda',
          x: 3,
          y: 3,
          size: 'medium',
          type: 'pc',
          speedFeet: 30,
          movementRemaining: 30,
        },
        {
          id: sentinelId,
          slug: 'rubble-sentinel',
          x: 5,
          y: 3,
          size: 'medium',
          type: 'monster',
          speedFeet: 30,
          movementRemaining: 30,
        },
      ],
      pendingDmCorrection: '',
      pendingDmFacts: [],
      pendingDmFactActions: [],
      dmSilentTurns: 0,
    };
    await db.insert(tacticalMaps).values({ id: mapId, sessionId, state, active: true });
    return { characterId, sessionId, encounterId, wizardId, sentinelId };
  };

  const usedSlotsOf = async (characterId: string, spellLevel: number) => {
    const [row] = await realDb()
      .select({ usedSlots: characterSpellSlots.usedSlots })
      .from(characterSpellSlots)
      .where(
        and(
          eq(characterSpellSlots.characterId, characterId),
          eq(characterSpellSlots.spellLevel, spellLevel),
        ),
      );
    return row.usedSlots;
  };

  const damageRowsFor = (encounterId: string, participantId: string) =>
    realDb()
      .select({ damageAmount: combatDamageLog.damageAmount })
      .from(combatDamageLog)
      .where(
        and(
          eq(combatDamageLog.encounterId, encounterId),
          eq(combatDamageLog.participantId, participantId),
        ),
      );

  afterAll(async () => {
    if (!hasRealDb) return;
    const db = realDb();
    for (const row of seeded) {
      await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, row.sessionId));
      await db.delete(gameSessions).where(eq(gameSessions.id, row.sessionId));
      await db.delete(characters).where(eq(characters.id, row.characterId));
      await db.delete(campaigns).where(eq(campaigns.id, row.campaignId));
    }
    await closeRealDb();
  });

  test('Burning Hands from the chip, upcast at 2nd level: aimed at the creature, an L2 slot spent', async () => {
    const { characterId, encounterId, wizardId, sentinelId } = await seedWizardFight();
    await realDb()
      .update(characterSpellSlots)
      .set({ usedSlots: 4 })
      .where(
        and(
          eq(characterSpellSlots.characterId, characterId),
          eq(characterSpellSlots.spellLevel, 1),
        ),
      );

    // The Cast menu offers the chip with the slot it spends and the creature it aims at.
    const legal = await call('GET', `/v1/combat/${encounterId}/legal-actions`);
    expect(legal.status).toBe(200);
    expect(legal.json.actions).toContainEqual({
      type: 'spell',
      label: 'Cast Burning Hands (2nd-level slot)',
      spellId: 'burning-hands',
      slotLevel: 2,
      targetIds: [sentinelId],
    });

    // The exact body the ActionBar posts, aimed at the Rubble Sentinel's cell.
    const cast = await call(
      'POST',
      `/v1/sessions/${seeded.at(-1)!.sessionId}/tactical-map/aoe-cast`,
      burningHandsChipAoECast(wizardId, { x: 5, y: 3 }),
    );
    expect(cast.status, JSON.stringify(cast.json)).toBe(200);
    expect(await usedSlotsOf(characterId, 2)).toBe(1);
    expect(await usedSlotsOf(characterId, 1)).toBe(4);
    const outcome = (cast.json.result.results as Json[])[0];
    expect(outcome.spellName).toBe('Burning Hands');
    // 4d6 from a 2nd-level slot, halved (rounded down) on a successful save.
    expect(outcome.damage).toBeGreaterThanOrEqual(4);
    expect(outcome.damage).toBeLessThanOrEqual(24);
    expect(outcome.finalDamage).toBe(
      outcome.saved ? Math.floor((outcome.damage as number) / 2) : outcome.damage,
    );
    // The engine's own row matches the result it returned.
    expect(cast.json.delta.targets).toContainEqual(
      expect.objectContaining({ entityId: sentinelId, finalDamage: outcome.finalDamage }),
    );
    const rows = await damageRowsFor(encounterId, sentinelId);
    expect(rows.map((row) => row.damageAmount)).toEqual(
      outcome.finalDamage > 0 ? [outcome.finalDamage] : [],
    );
  });

  test('Magic Missile from the chip at 1st level: an L1 slot spent, three darts resolved by the engine', async () => {
    const { characterId, encounterId, wizardId, sentinelId } = await seedWizardFight();

    const cast = await call('POST', `/v1/combat/${encounterId}/intent`, {
      source: 'dm',
      intent: magicMissileChipIntent(wizardId, sentinelId),
      dmStartedAt: 1730000000000,
      origin: 'action_bar',
    });
    expect(cast.status, JSON.stringify(cast.json)).toBe(200);
    expect(await usedSlotsOf(characterId, 1)).toBe(1);
    expect(await usedSlotsOf(characterId, 2)).toBe(0);
    const outcome = (cast.json.result.results as Json[])[0];
    // Three darts at 1st level, all on the one target: 3d4 + 3.
    expect(outcome.finalDamage).toBeGreaterThanOrEqual(6);
    expect(outcome.finalDamage).toBeLessThanOrEqual(15);
    const rows = await damageRowsFor(encounterId, sentinelId);
    expect(rows.map((row) => row.damageAmount)).toEqual([outcome.finalDamage]);
  });
});
