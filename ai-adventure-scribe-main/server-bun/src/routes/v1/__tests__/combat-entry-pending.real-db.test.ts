/**
 * #913 — a pending combat entry must seat on confirm, must not be proposed
 * again for the same actors, and must be visible on the GET the open tab polls.
 *
 * The DM turn goes through the real `POST /v1/llm/generate` route (provider
 * stubbed). Confirm goes through the real `POST /v1/combat/sessions/:id/enter`.
 * The poll is the real `GET /v1/combat/sessions/:id/active`. Encounter rows are
 * the real `combat_encounters` insert `seatCombatEntry` performs. Map creation
 * and combat-state publication are stubbed, as in
 * `combat-entry-headless.real-db.test.ts`.
 *
 * Producers: the DM envelope is the `dmEnvelope` shape from
 * `llm-generate-combat-entry.test.ts` with `combat_transition: "start"` and the
 * combatant `applyCombatEntryGate` names. The confirm player is the
 * `headlessEntryEnterBody.player` shape (`buildCombatEntryPlayer`).
 */
import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { asc, eq, like, sql } from 'drizzle-orm';

import {
  campaigns,
  characterStats,
  characters,
  combatEncounters,
  dialogueHistory,
  gameSessions,
} from '../../../../../db/schema/index';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  realDbUrl,
  testId,
} from '../../../services/__tests__/fixtures/real-db.js';

const DEDICATED_REAL_DB_HOST = '127.0.0.1';
const DEDICATED_REAL_DB_PORT = '55432';
const FIXTURE_OWNER_PREFIX = 'combat-entry-pending-user-';

function assertSafeDatabase(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      '[combat-entry-pending] refusing real-DB fixtures: invalid URL; use the dedicated Postgres at 127.0.0.1:55432',
    );
  }
  const isPostgres = parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
  if (
    !isPostgres ||
    parsed.hostname !== DEDICATED_REAL_DB_HOST ||
    parsed.port !== DEDICATED_REAL_DB_PORT
  ) {
    throw new Error(
      '[combat-entry-pending] refusing real-DB fixtures; use the dedicated Postgres at 127.0.0.1:55432',
    );
  }
}

if (hasRealDb) assertSafeDatabase(realDbUrl);
if (hasRealDb) process.env.DATABASE_URL = realDbUrl;

process.env.PORT ??= '8894';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';
process.env.RATE_LIMIT_LLM_IP_FREE = '10000';
process.env.RATE_LIMIT_LLM_IP_PRO = '10000';
process.env.RATE_LIMIT_LLM_IP_ENTERPRISE = '10000';
process.env.RATE_LIMIT_LLM_USER_FREE = '10000';
process.env.RATE_LIMIT_LLM_USER_PRO = '10000';
process.env.RATE_LIMIT_LLM_USER_ENTERPRISE = '10000';

if (!hasRealDb) {
  console.warn(
    '[combat-entry-pending] SKIPPED: set TEST_DATABASE_URL to the dedicated Postgres at 127.0.0.1:55432 to run this suite.',
  );
}

const userId = testId(FIXTURE_OWNER_PREFIX);
let generatedResult: { text: string; provider: string; model: string } = {
  text: '{}',
  provider: 'openrouter',
  model: 'test/model',
};

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId, email: 'pending-entry@example.test', plan: 'free' },
    error: null,
  }),
}));
mock.module('../../../services/ai-usage-service.js', () => ({
  AIUsageService: {
    checkQuotaAndConsume: async () => ({
      allowed: true,
      remaining: 99,
      resetAt: new Date(Date.now() + 60_000),
    }),
    recordProviderUsage: async () => {},
    deleteUsageRows: async () => ({ deleted: 0 }),
  },
}));
mock.module('../../../services/llm-provider-service.js', () => ({
  LLMProviderService: {
    generate: async () => generatedResult,
  },
}));

const { createRequestPipelineApp } = await importWithRealDb(
  () => import('../../../http-pipeline.js'),
);
const { llmRoutes } = await importWithRealDb(() => import('../llm.js'));
const { createCombatEntryRoutes } = await importWithRealDb(() => import('../combat/entry.js'));
const { intentRoutes } = await importWithRealDb(() => import('../combat/intents.js'));
const { combatEntryGateDeps } = await importWithRealDb(
  () => import('../../../services/combat/combat-entry-gate-deps.js'),
);
const { persistFallbackDmReply } = await importWithRealDb(
  () => import('../../../services/dm/dm-reply-persistence.js'),
);
const { Elysia } = await import('elysia');
const {
  liftCombatEntryDecline,
  readDeclinedCombatEntryActorKeys,
  recordCombatEntryDecline,
  resetPendingCombatEntries,
} = await importWithRealDb(() => import('../../../services/combat/pending-combat-entry.js'));

const dmText = (): string =>
  JSON.stringify({
    text: 'Balthazar raises his cleaver as you lunge.',
    narration_segments: [],
    roll_requests: [
      {
        type: 'initiative',
        formula: '1d20+2',
        purpose: 'Initiative',
        dc: null,
        ac: null,
        advantage: false,
        disadvantage: false,
      },
    ],
    combat_transition: 'start',
    scene_spec: {
      environment: 'tavern',
      size: 'medium',
      sceneDescription: 'A steamy kitchen; Balthazar blocks the pass with a cleaver in hand.',
      enemyPlacement: 'guarding',
    },
    map_actions: [],
    handout_actions: [],
    combatants: [{ name: 'Head Chef Balthazar', count: 1 }],
    combat_actions: [],
  });

describeWithDb('pending combat entry seats, dedupes, and is polled (#913)', () => {
  const database = hasRealDb ? realDb() : (null as never);
  const sessionId = '11111111-2222-4333-8444-555555555913';
  const heldSessionId = crypto.randomUUID();
  const characterId = '99999999-8888-4777-8666-555555555913';
  let campaignId = '';

  const player = {
    characterId,
    name: 'Rook',
    initiativeModifier: 2,
    hpCurrent: 12,
    hpMax: 12,
  };

  const app = hasRealDb
    ? createRequestPipelineApp()
        .use(llmRoutes)
        .use(
          new Elysia({ prefix: '/v1/combat' })
            .use(
              createCombatEntryRoutes({
                combatEntryGateDeps: {
                  ...combatEntryGateDeps,
                  createTacticalCombatMap: async () => undefined,
                  publishCombatState: async () => undefined,
                },
              }),
            )
            .use(intentRoutes),
        )
    : null;

  const generate = async (): Promise<Record<string, unknown>> => {
    generatedResult = { text: dmText(), provider: 'openrouter', model: 'test/model' };
    const response = await app!.handle(
      new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Continue the scene.',
          player_input: 'Continue the scene.',
          sessionId,
          combatEntry: { sessionId, player },
        }),
      }),
    );
    const body = (await response.json()) as { text?: string; error?: string };
    if (response.status !== 200 || typeof body.text !== 'string') {
      throw new Error(`generate failed ${response.status} ${JSON.stringify(body)}`);
    }
    return JSON.parse(body.text) as Record<string, unknown>;
  };

  const active = async (): Promise<Record<string, unknown>> => {
    const response = await app!.handle(
      new Request(`http://localhost/v1/combat/sessions/${sessionId}/active`, {
        headers: { authorization: 'Bearer test' },
      }),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as Record<string, unknown>;
  };

  // #1390: the same generate, but with the client's reserved dmReply id, so
  // the persistence block runs and the reply is held as `roll_requests`.
  const generateWithDmReply = async (
    messageId: string,
    targetSessionId = sessionId,
  ): Promise<Record<string, unknown>> => {
    generatedResult = { text: dmText(), provider: 'openrouter', model: 'test/model' };
    const response = await app!.handle(
      new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Continue the scene.',
          player_input: 'Continue the scene.',
          sessionId: targetSessionId,
          combatEntry: { sessionId: targetSessionId, player },
          dmReply: { messageId, inCombat: false },
        }),
      }),
    );
    const body = (await response.json()) as {
      text?: string;
      error?: string;
      dmReplyPersisted?: boolean;
    };
    if (response.status !== 200 || typeof body.text !== 'string') {
      throw new Error(`generate failed ${response.status} ${JSON.stringify(body)}`);
    }
    return {
      ...(JSON.parse(body.text) as Record<string, unknown>),
      dmReplyPersisted: body.dmReplyPersisted,
    };
  };

  const enter = async (
    targetSessionId = sessionId,
  ): Promise<{ status: number; payload: Record<string, unknown> }> => {
    const response = await app!.handle(
      new Request(`http://localhost/v1/combat/sessions/${targetSessionId}/enter`, {
        method: 'POST',
        headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
        body: JSON.stringify({
          fromPending: true,
          player,
          playerInitiativeRoll: 14,
        }),
      }),
    );
    const payload = (await response.json()) as Record<string, unknown>;
    return { status: response.status, payload };
  };

  const historyRows = async (
    targetSessionId = sessionId,
  ): Promise<
    Array<{
      id: string;
      speakerType: string | null;
      message: string | null;
      context: unknown;
      createdAtText: string;
    }>
  > => {
    const rows = await database
      .select({
        id: dialogueHistory.id,
        speakerType: dialogueHistory.speakerType,
        message: dialogueHistory.message,
        context: dialogueHistory.context,
        // Microsecond text, not the millisecond Date: two sequential writes
        // in one seating must order deterministically.
        createdAtText: sql<string>`${dialogueHistory.createdAt}::text`,
      })
      .from(dialogueHistory)
      .where(eq(dialogueHistory.sessionId, targetSessionId))
      .orderBy(asc(dialogueHistory.createdAt));
    return rows as Array<{
      id: string;
      speakerType: string | null;
      message: string | null;
      context: unknown;
      createdAtText: string;
    }>;
  };

  beforeEach(async () => {
    await resetPendingCombatEntries();
    await database.delete(combatEncounters).where(eq(combatEncounters.sessionId, sessionId));
  });

  beforeAll(async () => {
    await database.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await database.delete(characters).where(eq(characters.id, characterId));
    await database.delete(characters).where(like(characters.userId, `${FIXTURE_OWNER_PREFIX}%`));
    await database.delete(campaigns).where(like(campaigns.userId, `${FIXTURE_OWNER_PREFIX}%`));
    [{ id: campaignId }] = await database
      .insert(campaigns)
      .values({ userId, name: testId('combat-entry-pending-campaign') })
      .returning({ id: campaigns.id });
    await database.insert(characters).values({
      id: characterId,
      userId,
      campaignId,
      name: 'Rook',
      class: 'Fighter',
      level: 1,
    });
    await database.insert(characterStats).values({
      characterId,
      strength: 14,
      dexterity: 14,
      armorClass: 12,
      maxHitPoints: 12,
      currentHitPoints: 12,
      speed: 30,
    });
    await database.insert(gameSessions).values({
      id: sessionId,
      campaignId,
      characterId,
      sessionNumber: 1,
      status: 'active',
      summary: 'Pending combat entry test session.',
    });
    await database.insert(gameSessions).values({
      id: heldSessionId,
      campaignId,
      characterId,
      sessionNumber: 2,
      status: 'active',
      summary: 'Isolated held combat entry test session.',
    });
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    try {
      await database.delete(gameSessions).where(eq(gameSessions.id, heldSessionId));
      await database.delete(gameSessions).where(eq(gameSessions.id, sessionId));
      await database.delete(characters).where(eq(characters.id, characterId));
      if (campaignId) await database.delete(campaigns).where(eq(campaigns.id, campaignId));
    } finally {
      await closeRealDb();
    }
  });

  test('the pending entry is in the GET the tab polls', async () => {
    await generate();
    const body = await active();
    expect(body.combatEntryPending).toMatchObject({
      combatants: [{ name: 'Head Chef Balthazar', count: 1 }],
    });
  });

  test('a second entry envelope for the same actors is dropped while one is pending', async () => {
    const first = await generate();
    expect(first.combat_entry_pending).toMatchObject({
      combatants: [{ name: 'Head Chef Balthazar', count: 1 }],
    });
    const second = await generate();
    expect(second.combat_entry_pending).toBeUndefined();
    expect(second.combat_transition).toBe('none');
  });

  test('confirm seats one combat_encounters row', async () => {
    await generate();
    const response = await app!.handle(
      new Request(`http://localhost/v1/combat/sessions/${sessionId}/enter`, {
        method: 'POST',
        headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
        body: JSON.stringify({
          fromPending: true,
          player,
          playerInitiativeRoll: 14,
        }),
      }),
    );
    const payload = (await response.json()) as { error?: string; encounter?: { id: string } };
    expect(response.status).toBe(201);
    const rows = await database
      .select({ id: combatEncounters.id, sessionId: combatEncounters.sessionId })
      .from(combatEncounters)
      .where(eq(combatEncounters.sessionId, sessionId));
    expect(rows).toHaveLength(1);
    const encounterId = payload.encounter?.id;
    if (typeof encounterId !== 'string') throw new Error('encounter id missing');
    expect(rows[0]?.id).toBe(encounterId);
  });

  test('a held fight-opening reply is written once, before the combat rows, on confirm (#1390)', async () => {
    // This session is never used by the preceding seat test, so a late write from it cannot
    // appear in this test's history after cleanup.
    const heldMessageId = '11111111-2222-4333-8444-555555555139';
    const generated = await generateWithDmReply(heldMessageId, heldSessionId);
    expect(generated.dmReplyPersisted).toBe(false);
    expect(generated.combat_entry_pending).toMatchObject({
      combatants: [{ name: 'Head Chef Balthazar', count: 1 }],
    });
    // The held precondition: the server wrote no DM row for the reserved id.
    expect(
      (await historyRows(heldSessionId)).filter((row) => row.id === heldMessageId),
    ).toHaveLength(0);

    // Model the preceding session's late seating write after this test has begun.
    await database
      .insert(dialogueHistory)
      .values({ sessionId, speakerType: 'system', message: '⚙️ Engine: prior session seating' });

    const { status } = await enter(heldSessionId);
    expect(status).toBe(201);

    const rows = await historyRows(heldSessionId);
    const heldRows = rows.filter((row) => row.id === heldMessageId);
    expect(heldRows).toHaveLength(1);
    expect(heldRows[0]?.speakerType).toBe('dm');
    expect(heldRows[0]?.message).toContain('Balthazar raises his cleaver');
    const seatingRows = rows.filter(
      (row) =>
        row.speakerType === 'system' &&
        typeof row.message === 'string' &&
        row.message.startsWith('⚙️ Engine:'),
    );
    expect(seatingRows).toHaveLength(1);
    // In order, before the first combat row: the held narration's server
    // clock precedes the seating transcript's.
    expect(heldRows[0]?.createdAtText < seatingRows[0]?.createdAtText).toBe(true);
  });

  test('the watchdog fallback writes a held fight-opening narration once the fight is live (#1390)', async () => {
    await database.delete(dialogueHistory).where(eq(dialogueHistory.sessionId, sessionId));
    const heldEnvelope = {
      text: 'Balthazar raises his cleaver as you lunge.',
      roll_requests: [{ type: 'initiative', formula: '1d20+2', purpose: 'Initiative' }],
      combat_transition: 'none',
      combat_entry_pending: { combatants: [{ name: 'Head Chef Balthazar', count: 1 }] },
    };
    const fallbackMessageId = '22222222-3333-4444-8555-666666666139';
    // The turn's generation time: the seated encounter must postdate it
    // for the bypass to fire, and must predate a later generation time
    // for the bypass to refuse.
    const generatedAt = new Date();
    // No encounter yet (beforeEach wipes them): the fallback still skips,
    // so a declined or never-entered fight never resurrects its prose.
    const skipped = await persistFallbackDmReply({
      userId,
      sessionId,
      messageId: fallbackMessageId,
      reason: 'roll_requests',
      envelope: heldEnvelope,
      generatedAt,
    });
    expect(skipped).toEqual({ persisted: false, skipped: 'combat_entry_pending' });

    // Seat the fight, then the same fallback writes the narration.
    await generateWithDmReply('33333333-4444-4555-8666-777777777139');
    const { status } = await enter();
    expect(status).toBe(201);
    const written = await persistFallbackDmReply({
      userId,
      sessionId,
      messageId: fallbackMessageId,
      reason: 'roll_requests',
      envelope: heldEnvelope,
      generatedAt,
    });
    expect(written).toEqual({ persisted: true });
    const rows = (await historyRows()).filter((row) => row.id === fallbackMessageId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.speakerType).toBe('dm');
    expect(rows[0]?.message).toContain('Balthazar raises his cleaver');
    const context =
      typeof rows[0]?.context === 'string'
        ? (JSON.parse(rows[0].context) as Record<string, unknown>)
        : (rows[0]?.context as Record<string, unknown>);
    expect(context['combat_transition']).toBe('none');
    expect('rollRequests' in context).toBe(false);

    // An older live fight does not bless a newer turn: the encounter
    // predates this generation time, so the bypass refuses.
    const staleMessageId = '44444444-5555-4666-8777-888888888139';
    const stale = await persistFallbackDmReply({
      userId,
      sessionId,
      messageId: staleMessageId,
      reason: 'roll_requests',
      envelope: heldEnvelope,
      generatedAt: new Date(),
    });
    expect(stale).toEqual({ persisted: false, skipped: 'combat_entry_pending' });
    expect((await historyRows()).filter((row) => row.id === staleMessageId)).toHaveLength(0);
  });

  test('a recorded decline persists in the session_state row and lifts (#1328)', async () => {
    // The row path, not the process-memory mirror: with a reachable
    // database the read selects game_sessions.session_state, so this
    // survives across SO_REUSEPORT processes. The direct row select
    // below proves the write landed in the row itself.
    await recordCombatEntryDecline(sessionId, 'gilded husk');
    const [row] = await database
      .select({ state: gameSessions.sessionState })
      .from(gameSessions)
      .where(eq(gameSessions.id, sessionId))
      .limit(1);
    const declined = (row?.state as Record<string, unknown> | null)?.['combatEntryDeclined'];
    expect(declined).toMatchObject({ actorKeys: ['gilded husk'] });
    expect(await readDeclinedCombatEntryActorKeys(sessionId)).toEqual(['gilded husk']);

    await liftCombatEntryDecline(sessionId, 'gilded husk');
    expect(await readDeclinedCombatEntryActorKeys(sessionId)).toEqual([]);
    const [cleared] = await database
      .select({ state: gameSessions.sessionState })
      .from(gameSessions)
      .where(eq(gameSessions.id, sessionId))
      .limit(1);
    const clearedDeclined = (cleared?.state as Record<string, unknown> | null)?.[
      'combatEntryDeclined'
    ];
    expect(clearedDeclined).toMatchObject({ actorKeys: [] });
  });

  test('a decline in one session never leaks into another (#1328)', async () => {
    const otherSessionId = '22222222-3333-4444-8555-666666666913';
    try {
      await database.insert(gameSessions).values({
        id: otherSessionId,
        campaignId,
        characterId,
        sessionNumber: 2,
        status: 'active',
        summary: 'Pending combat entry decline-isolation session.',
      });
      await recordCombatEntryDecline(sessionId, 'gilded husk');
      expect(await readDeclinedCombatEntryActorKeys(sessionId)).toEqual(['gilded husk']);
      expect(await readDeclinedCombatEntryActorKeys(otherSessionId)).toEqual([]);
    } finally {
      await database.delete(gameSessions).where(eq(gameSessions.id, otherSessionId));
    }
  });
});
