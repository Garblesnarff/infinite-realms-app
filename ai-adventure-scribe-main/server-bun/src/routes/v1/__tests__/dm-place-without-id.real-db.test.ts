/* eslint-disable max-lines -- one seeded board serves both the refusal and the positive control,
   and the wire body, the corrective-reply shape and the reload helper would each be rebuilt. */
/**
 * #748 / #787: a DM `place` map action that arrives without a string id must be refused by the
 * engine, must not reach the board, and must survive the dm-actions route's one corrective retry
 * unchanged. An id-less entity matches a null client animation and crashes the board, so the
 * route's behavior around it is worth pinning down end to end.
 *
 * Every request goes through the real routes, mounted the way `app.ts` mounts them, against real
 * PostgreSQL. The refusal is a dispatch decision inside the engine, and the corrective retry is a
 * second engine dispatch on the model's replacement; a mocked tactical-action-service would only
 * prove the test's own stub. Only authentication is faked, because WorkOS cannot be reached from a
 * test. It refuses every target except the dedicated local/CI Postgres because it writes fixtures.
 *
 * The only other replacement is the LLM provider: the corrective reprompt must return a structured
 * DM response, so its `generate` is spied and restored per test. No tactical-action-service,
 * dispatch, engine or map-store mock is used.
 */
import { afterAll, beforeAll, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { eq, inArray, like } from 'drizzle-orm';

import { campaigns, gameSessions, tacticalMaps } from '../../../../../db/schema/index';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  realDbUrl,
  testId,
} from '../../../services/__tests__/fixtures/real-db.js';

import type { TacticalMap } from '../../../tactical/types.js';

if (hasRealDb) {
  const target = new URL(realDbUrl);
  if (target.hostname !== '127.0.0.1' || target.port !== '55432') {
    throw new Error(
      `[dm-place-without-id] refusing real-DB fixtures against ${target.hostname}:${target.port}; use the dedicated Postgres at 127.0.0.1:55432`,
    );
  }
}

process.env.PORT ??= '8893';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';

const USER_PREFIX = 'dm-place-without-id-user-';
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
const { LLMProviderService } = await importWithRealDb(
  () => import('../../../services/llm-provider-service.js'),
);

if (!hasRealDb) {
  console.warn(
    '[dm-place-without-id] SKIPPED: set TEST_DATABASE_URL to the dedicated Postgres at 127.0.0.1:55432 to run these.',
  );
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describeWithDb(
  'a DM place without an id is refused and never reaches the board (#748 / #787)',
  () => {
    const database = hasRealDb ? realDb() : (null as unknown as ReturnType<typeof realDb>);

    let app: { handle: (request: Request) => Response | Promise<Response> };
    let sessionId = '';
    let mapId = '';

    const call = async (method: string, path: string, body?: unknown, caller = userId) => {
      const response = await app.handle(
        new Request(`http://localhost${path}`, {
          method,
          headers: { authorization: `Bearer ${caller}`, 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      return { status: response.status, json: (await response.json()) as Json };
    };

    /** The `place` action the DM emits: top-level x/y plus the entity shape in `changes`. */
    const placeAction = (changes: Record<string, unknown>) => ({
      action: 'place',
      entityId: null,
      x: 5,
      y: 5,
      changes,
    });

    /** The rejection the engine hands the reprompt, wrapping the whole DM envelope the schema needs. */
    const correctiveReply = (mapActions: unknown[]) => ({
      text: JSON.stringify({
        text: '',
        map_actions: mapActions,
        narration_segments: [],
        roll_requests: [],
        combat_transition: 'none',
        scene_spec: null,
        combatants: [],
        combat_actions: [],
        handout_actions: [],
      }),
      provider: 'openrouter',
      model: 'test/model',
      usage: { inputTokens: 10, outputTokens: 10 },
    });

    const reloadMap = async (): Promise<TacticalMap> => {
      const [row] = await database.select().from(tacticalMaps).where(eq(tacticalMaps.id, mapId));
      if (!row) throw new Error('[dm-place-without-id] the active map row disappeared');
      return row.state as TacticalMap;
    };

    const entityIds = (map: TacticalMap): string[] => map.entities.map((entity) => entity.id);

    const removeFixtures = async () => {
      const owned = await database
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(like(campaigns.userId, `${USER_PREFIX}%`));
      // Sessions and their tactical maps go with the campaign (cascade).
      if (owned.length > 0) {
        await database.delete(campaigns).where(
          inArray(
            campaigns.id,
            owned.map((row) => row.id),
          ),
        );
      }
    };

    beforeAll(async () => {
      await removeFixtures();
      app = createRequestPipelineApp().use(tacticalMapRoutes) as unknown as typeof app;
    });

    beforeEach(async () => {
      await removeFixtures();
      const [campaign] = await database
        .insert(campaigns)
        .values({ userId, name: testId('dm-place-campaign') })
        .returning({ id: campaigns.id });
      const [session] = await database
        .insert(gameSessions)
        .values({ campaignId: campaign!.id, sessionNumber: 1, status: 'active' })
        .returning({ id: gameSessions.id });
      sessionId = session!.id;

      mapId = crypto.randomUUID();
      const state: TacticalMap = {
        id: mapId,
        sessionId,
        width: 12,
        height: 10,
        round: 1,
        sceneDescription: 'A rain-slick courtyard',
        cells: Array.from({ length: 10 }, () =>
          Array.from({ length: 12 }, () => ({
            terrain: 'floor',
            blocksMovement: false,
            blocksSight: false,
            cover: 0,
            elevation: 0,
          })),
        ),
        entities: [
          {
            id: 'pc-1',
            slug: 'player',
            x: 3,
            y: 3,
            size: 'medium',
            type: 'pc',
            speedFeet: 30,
            movementRemaining: 30,
          },
          {
            id: 'monster-1',
            slug: 'spent-sentinel',
            x: 9,
            y: 3,
            size: 'medium',
            type: 'monster',
            speedFeet: 30,
            movementRemaining: 30,
          },
        ],
      };
      await database.insert(tacticalMaps).values({ id: mapId, sessionId, active: true, state });
    });

    afterAll(async () => {
      if (hasRealDb) await removeFixtures();
      await closeRealDb();
    });

    test('refuses the place, retries once against the same bad reply, and leaves the board intact', async () => {
      const before = await reloadMap();
      // The corrective retry returns another place with no id: the engine must refuse it too.
      const generate = spyOn(LLMProviderService, 'generate').mockResolvedValue(
        correctiveReply([
          placeAction({
            name: 'Bitter End Mercenary',
            x: 5,
            y: 5,
            size: 'medium',
            type: 'monster',
            speedFeet: 30,
            movementRemaining: 30,
          }),
        ]) as never,
      );
      try {
        const { status, json } = await call(
          'POST',
          `/v1/sessions/${sessionId}/tactical-map/dm-actions`,
          {
            actions: [
              placeAction({
                name: 'Bitter End Mercenary',
                x: 5,
                y: 5,
                size: 'medium',
                type: 'monster',
                speedFeet: 30,
                movementRemaining: 30,
              }),
            ],
          },
        );
        expect(status).toBe(200);
        expect(json.results).toHaveLength(1);
        expect(json.results[0].applied).toBe(false);
        expect(json.results[0].refusal.reason).toBe('invalid_placement');
        // Exactly one corrective reprompt: the retry is bounded, never a loop.
        expect(generate).toHaveBeenCalledTimes(1);

        const after = await reloadMap();
        expect(after.entities).toHaveLength(before.entities.length);
        expect(entityIds(after).sort()).toEqual(entityIds(before).sort());
        expect(
          after.entities.every((entity) => typeof entity.id === 'string' && entity.id.length > 0),
        ).toBe(true);
      } finally {
        generate.mockRestore();
      }
    });

    test('applies the same place when it carries the id merc-1 (positive control)', async () => {
      // Stubbed even though this path must not reach it: a spy that falls through to the real
      // provider would make the test's own success the only thing standing between it and a call.
      const generate = spyOn(LLMProviderService, 'generate').mockResolvedValue(
        correctiveReply([]) as never,
      );
      try {
        const { status, json } = await call(
          'POST',
          `/v1/sessions/${sessionId}/tactical-map/dm-actions`,
          {
            actions: [
              placeAction({
                id: 'merc-1',
                name: 'Bitter End Mercenary',
                x: 5,
                y: 5,
                size: 'medium',
                type: 'monster',
                speedFeet: 30,
                movementRemaining: 30,
              }),
            ],
          },
        );
        expect(status).toBe(200);
        expect(json.results[0].applied).toBe(true);
        // An accepted placement needs no correction, so the provider is never called.
        expect(generate).not.toHaveBeenCalled();

        expect(entityIds(await reloadMap())).toContain('merc-1');
      } finally {
        generate.mockRestore();
      }
    });
  },
);
