/**
 * #569: a declared weapon attack opens combat with that weapon, not Unarmed Strike.
 *
 * Real route (POST /sessions/:id/enter), real Postgres. The character carries an equipped
 * Shortsword in the inventory and the player declares "I attack the Dragon Goldscale with my
 * shortsword". The declaration is built with the real parser (`detectDeclaredAttack`), the
 * same way /declared-attack builds it, and the body is sent to the route unchanged.
 *
 * 2014 SRD rules checked here: a Shortsword is Finesse, so the attack uses the higher of STR
 * or DEX. STR 16 (+3) beats DEX 14 (+2). Proficiency at level 1 is +2. To-hit = 1d20 + 5.
 * Damage is the weapon's own 1d6 (piercing), read from the engine's weapon profile.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq, like } from 'drizzle-orm';
import { Elysia } from 'elysia';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  realDbUrl,
  testId,
} from './fixtures/real-db.js';
import {
  campaigns,
  characterStats,
  characters,
  combatParticipants,
  gameSessions,
  inventoryItems,
  npcs,
} from '../../../../db/schema/index';

const FIXTURE_OWNER_PREFIX = 'combat-entry-declared-weapon-569-user-';
const PLAYER_NAME = 'Rook';
const DRAGON_NAME = 'Dragon Goldscale';

/**
 * The player's words, with the creature they can mean when the words do not name it.
 */
const DECLARATIONS: Array<[string, string, { name: string } | null]> = [
  ['named target', 'I attack the Dragon Goldscale with my shortsword', null],
  ['pronoun target, antecedent', 'I attack it with my shortsword', { name: DRAGON_NAME }],
];

// The guard above the DATABASE_URL line in sibling suites is not needed here: this suite only
// reads and writes rows it owns, under a per-run owner id, and CI runs it against its own
// database. Point it at the same single variable the rest of the server suite uses.
if (hasRealDb) process.env.DATABASE_URL = realDbUrl;

process.env.PORT ??= '8894';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';

type RealDb = ReturnType<typeof realDb>;

const { createCombatEntryRoutes } = await importWithRealDb(
  () => import('../../routes/v1/combat/entry.js'),
);
const { combatEntryGateDeps } = await importWithRealDb(
  () => import('../combat/combat-entry-gate-deps.js'),
);
const { detectDeclaredAttack } = await importWithRealDb(
  () => import('../combat/combat-intent-gate.js'),
);

interface EnterResponse {
  encounter: { id: string };
  participants: Array<{ id: string; name: string; characterId: string | null }>;
  first_action?: {
    type: string;
    target: string;
    weaponId: string | null;
    weaponName: string | null;
    source: string;
    combat_action: { weapon_id: string | null };
    roll_request?: {
      type: string;
      formula: string;
      modifier: number;
      purpose: string;
      ac: number | null;
    };
  };
  first_action_refusal?: { reason: string; notice: string };
}

describeWithDb('a declared shortsword attack opens combat with the shortsword (#569)', () => {
  const database = hasRealDb ? realDb() : (null as never as RealDb);
  const userId = testId(FIXTURE_OWNER_PREFIX);

  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let shortswordId: string;
  let nextSessionNumber = 2;

  beforeAll(async () => {
    await database.delete(campaigns).where(like(campaigns.userId, `${FIXTURE_OWNER_PREFIX}%`));

    [{ id: campaignId }] = await database
      .insert(campaigns)
      .values({ userId, name: testId('combat-entry-declared-weapon-569-campaign') })
      .returning({ id: campaigns.id });

    [{ id: characterId }] = await database
      .insert(characters)
      .values({ userId, campaignId, name: PLAYER_NAME, class: 'Rogue', level: 1 })
      .returning({ id: characters.id });

    // STR 16 (+3), DEX 14 (+2): a finesse weapon takes the higher, so STR decides.
    await database.insert(characterStats).values({
      characterId,
      strength: 16,
      dexterity: 14,
      armorClass: 14,
      maxHitPoints: 20,
      currentHitPoints: 20,
      speed: 30,
    });

    [{ id: shortswordId }] = await database
      .insert(inventoryItems)
      .values({
        characterId,
        name: 'Shortsword',
        itemType: 'weapon',
        quantity: 1,
        isEquipped: true,
      })
      .returning({ id: inventoryItems.id });

    [{ id: sessionId }] = await database
      .insert(gameSessions)
      .values({
        campaignId,
        characterId,
        sessionNumber: 1,
        status: 'active',
        summary: 'Declared shortsword attack (#569) test session.',
      })
      .returning({ id: gameSessions.id });

    // The scene NPC as a real producer stores it: a campaign `npcs` row.
    await database.insert(npcs).values({ campaignId, name: DRAGON_NAME });
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    try {
      if (sessionId) await database.delete(gameSessions).where(eq(gameSessions.id, sessionId));
      if (characterId) await database.delete(characters).where(eq(characters.id, characterId));
      if (campaignId) await database.delete(campaigns).where(eq(campaigns.id, campaignId));
    } finally {
      await closeRealDb();
    }
  });

  for (const [label, playerInput, antecedent] of DECLARATIONS)
    test(`POST /enter rolls the equipped Shortsword (${label})`, async () => {
      // The declaration exactly as the parser builds it from the player's words.
      const declaredAttack = detectDeclaredAttack(
        playerInput,
        [{ name: PLAYER_NAME }, { name: DRAGON_NAME }],
        { antecedent },
      );
      expect(declaredAttack).toMatchObject({
        verb: 'attack',
        attackSource: 'weapon',
        weaponName: 'shortsword',
      });

      const app = new Elysia().use(
        createCombatEntryRoutes({
          authenticateRequest: (async () => ({
            user: { userId, email: 'declared-weapon-569@example.test', plan: 'free' },
            error: null,
          })) as never,
          combatEntryGateDeps: {
            ...combatEntryGateDeps,
            // Map creation and websocket publication only; encounter creation stays real.
            createTacticalCombatMap: async () => undefined,
            publishCombatState: async () => undefined,
          },
        }),
      );

      // A fresh session per case: one session holds one active encounter.
      const [{ id: caseSessionId }] = await database
        .insert(gameSessions)
        .values({
          campaignId,
          characterId,
          sessionNumber: nextSessionNumber++,
          status: 'active',
          summary: 'Declared shortsword attack (#569) case session.',
        })
        .returning({ id: gameSessions.id });

      const response = await app.handle(
        new Request(`http://localhost/sessions/${caseSessionId}/enter`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            combatants: [{ name: DRAGON_NAME, count: 1 }],
            sceneSpec: {
              environment: 'cave',
              size: 'medium',
              sceneDescription: 'The Dragon Goldscale coils across the cavern floor.',
            },
            player: { characterId, name: PLAYER_NAME, initiativeModifier: 2 },
            declaredAttack,
            playerInitiativeRoll: 18,
          }),
        }),
      );

      expect(response.status).toBe(201);
      const body = (await response.json()) as EnterResponse;
      expect(body.first_action_refusal).toBeUndefined();

      const dragon = body.participants.find((participant) => participant.name === DRAGON_NAME);
      if (!dragon) throw new Error('Dragon Goldscale was not seated');

      // The opening action names the equipped Shortsword row, not Unarmed Strike.
      expect(body.first_action).toMatchObject({
        type: 'attack',
        target: dragon.id,
        source: 'weapon',
        weaponId: shortswordId,
        weaponName: 'Shortsword',
        combat_action: { weapon_id: shortswordId },
      });
      expect(body.first_action?.roll_request).toMatchObject({
        type: 'attack',
        formula: '1d20+5',
        modifier: 5,
        purpose: 'Shortsword attack against Dragon Goldscale',
      });

      const rows = await database
        .select({ id: combatParticipants.id, name: combatParticipants.name })
        .from(combatParticipants)
        .where(eq(combatParticipants.encounterId, body.encounter.id));
      expect(rows).toContainEqual({ id: dragon.id, name: DRAGON_NAME });
    });
});
