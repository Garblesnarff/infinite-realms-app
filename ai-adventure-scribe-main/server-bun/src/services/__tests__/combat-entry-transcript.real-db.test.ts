/**
 * #1907 PR1: seating must leave an auditable system message in session history.
 *
 * This intentionally drives the HTTP entry route with real ownership and message persistence,
 * while stubbing only encounter/map publication. The assertion is against the row in
 * dialogue_history, not merely against an injected callback.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { and, eq, like } from 'drizzle-orm';
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
import { campaigns, characters, dialogueHistory, gameSessions } from '../../../../db/schema/index';

const DEDICATED_REAL_DB_HOST = '127.0.0.1';
const DEDICATED_REAL_DB_PORT = '55432';
const FIXTURE_OWNER_PREFIX = 'combat-entry-transcript-user-';

function assertSafeCombatEntryTranscriptDatabase(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      '[combat-entry-transcript] refusing real-DB fixtures: invalid URL; use the dedicated Postgres at 127.0.0.1:55432',
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
      `[combat-entry-transcript] refusing real-DB fixtures against ${target}; use the dedicated Postgres at 127.0.0.1:55432`,
    );
  }
}

if (hasRealDb) assertSafeCombatEntryTranscriptDatabase(realDbUrl);

type RealDb = ReturnType<typeof realDb>;

// The route imports the server's eager environment guard. Keep this integration harness
// self-contained; the database job supplies the real database URL separately.
process.env.PORT ??= '8892';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';

if (!hasRealDb) {
  console.warn(
    '[combat-entry-transcript] SKIPPED: set TEST_DATABASE_URL to the dedicated Postgres at 127.0.0.1:55432 to run this suite.',
  );
}

const { createCombatEntryRoutes } = await importWithRealDb(
  () => import('../../routes/v1/combat/entry.js'),
);
const { combatEntryGateDeps } = await importWithRealDb(
  () => import('../combat/combat-entry-gate-deps.js'),
);

describeWithDb('combat entry seating transcript persistence', () => {
  const database = hasRealDb ? realDb() : (null as never as RealDb);
  const userId = testId(FIXTURE_OWNER_PREFIX);

  let campaignId: string;
  let characterId: string;
  let sessionId: string;

  beforeAll(async () => {
    await database.delete(characters).where(like(characters.userId, `${FIXTURE_OWNER_PREFIX}%`));
    await database.delete(campaigns).where(like(campaigns.userId, `${FIXTURE_OWNER_PREFIX}%`));

    [{ id: campaignId }] = await database
      .insert(campaigns)
      .values({ userId, name: testId('combat-entry-transcript-campaign') })
      .returning({ id: campaigns.id });

    [{ id: characterId }] = await database
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: 'Combat Entry Player',
        class: 'Fighter',
        level: 1,
      })
      .returning({ id: characters.id });

    [{ id: sessionId }] = await database
      .insert(gameSessions)
      .values({
        campaignId,
        characterId,
        sessionNumber: 1,
        status: 'active',
        summary: 'Combat entry transcript test session.',
      })
      .returning({ id: gameSessions.id });
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

  test('POST /enter persists the seating transcript as a system dialogue row', async () => {
    const combatState = {
      encounter: { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
      participants: [
        {
          id: 'participant-player',
          name: 'Combat Entry Player',
          initiative: 18,
          initiativeModifier: 2,
          characterId,
          turnOrder: 0,
        },
        {
          id: 'participant-geometrist',
          name: 'Geometrist',
          initiative: 15,
          initiativeModifier: 1,
          characterId: null,
          turnOrder: 1,
        },
      ],
      participantSizes: {},
      turnOrder: [],
      currentParticipant: null,
    };

    const app = new Elysia().use(
      createCombatEntryRoutes({
        authenticateRequest: (async () => ({
          user: { userId, email: 'combat-entry@example.test', plan: 'free' },
          error: null,
        })) as never,
        combatEntryGateDeps: {
          ...combatEntryGateDeps,
          startCombat: async () => combatState,
          createTacticalCombatMap: async () => undefined,
          trackCombatEvent: () => undefined,
          publishCombatState: async () => undefined,
        },
        sanitizeSceneSpec: ((_raw: unknown, requestedSessionId: string) => ({
          ok: true as const,
          sceneSpec: {
            sessionId: requestedSessionId,
            environment: 'cave' as const,
            size: 'medium' as const,
          },
          overrides: [],
        })) as never,
        buildInitiativeOrder: (() => []) as never,
      }),
    );

    const response = await app.handle(
      new Request(`http://localhost/sessions/${sessionId}/enter`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          combatants: [{ name: 'Geometrist', count: 1 }],
          sceneSpec: { environment: 'cave' },
          player: { characterId, name: 'Combat Entry Player', initiativeModifier: 2 },
          playerInitiativeRoll: 16,
        }),
      }),
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { seatingTranscript: string };
    const [row] = await database
      .select({
        sessionId: dialogueHistory.sessionId,
        speakerType: dialogueHistory.speakerType,
        message: dialogueHistory.message,
      })
      .from(dialogueHistory)
      .where(
        and(
          eq(dialogueHistory.sessionId, sessionId),
          eq(dialogueHistory.speakerType, 'system'),
          eq(dialogueHistory.message, body.seatingTranscript),
        ),
      );

    expect(row).toEqual({
      sessionId,
      speakerType: 'system',
      message: body.seatingTranscript,
    });
  });
});
