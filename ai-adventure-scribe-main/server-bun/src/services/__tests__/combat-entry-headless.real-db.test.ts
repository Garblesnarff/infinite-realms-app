/**
 * #913, strategist round 2: the headless client's `/enter` body must seat a real
 * encounter, not only satisfy mocks.
 *
 * This posts the shared fixture body (`headlessEntryEnterBody` from
 * `shared/test-fixtures/combat-entry-headless.ts` — the exact bytes the client test
 * asserts the headless client sends) through the real HTTP entry route with the real
 * gate deps, against real rows. Only map creation and websocket publication are
 * stubbed (as in `combat-entry-accented-npc.real-db.test.ts`); encounter creation is
 * real because the assertions are against the rows it writes: a `combat_encounters`
 * row for the session, its participants, and the live-encounter read the next turn's
 * generate pipeline performs (`combatEntryGateDeps.getActiveEncounter`, the check
 * behind `COMBAT_ENTRY_SKIPPED_LIVE_ENCOUNTER`).
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
  combatEncounters,
  combatParticipants,
  gameSessions,
} from '../../../../db/schema/index';
import {
  HEADLESS_ENTRY_CHARACTER_ID,
  HEADLESS_ENTRY_SESSION_ID,
  headlessEntryEnterBody,
} from '../../../../shared/test-fixtures/combat-entry-headless';

const DEDICATED_REAL_DB_HOST = '127.0.0.1';
const DEDICATED_REAL_DB_PORT = '55432';
const FIXTURE_OWNER_PREFIX = 'combat-entry-headless-user-';

function assertSafeCombatEntryHeadlessDatabase(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      '[combat-entry-headless] refusing real-DB fixtures: invalid URL; use the dedicated Postgres at 127.0.0.1:55432',
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
      `[combat-entry-headless] refusing real-DB fixtures against ${target}; use the dedicated Postgres at 127.0.0.1:55432`,
    );
  }
}

if (hasRealDb) assertSafeCombatEntryHeadlessDatabase(realDbUrl);

// The suites import the server's eager db client, which requires DATABASE_URL. Pointing it at
// the already-guarded TEST_DATABASE_URL keeps this harness self-contained under the documented
// single-variable run command, and never at a target the guard above rejected.
if (hasRealDb) process.env.DATABASE_URL = realDbUrl;

type RealDb = ReturnType<typeof realDb>;

process.env.PORT ??= '8894';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';

if (!hasRealDb) {
  console.warn(
    '[combat-entry-headless] SKIPPED: set TEST_DATABASE_URL to the dedicated Postgres at 127.0.0.1:55432 to run this suite.',
  );
}

const { createCombatEntryRoutes } = await importWithRealDb(
  () => import('../../routes/v1/combat/entry.js'),
);
const { combatEntryGateDeps } = await importWithRealDb(
  () => import('../combat/combat-entry-gate-deps.js'),
);

describeWithDb('the headless entry body seats a real encounter (#913)', () => {
  const database = hasRealDb ? realDb() : (null as never as RealDb);
  const userId = testId(FIXTURE_OWNER_PREFIX);

  let campaignId: string;

  beforeAll(async () => {
    await database.delete(gameSessions).where(eq(gameSessions.id, HEADLESS_ENTRY_SESSION_ID));
    await database.delete(characters).where(eq(characters.id, HEADLESS_ENTRY_CHARACTER_ID));
    await database.delete(characters).where(like(characters.userId, `${FIXTURE_OWNER_PREFIX}%`));
    await database.delete(campaigns).where(like(campaigns.userId, `${FIXTURE_OWNER_PREFIX}%`));

    [{ id: campaignId }] = await database
      .insert(campaigns)
      .values({ userId, name: testId('combat-entry-headless-campaign') })
      .returning({ id: campaigns.id });

    // The fixture's ids are the rows: the body names this character, the URL this session.
    await database.insert(characters).values({
      id: HEADLESS_ENTRY_CHARACTER_ID,
      userId,
      campaignId,
      name: 'Rook',
      class: 'Fighter',
      level: 1,
    });

    await database.insert(characterStats).values({
      characterId: HEADLESS_ENTRY_CHARACTER_ID,
      strength: 14,
      dexterity: 14,
      armorClass: 12,
      maxHitPoints: 12,
      currentHitPoints: 12,
      speed: 30,
    });

    await database.insert(gameSessions).values({
      id: HEADLESS_ENTRY_SESSION_ID,
      campaignId,
      characterId: HEADLESS_ENTRY_CHARACTER_ID,
      sessionNumber: 1,
      status: 'active',
      summary: 'Headless combat entry test session.',
    });
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    try {
      await database.delete(gameSessions).where(eq(gameSessions.id, HEADLESS_ENTRY_SESSION_ID));
      await database
        .delete(characters)
        .where(eq(characters.id, HEADLESS_ENTRY_CHARACTER_ID));
      if (campaignId) await database.delete(campaigns).where(eq(campaigns.id, campaignId));
    } finally {
      await closeRealDb();
    }
  });

  test('POST /enter writes the combat_encounters row the next turn reads', async () => {
    const app = new Elysia().use(
      createCombatEntryRoutes({
        authenticateRequest: (async () => ({
          user: { userId, email: 'headless-entry@example.test', plan: 'free' },
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
      new Request(`http://localhost/sessions/${HEADLESS_ENTRY_SESSION_ID}/enter`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(headlessEntryEnterBody),
      }),
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { encounter: { id: string } };

    const encounterRows = await database
      .select({
        id: combatEncounters.id,
        sessionId: combatEncounters.sessionId,
        status: combatEncounters.status,
      })
      .from(combatEncounters)
      .where(eq(combatEncounters.sessionId, HEADLESS_ENTRY_SESSION_ID));
    expect(encounterRows).toEqual([
      { id: body.encounter.id, sessionId: HEADLESS_ENTRY_SESSION_ID, status: 'active' },
    ]);

    const participants = await database
      .select({
        name: combatParticipants.name,
        characterId: combatParticipants.characterId,
      })
      .from(combatParticipants)
      .where(eq(combatParticipants.encounterId, body.encounter.id));
    expect(participants).toContainEqual({ name: 'Rook', characterId: HEADLESS_ENTRY_CHARACTER_ID });
    expect(participants).toContainEqual({ name: 'Head Chef Balthazar', characterId: null });

    // The next turn's read: the generate pipeline's live-encounter check consults
    // this exact dep, and it must find the encounter the seat just wrote.
    const active = await combatEntryGateDeps.getActiveEncounter(HEADLESS_ENTRY_SESSION_ID, userId);
    expect(active?.id).toBe(body.encounter.id);
  });
});
