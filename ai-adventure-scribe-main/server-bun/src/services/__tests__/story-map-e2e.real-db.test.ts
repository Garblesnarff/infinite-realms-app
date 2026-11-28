/* eslint-disable max-lines -- one end-to-end fixture: ingest, five DM turns, two reads, a fight. */
/**
 * #1756: the whole story map path on a real database, on a small fixture bible with two zones
 * and one route.
 *
 *  1. Ingest (#1752): the chunker parses the bible and its Routes line, buildStoryMap lays it out,
 *     and replaceStoryMap writes story_map_places and story_map_edges.
 *  2. Narrative replies with `place` through POST /v1/llm/generate (#1753): the opening place, a
 *     same-zone place with no route, a place in another zone with no route (dropped), and a
 *     place reached by the route.
 *  3. GET /v1/story-map/:campaignId returns the map to the owner and 404 to another user.
 *  4. A second session of the same campaign opens at the last place.
 *  5. A fight there uses that place's board (#1755).
 *
 * Auth and the model are spies; everything else is the real route, the real gate and SQL.
 * replaceStoryMap writes through the Supabase client, which this test serves from Postgres with
 * the few calls it makes (select/eq, upsert, delete/eq/in, insert, rpc).
 */
import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import postgres from 'postgres';

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
  dialogueHistory,
  gameSessions,
  starterCampaigns,
  storyMapEdges,
  storyMapPlaces,
  storyMapProgress,
} from '../../../../db/schema/index';
import { chunkCampaignFiles } from '../../../../tools/lore-keeper-ingest/src/chunker.js';
import { replaceStoryMap } from '../../../../tools/lore-keeper-ingest/src/reingest-database.js';
import { buildStoryMap } from '../../../../tools/lore-keeper-ingest/src/story-map.js';
import { generateMap } from '../../tactical/generator.js';

import type { SceneSpec } from '../../tactical/types.js';

process.env.PORT ??= '8897';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';
if (hasRealDb && !process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

const authModule = await importWithRealDb(() => import('../../lib/auth.js'));
const { LLMProviderService } = await importWithRealDb(() => import('../llm-provider-service.js'));
const dmReplyPersistence = await importWithRealDb(() => import('../dm/dm-reply-persistence.js'));
const { createRequestPipelineApp } = await importWithRealDb(() => import('../../http-pipeline.js'));
const { llmRoutes } = await importWithRealDb(() => import('../../routes/v1/llm.js'));
const { storyMapRoutes } = await importWithRealDb(() => import('../../routes/v1/story-map.js'));

const BIBLE = `## 4. LOCATIONS

### Zone 1: The Upper Reach
1. **The Rope Ledge**: A narrow ledge above the chasm.
2. **The Archive**: A dusty hall of shelves.

### Zone 2: The Deep
1. **The Sunken Gate**: A collapsed gate under black water.
2. **The Crypt**: Cramped tombs in a cave.

## Routes

- The Archive <-> The Sunken Gate (a flooded stair)

## 5. QUEST ARCHITECTURE
`;

/** The Supabase client calls replaceStoryMap makes, served from Postgres. */
type IngestClient = Parameters<typeof replaceStoryMap>[0];

function postgresSupabase(sql: ReturnType<typeof postgres>): IngestClient {
  const result = async (run: () => Promise<unknown>) => {
    try {
      return { data: await run(), error: null };
    } catch (error) {
      return { data: null, error: { message: (error as Error).message } };
    }
  };
  return {
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: string) =>
          result(
            () =>
              sql`SELECT ${sql(columns.split(',').map((c) => c.trim()))} FROM ${sql(table)} WHERE ${sql(column)} = ${value}`,
          ),
      }),
      upsert: (rows: Array<Record<string, unknown>>) =>
        result(
          () =>
            sql`INSERT INTO ${sql(table)} ${sql(rows)}
                ON CONFLICT (campaign_id, place_key) DO UPDATE SET
                  name = excluded.name, zone_key = excluded.zone_key, x = excluded.x, y = excluded.y,
                  fight_env = excluded.fight_env, fight_size = excluded.fight_size,
                  fight_seed = excluded.fight_seed, updated_at = excluded.updated_at`,
        ),
      insert: (rows: Array<Record<string, unknown>>) =>
        result(() => sql`INSERT INTO ${sql(table)} ${sql(rows)}`),
      delete: () => {
        const filters: { campaign?: string; keys?: string[] } = {};
        const builder = {
          eq: (_column: string, value: string) => {
            filters.campaign = value;
            return builder;
          },
          in: (_column: string, keys: string[]) => {
            filters.keys = keys;
            return builder;
          },
          then: (resolve: (value: unknown) => void, reject: (error: unknown) => void) =>
            result(() =>
              filters.keys
                ? sql`DELETE FROM ${sql(table)} WHERE campaign_id = ${filters.campaign!} AND place_key IN ${sql(filters.keys)}`
                : sql`DELETE FROM ${sql(table)} WHERE campaign_id = ${filters.campaign!}`,
            ).then(resolve, reject),
        };
        return builder;
      },
    }),
    rpc: (name: string, args: { p_campaign_id: string; p_edges: unknown[] }) =>
      result(
        () =>
          sql`SELECT ${sql(name)}(${args.p_campaign_id}, ${sql.json(args.p_edges as never)}) AS n`,
      ),
  } as unknown as IngestClient;
}

describeWithDb('#1756 the story map end to end', () => {
  const database = hasRealDb ? realDb() : (null as unknown as ReturnType<typeof realDb>);
  let raw: ReturnType<typeof postgres>;
  const starterId = testId('starter-e2e');
  const ownerId = testId('e2e-owner');
  const strangerId = testId('e2e-stranger');
  const campaignIds: string[] = [];
  let campaignId = '';
  const prompts: string[] = [];

  beforeAll(async () => {
    raw = postgres(realDbUrl, { max: 1, connect_timeout: 10, onnotice: () => {} });
    await database.insert(starterCampaigns).values({
      id: starterId,
      slug: starterId,
      title: 'Story map end to end',
      genre: ['horror'],
      tone: ['grim'],
      difficulty: 'medium',
      premise: 'A fixture.',
    });
    const [{ id }] = await database
      .insert(campaigns)
      .values({ userId: ownerId, name: testId('e2e-camp') })
      .returning({ id: campaigns.id });
    campaignId = id;
    campaignIds.push(id);
  });

  afterAll(async () => {
    if (campaignIds.length)
      await database.delete(campaigns).where(inArray(campaigns.id, campaignIds));
    await database.delete(starterCampaigns).where(eq(starterCampaigns.id, starterId));
    await raw.end({ timeout: 5 });
    await closeRealDb();
  });

  /** One DM turn through the real generate route; the model returns `envelope`. */
  async function turn(
    sessionId: string,
    envelope: Record<string, unknown>,
    options: { combat?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    const playerInput = 'I go on.';
    await database.insert(dialogueHistory).values({
      sessionId,
      speakerType: 'player',
      message: playerInput,
    });
    const auth = spyOn(authModule, 'authenticateRequest').mockResolvedValue({
      user: { userId: ownerId, email: 'map-owner@example.test', plan: 'free' },
      error: null,
    } as never);
    const model = spyOn(LLMProviderService, 'generate').mockImplementation((async (request: {
      prompt: string;
    }) => {
      prompts.push(request.prompt);
      return {
        text: JSON.stringify({
          combat_transition: 'none',
          scene_spec: null,
          map_actions: [],
          handout_actions: [],
          combatants: [],
          combat_actions: [],
          narration_segments: [],
          options: [],
          roll_requests: [],
          ...envelope,
        }),
        provider: 'openrouter',
        model: 't/m',
        usage: { inputTokens: 100, outputTokens: 40 },
      };
    }) as never);
    const watchdog = spyOn(dmReplyPersistence, 'scheduleDmReplyWatchdog').mockResolvedValue(
      undefined as never,
    );
    try {
      const response = await createRequestPipelineApp()
        .use(llmRoutes)
        .handle(
          new Request('http://localhost/v1/llm/generate', {
            method: 'POST',
            headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
            body: JSON.stringify({
              prompt: 'The hero walks on.',
              sessionId,
              player_input: playerInput,
              temperature: 0.9,
              maxTokens: 8192,
              requestType: 'user',
              dmReply: { messageId: crypto.randomUUID(), inCombat: false },
              ...(options.combat
                ? {
                    combatEntry: {
                      sessionId,
                      player: { characterId: null, name: 'Map Hero', initiativeModifier: 2 },
                    },
                  }
                : {}),
            }),
          }),
        );
      const body = (await response.json()) as { text?: string; error?: unknown };
      expect(response.status).toBe(200);
      expect(body.error ?? null).toBeNull();
      return JSON.parse(body.text ?? '{}') as Record<string, unknown>;
    } finally {
      auth.mockRestore();
      model.mockRestore();
      watchdog.mockRestore();
    }
  }

  const getMap = async (as: string) => {
    const auth = spyOn(authModule, 'authenticateRequest').mockResolvedValue({
      user: { userId: as, email: 'reader@example.test', plan: 'free' },
      error: null,
    } as never);
    try {
      return await createRequestPipelineApp()
        .use(storyMapRoutes)
        .handle(
          new Request(`http://localhost/v1/story-map/${campaignId}`, {
            headers: { authorization: 'Bearer t' },
          }),
        );
    } finally {
      auth.mockRestore();
    }
  };

  const progress = async () =>
    Object.fromEntries(
      (
        await database
          .select({ key: storyMapProgress.placeKey, state: storyMapProgress.state })
          .from(storyMapProgress)
          .where(eq(storyMapProgress.campaignId, campaignId))
      ).map((row) => [row.key, row.state]),
    );

  test('ingest, travel, read, a second session, and a fight at the place', async () => {
    // 1. Ingest: two zones, four places, one two-way route.
    const { chunks, routes } = chunkCampaignFiles(starterId, { campaignBible: BIBLE });
    const map = buildStoryMap(starterId, chunks, routes, null);
    const written = await replaceStoryMap(postgresSupabase(raw), map);
    expect(written).toMatchObject({ placesWritten: 4, edgesWritten: 2 });
    const places = await database
      .select({ key: storyMapPlaces.placeKey, zone: storyMapPlaces.zoneKey })
      .from(storyMapPlaces)
      .where(eq(storyMapPlaces.campaignId, starterId));
    expect(Object.fromEntries(places.map((p) => [p.key, p.zone]))).toEqual({
      'the-rope-ledge': 'the-upper-reach',
      'the-archive': 'the-upper-reach',
      'the-sunken-gate': 'the-deep',
      'the-crypt': 'the-deep',
    });
    const edges = await database
      .select({ from: storyMapEdges.fromKey, to: storyMapEdges.toKey })
      .from(storyMapEdges)
      .where(eq(storyMapEdges.campaignId, starterId));
    expect(edges.map((e) => `${e.from}>${e.to}`).sort()).toEqual([
      'the-archive>the-sunken-gate',
      'the-sunken-gate>the-archive',
    ]);

    // 2. Narrative replies with `place`, through the real generate route.
    const [{ id: firstSession }] = await database
      .insert(gameSessions)
      .values({ campaignId, starterCampaignId: starterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });

    const opening = await turn(firstSession, {
      text: 'You stand on the ledge.',
      place: 'the-rope-ledge',
    });
    expect(opening.place).toBe('the-rope-ledge');
    expect(prompts.at(-1)).toContain('The hero has not been placed on the map yet.');

    const sameZone = await turn(firstSession, {
      text: 'You step into the archive.',
      place: 'the-archive',
    });
    expect(sameZone.place).toBe('the-archive');
    expect(prompts.at(-1)).toContain('-> the-archive (The Archive) (same zone)');

    const otherZone = await turn(firstSession, {
      text: 'You think of the crypt.',
      place: 'the-crypt',
    });
    expect(otherZone.place).toBeNull();

    const byRoute = await turn(firstSession, {
      text: 'You wade down the stair.',
      place: 'the-sunken-gate',
    });
    expect(byRoute.place).toBe('the-sunken-gate');
    expect(await progress()).toEqual({
      'the-rope-ledge': 'visited',
      'the-archive': 'visited',
      'the-sunken-gate': 'visited',
      'the-crypt': 'known',
    });

    // 3. GET /v1/story-map: the owner sees it, another user gets a 404.
    const owner = await getMap(ownerId);
    expect(owner.status).toBe(200);
    const payload = (await owner.json()) as {
      available: boolean;
      currentPlaceKey: string;
      places: Array<{ key: string; state: string }>;
    };
    expect(payload.available).toBe(true);
    expect(payload.currentPlaceKey).toBe('the-sunken-gate');
    expect(payload.places.map((p) => `${p.key}:${p.state}`).sort()).toEqual([
      'the-archive:visited',
      'the-crypt:known',
      'the-rope-ledge:visited',
      'the-sunken-gate:visited',
    ]);
    expect((await getMap(strangerId)).status).toBe(404);

    // 4. A second session of the same campaign opens at the last place.
    const [{ id: secondSession }] = await database
      .insert(gameSessions)
      .values({ campaignId, starterCampaignId: starterId, sessionNumber: 2, status: 'active' })
      .returning({ id: gameSessions.id });
    await turn(secondSession, { text: 'The water is cold.' });
    expect(prompts.at(-1)).toContain('The hero is at the-sunken-gate (The Sunken Gate).');

    // 5. A fight there uses the place's board, whatever scene the DM wrote.
    const fight = await turn(
      secondSession,
      {
        text: 'A Drowned Guard rises from the water.',
        combat_transition: 'start',
        combatants: [{ name: 'Drowned Guard', count: 1 }],
        scene_spec: { environment: 'tavern', size: 'large', seed: 3 },
      },
      { combat: true },
    );
    const pending = fight.combat_entry_pending as { sceneSpec: SceneSpec } | undefined;
    expect(pending).toBeDefined();
    const [recipe] = await database
      .select({
        environment: storyMapPlaces.fightEnv,
        size: storyMapPlaces.fightSize,
        seed: storyMapPlaces.fightSeed,
      })
      .from(storyMapPlaces)
      .where(eq(storyMapPlaces.placeKey, 'the-sunken-gate'));
    expect(pending!.sceneSpec).toMatchObject(recipe);
    expect(generateMap({ ...pending!.sceneSpec, id: 'board' }).cells).toEqual(
      generateMap({ ...(recipe as unknown as SceneSpec), id: 'board' }).cells,
    );
  });
});
