/**
 * #1753 story map, against a real database: the DM's `place` writes progress on the player's
 * campaign, a second session of the same campaign opens where the first ended, a player-made
 * campaign gets nothing, and GET /v1/story-map/:campaignId shows the owner only what they found.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

import {
  campaigns,
  gameSessions,
  starterCampaigns,
  storyMapEdges,
  storyMapPlaces,
  storyMapProgress,
} from '../../../../../db/schema/index';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../services/__tests__/fixtures/real-db.ts';

import type * as StoryMapService from '../../../services/story-map/story-map-service.ts';

const stub = () => ({
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
  child: () => stub(),
});

let authUserId = '';

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: authUserId, email: 'user@example.test', plan: 'free' },
    error: null,
  }),
}));
mock.module('../../../lib/logger.js', () => ({
  logger: stub(),
  combatLogger: stub(),
  spellLogger: stub(),
  progressionLogger: stub(),
  errorLogSerializers: {},
  default: stub(),
}));

if (hasRealDb && !process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
if (hasRealDb) {
  process.env.CORS_ORIGIN ??= 'http://localhost:5173';
  process.env.WORKOS_API_KEY ??= 'test-workos-api-key';
  process.env.WORKOS_CLIENT_ID ??= 'test-workos-client-id';
  process.env.PORT ??= '8888';
}

describeWithDb('#1753 story map progress and GET /v1/story-map/:campaignId', () => {
  let app: { handle: (request: Request) => Promise<Response> };
  let service: typeof StoryMapService;
  const starterId = testId('starter-1753');
  const owner = testId('user-1753');
  const stranger = testId('stranger-1753');
  const campaignIds: string[] = [];
  let campaignId = '';
  let firstSession = '';
  let secondSession = '';
  let playerMadeCampaign = '';
  let playerMadeSession = '';
  let looseSession = '';

  const get = (id: string, as: string): Promise<Response> => {
    authUserId = as;
    return app.handle(new Request(`http://localhost/v1/story-map/${id}`));
  };

  beforeAll(async () => {
    const modules = await importWithRealDb(async () => ({
      ...(await import('../../../http-pipeline.ts')),
      ...(await import('../story-map.ts')),
      service: await import('../../../services/story-map/story-map-service.ts'),
    }));
    service = modules.service;
    app = modules.createRequestPipelineApp().use(modules.storyMapRoutes);

    const db = realDb();
    await db.insert(starterCampaigns).values({
      id: starterId,
      slug: starterId,
      title: 'Story map fixture',
      genre: ['horror'],
      tone: ['grim'],
      difficulty: 'medium',
      premise: 'A fixture.',
    });
    // ledge <-> archive <-(hidden)-> crypt ; ledge -> gate ; vault is reachable from nowhere.
    await db.insert(storyMapPlaces).values(
      ['the-ledge', 'the-archive', 'the-crypt', 'the-gate', 'the-vault'].map((key, index) => ({
        campaignId: starterId,
        placeKey: key,
        name: key
          .replace('the-', 'The ')
          .replace(/^The (\w)/, (_, c: string) => `The ${c.toUpperCase()}`),
        // One zone per place: only routes connect them (same-zone places are neighbours).
        zoneKey: key,
        x: 0.1 + index * 0.1,
        y: 0.5,
        fightEnv: 'dungeon_room',
        fightSize: 'medium',
        fightSeed: index + 1,
      })),
    );
    await db.insert(storyMapEdges).values([
      { campaignId: starterId, fromKey: 'the-ledge', toKey: 'the-archive', hidden: false },
      { campaignId: starterId, fromKey: 'the-archive', toKey: 'the-ledge', hidden: false },
      {
        campaignId: starterId,
        fromKey: 'the-archive',
        toKey: 'the-crypt',
        hidden: true,
        label: 'secret stair',
      },
      {
        campaignId: starterId,
        fromKey: 'the-crypt',
        toKey: 'the-archive',
        hidden: true,
        label: 'secret stair',
      },
      {
        campaignId: starterId,
        fromKey: 'the-ledge',
        toKey: 'the-gate',
        hidden: false,
        label: 'rope bridge',
      },
    ]);

    const [campaign] = await db
      .insert(campaigns)
      .values({ userId: owner, name: 'Starter playthrough' })
      .returning({ id: campaigns.id });
    campaignId = campaign.id;
    const [madeUp] = await db
      .insert(campaigns)
      .values({ userId: owner, name: 'My own world' })
      .returning({ id: campaigns.id });
    playerMadeCampaign = madeUp.id;
    campaignIds.push(campaignId, playerMadeCampaign);

    const [s1] = await db
      .insert(gameSessions)
      .values({ campaignId, starterCampaignId: starterId, sessionNumber: 1 })
      .returning({ id: gameSessions.id });
    firstSession = s1.id;
    const [made] = await db
      .insert(gameSessions)
      .values({ campaignId: playerMadeCampaign, sessionNumber: 1 })
      .returning({ id: gameSessions.id });
    playerMadeSession = made.id;
    const [loose] = await db
      .insert(gameSessions)
      .values({ starterCampaignId: starterId, sessionNumber: 1 })
      .returning({ id: gameSessions.id });
    looseSession = loose.id;
  });

  afterAll(async () => {
    const db = realDb();
    await db.delete(gameSessions).where(eq(gameSessions.id, looseSession));
    if (campaignIds.length) await db.delete(campaigns).where(inArray(campaigns.id, campaignIds));
    await db.delete(starterCampaigns).where(eq(starterCampaigns.id, starterId));
    await closeRealDb();
  });

  it('places the hero, follows a route and a found secret stair, and drops what does not fit', async () => {
    expect(
      await service.applyStoryMapPlace({
        sessionId: firstSession,
        userId: owner,
        place: 'the-ledge',
      }),
    ).toMatchObject({ accepted: true, via: 'opening' });
    expect(
      await service.applyStoryMapPlace({
        sessionId: firstSession,
        userId: owner,
        place: 'the-vault',
      }),
    ).toEqual({ accepted: false, reason: 'not_reachable' });
    expect(
      await service.applyStoryMapPlace({
        sessionId: firstSession,
        userId: owner,
        place: 'the-moon',
      }),
    ).toEqual({ accepted: false, reason: 'unknown_key' });
    expect(
      await service.applyStoryMapPlace({
        sessionId: firstSession,
        userId: stranger,
        place: 'the-archive',
      }),
    ).toEqual({ accepted: false, reason: 'no_map' });
    expect(
      await service.applyStoryMapPlace({
        sessionId: firstSession,
        userId: owner,
        place: 'the-archive',
      }),
    ).toMatchObject({ accepted: true, via: 'neighbour' });
    expect(
      await service.applyStoryMapPlace({
        sessionId: firstSession,
        userId: owner,
        place: 'the-crypt',
      }),
    ).toMatchObject({ accepted: true, via: 'neighbour' });

    const rows = await realDb()
      .select({ key: storyMapProgress.placeKey, state: storyMapProgress.state })
      .from(storyMapProgress)
      .where(eq(storyMapProgress.campaignId, campaignId));
    expect(Object.fromEntries(rows.map((row) => [row.key, row.state]))).toEqual({
      'the-ledge': 'visited',
      'the-archive': 'visited',
      'the-crypt': 'visited',
      'the-gate': 'known',
    });
  });

  it('a second session of the same campaign opens at the last place with the same map', async () => {
    const [s2] = await realDb()
      .insert(gameSessions)
      .values({ campaignId, starterCampaignId: starterId, sessionNumber: 2 })
      .returning({ id: gameSessions.id });
    secondSession = s2.id;
    const directive = await service.loadStoryMapDirective({
      sessionId: secondSession,
      userId: owner,
    });
    expect(directive).toContain('The hero is at the-crypt (The Crypt).');
    expect(directive).toContain('- the-gate (The Gate): known');
    expect(directive).not.toContain('the-vault');

    const response = await get(campaignId, owner);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.available).toBe(true);
    expect(payload.currentPlaceKey).toBe('the-crypt');
    expect(
      payload.places.map((p: { key: string; state: string; current: boolean }) => [
        p.key,
        p.state,
        p.current,
      ]),
    ).toEqual([
      ['the-archive', 'visited', false],
      ['the-crypt', 'visited', true],
      ['the-gate', 'known', false],
      ['the-ledge', 'visited', false],
    ]);
    expect(
      payload.edges.map((e: { from: string; to: string }) => `${e.from}>${e.to}`).sort(),
    ).toEqual([
      'the-archive>the-crypt',
      'the-archive>the-ledge',
      'the-crypt>the-archive',
      'the-ledge>the-archive',
      'the-ledge>the-gate',
    ]);
    expect(JSON.stringify(payload)).not.toContain('the-vault');
  });

  it('hides unknown places and unrevealed hidden routes from the payload', async () => {
    const [fresh] = await realDb()
      .insert(campaigns)
      .values({ userId: owner, name: 'Second playthrough' })
      .returning({ id: campaigns.id });
    campaignIds.push(fresh.id);
    const [session] = await realDb()
      .insert(gameSessions)
      .values({ campaignId: fresh.id, starterCampaignId: starterId, sessionNumber: 1 })
      .returning({ id: gameSessions.id });
    await service.applyStoryMapPlace({
      sessionId: session.id,
      userId: owner,
      place: 'the-archive',
    });
    const payload = await (await get(fresh.id, owner)).json();
    expect(payload.places.map((p: { key: string }) => p.key)).toEqual(['the-archive', 'the-ledge']);
    expect(JSON.stringify(payload)).not.toContain('the-crypt');
    expect(JSON.stringify(payload)).not.toContain('secret stair');
  });

  it("another user's campaign is a 404, not the map", async () => {
    const response = await get(campaignId, stranger);
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain('the-crypt');
  });

  it('a player-made campaign or a session with no campaign gets no place list and writes nothing', async () => {
    expect(
      await service.loadStoryMapDirective({ sessionId: playerMadeSession, userId: owner }),
    ).toBeNull();
    expect(
      await service.applyStoryMapPlace({
        sessionId: playerMadeSession,
        userId: owner,
        place: 'the-ledge',
      }),
    ).toEqual({ accepted: false, reason: 'no_map' });
    expect(
      await service.loadStoryMapDirective({ sessionId: looseSession, userId: owner }),
    ).toBeNull();
    expect(
      await service.applyStoryMapPlace({
        sessionId: looseSession,
        userId: owner,
        place: 'the-ledge',
      }),
    ).toEqual({ accepted: false, reason: 'no_map' });
    const written = await realDb()
      .select({ key: storyMapProgress.placeKey })
      .from(storyMapProgress)
      .where(eq(storyMapProgress.campaignId, playerMadeCampaign));
    expect(written).toEqual([]);
    const payload = await (await get(playerMadeCampaign, owner)).json();
    expect(payload).toEqual({
      campaignId: playerMadeCampaign,
      available: false,
      currentPlaceKey: null,
      zones: [],
      places: [],
      edges: [],
    });
  });
});

describe('#1753 story map real-DB suite', () => {
  it('says out loud when it skipped', () => {
    if (!hasRealDb) console.warn('story-map.real-db.test.ts skipped: no TEST_DATABASE_URL');
    expect(true).toBe(true);
  });
});
