/* eslint-disable max-lines -- revised full-session integration test needs setup, real combat/rest drives, and a 30-turn loop in one file */
// HAND-MADE fixtures (see test-fixtures/sessions/hand-made-30-turn/README.md): DM replies
// are written by hand in the OpenRouter body shape, NOT recorded from a live model. Replace
// with LLM_RECORD_DIR recordings when a DM key is available.

import { readFileSync } from 'fs';

import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  realDbUrl,
  testId,
} from './fixtures/real-db.js';
import { setRngSeed } from '../../lib/rng.js';

if (hasRealDb) {
  const target = new URL(realDbUrl);
  if (target.hostname !== '127.0.0.1' || target.port !== '55432') {
    throw new Error(
      `[full-session] refusing real-DB fixtures against ${target.hostname}:${target.port}; use the dedicated Postgres at 127.0.0.1:55432`,
    );
  }
}

process.env.PORT ??= '8893';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';
process.env.OPENROUTER_API_KEY ??= 'test-openrouter-key';
process.env.RATE_LIMIT_LLM_IP_FREE = '10000';
process.env.RATE_LIMIT_LLM_IP_PRO = '10000';
process.env.RATE_LIMIT_LLM_IP_ENTERPRISE = '10000';
process.env.RATE_LIMIT_LLM_USER_FREE = '10000';
process.env.RATE_LIMIT_LLM_USER_PRO = '10000';
process.env.RATE_LIMIT_LLM_USER_ENTERPRISE = '10000';

const USER_PREFIX = 'full-session-user-';
const userId = `${USER_PREFIX}${process.pid}`;

mock.module('../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
    return token === userId
      ? { user: { userId, email: 'full-session@example.test', plan: 'tester' }, error: null }
      : { user: null, error: 'Unauthorized' };
  },
}));

const { createRequestPipelineApp } = await importWithRealDb(() => import('../../http-pipeline.js'));
const { llmRoutes } = await importWithRealDb(() => import('../../routes/v1/llm.js'));
const { sessionMessageRoutes } = await importWithRealDb(
  () => import('../../routes/v1/session-messages.js'),
);
const { combatRoutes } = await importWithRealDb(() => import('../../routes/v1/combat/index.js'));
const { restRoutes } = await importWithRealDb(() => import('../../routes/v1/rest.js'));

const {
  campaigns,
  characters,
  characterStats,
  combatEncounters,
  combatParticipantStatus,
  dialogueHistory,
  gameSessions,
  restEvents,
} = await importWithRealDb(() => import('../../../../db/schema/index.js'));

if (!hasRealDb) {
  console.warn(
    '[full-session] SKIPPED: set TEST_DATABASE_URL to the dedicated Postgres at 127.0.0.1:55432 to run this suite.',
  );
}

const rawFixtures = JSON.parse(
  readFileSync(
    new URL('../../../test-fixtures/sessions/hand-made-30-turn/responses.json', import.meta.url),
    'utf8',
  ),
) as { responses: Array<Record<string, unknown>> };

let fetchIndex = 0;
let originalFetch: typeof fetch | undefined;

describeWithDb('full 30-turn session (#660 item 5)', () => {
  const database = hasRealDb ? realDb() : (null as never);
  let campaignId = '';
  let characterId = '';
  let sessionId = '';
  let encounterId = '';
  let heroParticipantId = '';
  let goblinParticipantId = '';
  const createdSessionIds: string[] = [];
  let goblinHpAtEntry = 0;
  let goblinHpAfterAttack = 0;
  let playerHpBeforeRest = 20;

  const app = hasRealDb
    ? createRequestPipelineApp()
        .use(llmRoutes)
        .use(sessionMessageRoutes)
        .use(combatRoutes)
        .use(restRoutes)
    : null;

  const call = async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: Record<string, unknown> }> => {
    if (!app) throw new Error('no app');
    const response = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { authorization: `Bearer ${userId}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  };

  beforeAll(async () => {
    if (!hasRealDb) return;
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      if (!url.includes('openrouter.ai') && !url.includes('generativelanguage.googleapis.com')) {
        throw new Error(`[full-session] unexpected network URL: ${url}`);
      }
      const fixture = rawFixtures.responses[fetchIndex++];
      if (!fixture) throw new Error('[full-session] ran out of hand-made responses');
      const fx = fixture as { status?: number };
      return new Response(JSON.stringify(fixture), {
        status: fx.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    setRngSeed(660);
    const [campaign] = await database
      .insert(campaigns)
      .values({ userId, name: testId('full-session-campaign') })
      .returning({ id: campaigns.id });
    campaignId = campaign.id;
    const [character] = await database
      .insert(characters)
      .values({ userId, campaignId, name: 'Full Session Hero', class: 'Fighter', level: 1 })
      .returning({ id: characters.id });
    characterId = character.id;
    await database.insert(characterStats).values({
      characterId,
      armorClass: 16,
      maxHitPoints: 20,
      currentHitPoints: 20,
      strength: 16,
    });
    const [session] = await database
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active', turnCount: 0 })
      .returning({ id: gameSessions.id });
    sessionId = session.id;
    createdSessionIds.push(sessionId);
  });

  afterAll(async () => {
    try {
      if (hasRealDb) {
        for (const id of createdSessionIds) {
          await database
            .delete(restEvents)
            .where(eq(restEvents.sessionId, id))
            .catch(() => {});
          await database
            .delete(gameSessions)
            .where(eq(gameSessions.id, id))
            .catch(() => {});
        }
        if (characterId) {
          await database
            .delete(characterStats)
            .where(eq(characterStats.characterId, characterId))
            .catch(() => {});
          await database
            .delete(characters)
            .where(eq(characters.id, characterId))
            .catch(() => {});
        }
        if (campaignId)
          await database
            .delete(campaigns)
            .where(eq(campaigns.id, campaignId))
            .catch(() => {});
      }
    } finally {
      if (originalFetch) globalThis.fetch = originalFetch;
      setRngSeed(undefined);
      await closeRealDb();
    }
  });

  test('drives 30 scripted turns', async () => {
    if (!hasRealDb) return;
    const inputs: string[] = Array.from({ length: 30 }, (_, i) => `Player action ${i + 1}.`);
    for (let i = 0; i < 30; i++) {
      const playerRes = await call('POST', `/v1/sessions/${sessionId}/messages`, {
        speaker_type: 'player',
        message: inputs[i],
      });
      expect(playerRes.status).toBe(200);

      const dmReplyId = crypto.randomUUID();
      const res = await call('POST', '/v1/llm/generate', {
        prompt: inputs[i],
        sessionId,
        player_input: inputs[i],
        dmReply: { messageId: dmReplyId, inCombat: false, narrationGated: false },
        combatEntry: {
          sessionId,
          player: { characterId, name: 'Full Session Hero', initiativeModifier: 2 },
        },
      });
      expect(res.status).toBe(200);

      if (i === 3) {
        const generatedText = typeof res.json.text === 'string' ? res.json.text : '';
        const generatedEnvelope = JSON.parse(generatedText) as {
          combat_entry_pending?: {
            combatants: Array<{ name: string; monsterId?: string | null; count: number }>;
            sceneSpec: unknown;
          };
        };
        const pending = generatedEnvelope.combat_entry_pending;
        expect(pending).toBeTruthy();
        const enterRes = await call('POST', `/v1/combat/sessions/${sessionId}/enter`, {
          combatants: (pending?.combatants ?? []).map((combatant) => ({
            name: combatant.name,
            monsterId: combatant.monsterId ?? undefined,
            count: combatant.count,
          })),
          sceneSpec: pending?.sceneSpec,
          player: { characterId, name: 'Full Session Hero', initiativeModifier: 2 },
        });
        expect(enterRes.status).toBe(201);
        const enterJson = enterRes.json as {
          encounter?: { id: string };
          participants?: Array<{ id: string; name: string; characterId?: string | null }>;
        };
        encounterId = enterJson.encounter?.id ?? '';
        expect(typeof encounterId).toBe('string');
        expect(encounterId.length).toBeGreaterThan(0);
        const participants = enterJson.participants ?? [];
        heroParticipantId = participants.find((p) => p.characterId === characterId)?.id ?? '';
        goblinParticipantId = participants.find((p) => /goblin/i.test(p.name))?.id ?? '';
        expect(heroParticipantId.length).toBeGreaterThan(0);
        expect(goblinParticipantId.length).toBeGreaterThan(0);
        const [statusRow] = await database
          .select({ currentHp: combatParticipantStatus.currentHp })
          .from(combatParticipantStatus)
          .where(eq(combatParticipantStatus.participantId, goblinParticipantId));
        goblinHpAtEntry = statusRow?.currentHp ?? 0;
        const [playerStats] = await database
          .select({ hp: characterStats.currentHitPoints })
          .from(characterStats)
          .where(eq(characterStats.characterId, characterId));
        playerHpBeforeRest = playerStats?.hp ?? 20;
      }

      if (i === 5) {
        const [enc] = await database
          .select({ version: combatEncounters.version })
          .from(combatEncounters)
          .where(eq(combatEncounters.id, encounterId));
        const attackRes = await call('POST', `/v1/combat/${encounterId}/attack`, {
          attackerId: heroParticipantId,
          targetId: goblinParticipantId,
          expectedVersion: enc.version,
          attackType: 'melee',
        });
        expect(attackRes.status).toBe(200);
        const [statusRow] = await database
          .select({ currentHp: combatParticipantStatus.currentHp })
          .from(combatParticipantStatus)
          .where(eq(combatParticipantStatus.participantId, goblinParticipantId));
        goblinHpAfterAttack = statusRow?.currentHp ?? goblinHpAtEntry;
      }

      if (i === 6) {
        const [encBeforeYield] = await database
          .select({ version: combatEncounters.version })
          .from(combatEncounters)
          .where(eq(combatEncounters.id, encounterId));
        const yieldRes = await call('POST', `/v1/combat/${encounterId}/intent`, {
          intent: {
            type: 'yield',
            actorId: heroParticipantId,
            expectedVersion: encBeforeYield.version,
          },
          source: 'player',
        });
        expect(yieldRes.status).toBe(200);
        const [playerStats] = await database
          .select({ hp: characterStats.currentHitPoints })
          .from(characterStats)
          .where(eq(characterStats.characterId, characterId));
        playerHpBeforeRest = playerStats?.hp ?? playerHpBeforeRest;
        const restRes = await call('POST', `/v1/rest/characters/${characterId}/long`, {
          sessionId,
        });
        expect(restRes.status).toBe(200);
      }
    }

    expect(fetchIndex).toBe(rawFixtures.responses.length);

    const history = await database
      .select({ id: dialogueHistory.id })
      .from(dialogueHistory)
      .where(eq(dialogueHistory.sessionId, sessionId));
    expect(history.length).toBe(
      30 /* player messages */ +
        28 /* DM replies persisted by /v1/llm/generate (turns 3-4 are combat-handled and skipped) */ +
        1 /* combat-entry seating system row written at /enter */ +
        1 /* story-rest engine line (#751 follow-up): the scripted DM-granted short rest posts its Hit Die rolls */ +
        2 /* goblin NPC attacks resolved during combat entry */,
    );

    const [enc] = await database
      .select({ status: combatEncounters.status })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    expect(enc.status).toBe('completed');

    const attackOrMonsterDamage = playerHpBeforeRest < 20 || goblinHpAfterAttack < goblinHpAtEntry;
    expect(attackOrMonsterDamage).toBe(true);

    const [stats] = await database
      .select({ hp: characterStats.currentHitPoints })
      .from(characterStats)
      .where(eq(characterStats.characterId, characterId));
    expect(stats.hp).toBe(20);

    const rests = await database
      .select({ restType: restEvents.restType, notes: restEvents.notes })
      .from(restEvents)
      .where(eq(restEvents.sessionId, sessionId));
    // One long rest from POST /v1/rest/characters/:id/long, plus one short "story rest"
    // that the server's DM story-rest path (services/dm/story-rest.ts) applies from a hand-made reply.
    expect(rests.map((r) => `${r.restType}:${r.notes ?? ''}`).sort()).toEqual([
      'long:',
      'short:story rest',
    ]);
  });
});
