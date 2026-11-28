/**
 * #1755 against a real database: the current place's fight recipe is read for the owner only,
 * and there is none for a player-made campaign, a session with no campaign, or a campaign with
 * no visited place yet.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from './fixtures/real-db.ts';
import {
  campaigns,
  gameSessions,
  starterCampaigns,
  storyMapPlaces,
} from '../../../../db/schema/index';

import type * as StoryMapService from '../story-map/story-map-service.ts';

const stub = () => ({
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
  child: () => stub(),
});
mock.module('../../lib/logger.js', () => ({
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

describeWithDb('#1755 loadPlaceFightRecipe', () => {
  let service: typeof StoryMapService;
  const starterId = testId('starter-1755');
  const owner = testId('user-1755');
  const campaignIds: string[] = [];
  let starterSession = '';
  let playerMadeSession = '';
  let looseSession = '';

  beforeAll(async () => {
    service = await importWithRealDb(() => import('../story-map/story-map-service.ts'));
    const db = realDb();
    await db.insert(starterCampaigns).values({
      id: starterId,
      slug: starterId,
      title: 'Place recipe fixture',
      genre: ['horror'],
      tone: ['grim'],
      difficulty: 'medium',
      premise: 'A fixture.',
    });
    await db.insert(storyMapPlaces).values([
      {
        campaignId: starterId,
        placeKey: 'the-crypt',
        name: 'The Crypt',
        x: 0.2,
        y: 0.2,
        fightEnv: 'cave',
        fightSize: 'small',
        fightSeed: 424242,
      },
      {
        campaignId: starterId,
        placeKey: 'the-hall',
        name: 'The Hall',
        x: 0.8,
        y: 0.8,
        fightEnv: 'tavern',
        fightSize: 'large',
        fightSeed: 777,
      },
    ]);
    const [played] = await db
      .insert(campaigns)
      .values({ userId: owner, name: 'Starter playthrough' })
      .returning({ id: campaigns.id });
    const [madeUp] = await db
      .insert(campaigns)
      .values({ userId: owner, name: 'My own world' })
      .returning({ id: campaigns.id });
    campaignIds.push(played.id, madeUp.id);
    [{ id: starterSession }] = await db
      .insert(gameSessions)
      .values({ campaignId: played.id, starterCampaignId: starterId, sessionNumber: 1 })
      .returning({ id: gameSessions.id });
    [{ id: playerMadeSession }] = await db
      .insert(gameSessions)
      .values({ campaignId: madeUp.id, sessionNumber: 1 })
      .returning({ id: gameSessions.id });
    [{ id: looseSession }] = await db
      .insert(gameSessions)
      .values({ starterCampaignId: starterId, sessionNumber: 1 })
      .returning({ id: gameSessions.id });
  });

  afterAll(async () => {
    const db = realDb();
    await db.delete(gameSessions).where(eq(gameSessions.id, looseSession));
    if (campaignIds.length) await db.delete(campaigns).where(inArray(campaigns.id, campaignIds));
    await db.delete(starterCampaigns).where(eq(starterCampaigns.id, starterId));
    await closeRealDb();
  });

  it('is null before the first visit, then the current place recipe, for the owner only', async () => {
    expect(await service.loadPlaceFightRecipe(starterSession, owner)).toBeNull();
    await service.applyStoryMapPlace({
      sessionId: starterSession,
      userId: owner,
      place: 'the-hall',
    });
    expect(await service.loadPlaceFightRecipe(starterSession, owner)).toEqual({
      placeKey: 'the-hall',
      environment: 'tavern',
      size: 'large',
      seed: 777,
    });
    expect(await service.loadPlaceFightRecipe(starterSession, testId('stranger'))).toBeNull();
  });

  it('is null for a player-made campaign and a session with no campaign', async () => {
    expect(await service.loadPlaceFightRecipe(playerMadeSession, owner)).toBeNull();
    expect(await service.loadPlaceFightRecipe(looseSession, owner)).toBeNull();
  });
});

describe('#1755 place recipe real-DB suite', () => {
  it('says out loud when it skipped', () => {
    if (!hasRealDb)
      console.warn('place-fight-recipe.real-db.test.ts skipped: no TEST_DATABASE_URL');
    expect(true).toBe(true);
  });
});
