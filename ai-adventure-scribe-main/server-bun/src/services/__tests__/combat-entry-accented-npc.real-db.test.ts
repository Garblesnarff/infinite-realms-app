/**
 * #798 step 3: a declared strike on a romanized name must reach an accented scene NPC.
 *
 * The DM romanizes: the board and the prose say `house-flambe-student` / `House Flambe Student`
 * while the stored NPC keeps the accent (`House Flambé Student`). This drives the REAL HTTP
 * entry route with the REAL gate deps so the whole path is exercised against real rows:
 * the scene NPC is a campaign `npcs` row, `startCombat` seats it in `combat_participants`, and
 * `deriveCombatEntryFirstAction` has to fold the accent to find the seat it was declared at.
 *
 * Only map/publication are stubbed (as in `combat-entry-transcript.real-db.test.ts`); encounter
 * creation is real because the assertion is against the participant rows it writes.
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
  npcs,
} from '../../../../db/schema/index';

const DEDICATED_REAL_DB_HOST = '127.0.0.1';
const DEDICATED_REAL_DB_PORT = '55432';
const FIXTURE_OWNER_PREFIX = 'combat-entry-accented-npc-user-';

function assertSafeCombatEntryAccentedNpcDatabase(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      '[combat-entry-accented-npc] refusing real-DB fixtures: invalid URL; use the dedicated Postgres at 127.0.0.1:55432',
    );
  }

  const isPostgres = parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
  if (
    !isPostgres ||
    parsed.hostname !== DEDICATED_REAL_DB_HOST ||
    parsed.port !== DEDICATED_REAL_DB_PORT
  ) {
    const target = parsed.hostname ? `${parsed.hostname}:${parsed.port || '(default)'}` : 'unknown';
    throw new Error(
      `[combat-entry-accented-npc] refusing real-DB fixtures against ${target}; use the dedicated Postgres at 127.0.0.1:55432`,
    );
  }
}

if (hasRealDb) assertSafeCombatEntryAccentedNpcDatabase(realDbUrl);

// The suites import the server's eager db client, which requires DATABASE_URL. Pointing it at
// the already-guarded TEST_DATABASE_URL keeps this harness self-contained under the documented
// single-variable run command, and never at a target the guard above rejected.
if (hasRealDb) process.env.DATABASE_URL = realDbUrl;

type RealDb = ReturnType<typeof realDb>;

process.env.PORT ??= '8893';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';

if (!hasRealDb) {
  console.warn(
    '[combat-entry-accented-npc] SKIPPED: set TEST_DATABASE_URL to the dedicated Postgres at 127.0.0.1:55432 to run this suite.',
  );
}

const { createCombatEntryRoutes } = await importWithRealDb(
  () => import('../../routes/v1/combat/entry.js'),
);
const { combatEntryGateDeps } = await importWithRealDb(
  () => import('../combat/combat-entry-gate-deps.js'),
);

const ACCENTED_NPC_NAME = 'House Flambé Student';
const PLAYER_NAME = 'Accent Test Player';

interface EnterResponse {
  encounter: { id: string };
  participants: Array<{
    id: string;
    name: string;
    characterId: string | null;
    participantType: string;
  }>;
  first_action?: {
    type: string;
    target: string;
    targetLabel: string;
    roll_request?: { formula: string; purpose: string };
  };
  first_action_refusal?: { reason: string };
}

describeWithDb('a declared strike folds accents onto an accented scene NPC (#798)', () => {
  const database = hasRealDb ? realDb() : (null as never as RealDb);
  const userId = testId(FIXTURE_OWNER_PREFIX);

  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let npcId: string;
  let storedNpcName: string;

  beforeAll(async () => {
    await database.delete(characters).where(like(characters.userId, `${FIXTURE_OWNER_PREFIX}%`));
    await database.delete(campaigns).where(like(campaigns.userId, `${FIXTURE_OWNER_PREFIX}%`));

    [{ id: campaignId }] = await database
      .insert(campaigns)
      .values({ userId, name: testId('combat-entry-accented-npc-campaign') })
      .returning({ id: campaigns.id });

    [{ id: characterId }] = await database
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: PLAYER_NAME,
        class: 'Fighter',
        level: 1,
      })
      .returning({ id: characters.id });

    await database.insert(characterStats).values({
      characterId,
      strength: 14,
      dexterity: 16,
      armorClass: 14,
      maxHitPoints: 20,
      currentHitPoints: 20,
      speed: 30,
    });

    [{ id: sessionId }] = await database
      .insert(gameSessions)
      .values({
        campaignId,
        characterId,
        sessionNumber: 1,
        status: 'active',
        summary: 'Accented scene NPC combat entry test session.',
      })
      .returning({ id: gameSessions.id });

    // The scene NPC as a real producer stores it: a campaign `npcs` row with the accented name.
    [{ id: npcId, name: storedNpcName }] = await database
      .insert(npcs)
      .values({ campaignId, name: ACCENTED_NPC_NAME })
      .returning({ id: npcs.id, name: npcs.name });
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

  test('POST /enter seats the accented NPC and rolls the opening attack against it', async () => {
    expect(storedNpcName).toBe(ACCENTED_NPC_NAME);

    const app = new Elysia().use(
      createCombatEntryRoutes({
        authenticateRequest: (async () => ({
          user: { userId, email: 'accent-npc@example.test', plan: 'free' },
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

    const response = await app.handle(
      new Request(`http://localhost/sessions/${sessionId}/enter`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // The scene NPC the DM placed, under the accented name the table stored.
          combatants: [{ name: storedNpcName, count: 1 }],
          sceneSpec: {
            environment: 'tavern',
            size: 'small',
            sceneDescription: 'House Flambé Student bars the alehouse door.',
          },
          player: {
            characterId,
            name: PLAYER_NAME,
            initiativeModifier: 3,
          },
          // The player declared against the DM's romanized spelling.
          declaredAttack: {
            verb: 'strike',
            actorName: 'House Flambe Student',
            actorSlug: 'house-flambe-student',
            attackSource: 'unarmed',
          },
          playerInitiativeRoll: 20,
        }),
      }),
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as EnterResponse;

    const npcParticipant = body.participants.find(
      (participant) => participant.name === ACCENTED_NPC_NAME,
    );
    expect(npcParticipant).toMatchObject({
      name: ACCENTED_NPC_NAME,
      characterId: null,
      participantType: 'monster',
    });
    if (!npcParticipant) throw new Error('accented scene NPC was not seated');
    const npcParticipantId = npcParticipant.id;

    const rows = await database
      .select({
        id: combatParticipants.id,
        name: combatParticipants.name,
        characterId: combatParticipants.characterId,
        participantType: combatParticipants.participantType,
      })
      .from(combatParticipants)
      .where(eq(combatParticipants.encounterId, body.encounter.id));

    expect(rows).toContainEqual({
      id: npcParticipantId,
      name: ACCENTED_NPC_NAME,
      characterId: null,
      participantType: 'monster',
    });
    // The seated NPC points back at the scene row that produced it.
    const npcRow = await database
      .select({ campaignId: npcs.campaignId })
      .from(npcs)
      .where(eq(npcs.id, npcId));
    expect(npcRow).toEqual([{ campaignId }]);

    expect(body.first_action_refusal).toBeUndefined();
    expect(body.first_action).toMatchObject({
      type: 'attack',
      target: npcParticipantId,
      targetLabel: ACCENTED_NPC_NAME,
    });
    expect(body.first_action?.roll_request?.formula).toMatch(/^1d20[+-]\d+$/);
  });
});
