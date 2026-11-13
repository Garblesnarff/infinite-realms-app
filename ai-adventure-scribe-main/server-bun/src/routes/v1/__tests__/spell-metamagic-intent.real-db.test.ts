/**
 * #1233: a Metamagic cast through the real intent route. The body is the spell chip's wire body
 * with the armed option (shared/test-fixtures/metamagic-spell-intent.ts), posted against a real
 * database. The engine checks the stored list, spends the sorcery points for the option, and
 * claims the bonus action for Quickened. A refusal spends nothing.
 */
import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { and, eq, inArray } from 'drizzle-orm';

import {
  campaigns,
  characterFeatures,
  characterSpellSlots,
  characterStats,
  characters,
  classFeaturesLibrary,
  combatEncounters,
  combatParticipants,
  combatParticipantStatus,
  gameSessions,
  tacticalMaps,
} from '../../../../../db/schema/index';
import { metamagicEnvelopeJson } from '../../../../../shared/test-fixtures/metamagic-envelope';
import { metamagicMagicMissileBody } from '../../../../../shared/test-fixtures/metamagic-spell-intent';
import { setRngSeed } from '../../../lib/rng.js';
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

const USER_PREFIX = 'spell-metamagic-user-';
const userId = `${USER_PREFIX}${process.pid}`;

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
    return token?.startsWith(USER_PREFIX)
      ? { user: { userId: token, email: 'sorcerer@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' };
  },
}));

const { createRequestPipelineApp } = await importWithRealDb(
  () => import('../../../http-pipeline.js'),
);
const { combatRoutes } = await importWithRealDb(() => import('../combat/index.js'));

if (!hasRealDb) {
  console.warn('[spell-metamagic] SKIPPED: set TEST_DATABASE_URL to run these.');
}

describeWithDb('Metamagic casts through the real intent route (#1233)', () => {
  const app = hasRealDb ? createRequestPipelineApp().use(combatRoutes) : (null as never);
  const seeded: Array<{ campaignId: string; characterId: string; sessionId: string }> = [];
  let fontId = '';
  let heroId = '';
  let foeId = '';
  let encounterId = '';
  let characterId = '';
  let sessionId = '';

  const post = async (body: unknown) => {
    const response = await app.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
        method: 'POST',
        headers: { authorization: `Bearer ${userId}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, text: await response.text() };
  };

  const points = async () => {
    const [row] = await realDb()
      .select({ usesRemaining: characterFeatures.usesRemaining })
      .from(characterFeatures)
      .where(
        and(
          eq(characterFeatures.characterId, characterId),
          eq(characterFeatures.featureId, fontId),
        ),
      );
    return row.usesRemaining;
  };

  const usedSlots = async (level: number) => {
    const [row] = await realDb()
      .select({ usedSlots: characterSpellSlots.usedSlots })
      .from(characterSpellSlots)
      .where(
        and(
          eq(characterSpellSlots.characterId, characterId),
          eq(characterSpellSlots.spellLevel, level),
        ),
      );
    return row.usedSlots;
  };

  const turn = async (pointsNow: number) => {
    const db = realDb();
    await db
      .update(characterFeatures)
      .set({ usesRemaining: pointsNow })
      .where(
        and(
          eq(characterFeatures.characterId, characterId),
          eq(characterFeatures.featureId, fontId),
        ),
      );
    await db
      .update(characterSpellSlots)
      .set({ usedSlots: 0 })
      .where(eq(characterSpellSlots.characterId, characterId));
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false })
      .where(eq(combatParticipants.id, heroId));
    await db
      .update(combatEncounters)
      .set({ currentTurnOrder: 0, currentRound: 1, version: 1 })
      .where(eq(combatEncounters.id, encounterId));
  };

  const participantFlags = async () => {
    const [row] = await realDb()
      .select({
        actionUsed: combatParticipants.actionUsed,
        bonusActionUsed: combatParticipants.bonusActionUsed,
      })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, heroId));
    return row;
  };

  beforeAll(async () => {
    if (!hasRealDb) return;
    const db = realDb();
    const library = await db
      .select({ id: classFeaturesLibrary.id })
      .from(classFeaturesLibrary)
      .where(
        and(
          eq(classFeaturesLibrary.className, 'Sorcerer'),
          inArray(classFeaturesLibrary.featureName, ['Font of Magic']),
        ),
      );
    fontId = library[0]?.id ?? '';
    expect(fontId).toBeTruthy();

    const [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('1233-metamagic-camp') })
      .returning({ id: campaigns.id });
    [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: 'Sable',
        class: 'Sorcerer',
        level: 3,
        classLevels: [{ className: 'Sorcerer', level: 3 }],
        preparedSpells: 'Magic Missile',
        personalityNotes: metamagicEnvelopeJson(['quickened', 'careful']),
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      charisma: 16,
      currentHitPoints: 16,
      maxHitPoints: 16,
      armorClass: 12,
      speed: 30,
    });
    await db.insert(characterFeatures).values({
      characterId,
      featureId: fontId,
      usesRemaining: 3,
      isActive: true,
      acquiredAtLevel: 2,
    });
    await db.insert(characterSpellSlots).values([
      { characterId, spellLevel: 1, totalSlots: 4, usedSlots: 0 },
      { characterId, spellLevel: 2, totalSlots: 2, usedSlots: 0 },
    ]);
    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    seeded.push({ campaignId, characterId, sessionId });
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
          name: 'Sable',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 12,
          maxHp: 16,
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
    heroId = inserted.find((row) => row.turnOrder === 0)!.id;
    foeId = inserted.find((row) => row.turnOrder === 1)!.id;
    await db.insert(combatParticipantStatus).values([
      { participantId: heroId, currentHp: 16, maxHp: 16, isConscious: true },
      { participantId: foeId, currentHp: 60, maxHp: 60, isConscious: true },
    ]);
    await db.insert(tacticalMaps).values({
      sessionId,
      state: {
        id: crypto.randomUUID(),
        sessionId,
        width: 12,
        height: 10,
        round: 1,
        sceneDescription: '1233 metamagic fixture',
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
            id: heroId,
            slug: 'sable',
            x: 3,
            y: 3,
            size: 'medium',
            type: 'pc',
            speedFeet: 30,
            movementRemaining: 30,
          },
          {
            id: foeId,
            slug: 'rubble-sentinel',
            x: 5,
            y: 3,
            size: 'medium',
            type: 'monster',
            speedFeet: 30,
            movementRemaining: 30,
          },
        ],
      } as TacticalMap,
      active: true,
    });
  });

  beforeEach(() => {
    setRngSeed(1233);
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    const db = realDb();
    for (const row of seeded) {
      await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, row.sessionId));
      await db
        .delete(characterSpellSlots)
        .where(eq(characterSpellSlots.characterId, row.characterId));
      await db.delete(characterFeatures).where(eq(characterFeatures.characterId, row.characterId));
      await db.delete(gameSessions).where(eq(gameSessions.id, row.sessionId));
      await db.delete(characters).where(eq(characters.id, row.characterId));
      await db.delete(campaigns).where(eq(campaigns.id, row.campaignId));
    }
    setRngSeed(undefined);
    await closeRealDb();
  });

  test('a quickened Magic Missile spends 2 points and the bonus action, not the action', async () => {
    await turn(3);
    const response = await post(metamagicMagicMissileBody(heroId, foeId, 'quickened'));
    expect(response.status, response.text).toBe(200);
    expect(await points()).toBe(1);
    expect(await usedSlots(1)).toBe(1);
    const flags = await participantFlags();
    expect(flags.bonusActionUsed).toBe(true);
    expect(flags.actionUsed).toBe(false);
  });

  test('a quickened cast with one point left is refused, spends nothing, and keeps the bonus action', async () => {
    await turn(1);
    const response = await post(metamagicMagicMissileBody(heroId, foeId, 'quickened'));
    expect(response.status).toBe(422);
    expect(await points()).toBe(1);
    expect(await usedSlots(1)).toBe(0);
    const flags = await participantFlags();
    expect(flags.bonusActionUsed).toBe(false);
    expect(flags.actionUsed).toBe(false);
  });

  test('an option the Sorcerer does not know is refused and spends nothing', async () => {
    await turn(3);
    const response = await post(metamagicMagicMissileBody(heroId, foeId, 'subtle'));
    expect(response.status).toBe(422);
    expect(await points()).toBe(3);
    expect(await usedSlots(1)).toBe(0);
  });

  test('the cast with the option resolves the engine darts in the response', async () => {
    await turn(3);
    const response = await post(metamagicMagicMissileBody(heroId, foeId, 'quickened'));
    expect(response.status).toBe(200);
    const body = JSON.parse(response.text) as { result: { results: unknown[] } };
    expect(body.result.results).toHaveLength(1);
  });

  // #1233 (strategist FIX): Twinned Spell applies only to a spell that can target one creature.
  // Magic Missile hits up to three creatures, so Twinned is refused at its cast, with no cost.
  test('Twinned Magic Missile is refused with 422 at the cast, and spends nothing', async () => {
    const db = realDb();
    await db
      .update(characters)
      .set({ personalityNotes: metamagicEnvelopeJson(['twinned', 'careful']) })
      .where(eq(characters.id, characterId));
    try {
      await turn(3);
      const response = await post(metamagicMagicMissileBody(heroId, foeId, 'twinned'));
      expect(response.status).toBe(422);
      expect(response.text).toContain('Twinned Spell cannot apply to Magic Missile');
      expect(await points()).toBe(3);
      expect(await usedSlots(1)).toBe(0);
    } finally {
      await db
        .update(characters)
        .set({ personalityNotes: metamagicEnvelopeJson(['quickened', 'careful']) })
        .where(eq(characters.id, characterId));
    }
  });

  // #1508: Twinned fails closed. A spell that is not on the single-target allowlist is refused
  // with 422 at the cast, whatever the body names, and spends nothing.
  test('Twinned on a spell that is not on the single-target allowlist is refused with 422', async () => {
    const db = realDb();
    await db
      .update(characters)
      .set({ personalityNotes: metamagicEnvelopeJson(['twinned', 'careful']) })
      .where(eq(characters.id, characterId));
    try {
      await turn(3);
      const body = {
        ...metamagicMagicMissileBody(heroId, foeId, 'twinned'),
        intent: {
          ...metamagicMagicMissileBody(heroId, foeId, 'twinned').intent,
          spellId: 'not-a-catalog-spell',
          spellName: 'Not A Catalog Spell',
        },
      };
      const response = await post(body);
      expect(response.status).toBe(422);
      expect(await points()).toBe(3);
      expect(await usedSlots(1)).toBe(0);
    } finally {
      await db
        .update(characters)
        .set({ personalityNotes: metamagicEnvelopeJson(['quickened', 'careful']) })
        .where(eq(characters.id, characterId));
    }
  });
});
