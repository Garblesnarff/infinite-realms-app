/**
 * #224: Use Feature and rests against a real database, through the real
 * character and rest routes. Auth is stubbed. CharacterService and RestService
 * are not.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';

import { campaigns, characterStats, characters, restEvents } from '../../../../../db/schema/index';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../services/__tests__/fixtures/real-db.js';

const stub = () => ({
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
  child: () => stub(),
});

let userId = '';

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer test-token'
      ? { user: { userId, email: 'user@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
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

const pipeline = await importWithRealDb(async () => {
  const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
  const { charactersRoutes } = await import('../characters.js');
  const { restRoutes } = await import('../rest.js');
  return createRequestPipelineApp().use(charactersRoutes).use(restRoutes);
});

if (!hasRealDb) {
  console.warn(
    '[sheet-feature-rest] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

const spent = {
  second_wind: {
    name: 'second_wind',
    currentUses: 0,
    maxUses: 1,
    usesPerRest: 'short',
  },
  indomitable: {
    name: 'indomitable',
    currentUses: 0,
    maxUses: 1,
    usesPerRest: 'long',
  },
};

const authHeaders = {
  authorization: 'Bearer test-token',
  'content-type': 'application/json',
};

describeWithDb('sheet feature uses and rests persist (#224)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  let campaignId: string;
  let characterId: string;

  beforeAll(async () => {
    if (!hasRealDb) return;
    userId = testId('sheet-rest-user');
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('camp') })
      .returning({ id: campaigns.id });
    [{ id: characterId }] = await db
      .insert(characters)
      .values({ userId, campaignId, name: testId('fighter'), level: 1, class: 'Fighter' })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      maxHitPoints: 10,
      currentHitPoints: 4,
      temporaryHitPoints: 0,
      isConscious: true,
      vitalState: 'standing',
    });
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    const drop = async (run: () => Promise<unknown>) => {
      try {
        await run();
      } catch {
        /* fixture teardown is best-effort */
      }
    };
    await drop(() => db.delete(restEvents).where(eq(restEvents.characterId, characterId)));
    await drop(() => db.delete(characterStats).where(eq(characterStats.characterId, characterId)));
    await drop(() => db.delete(characters).where(eq(characters.id, characterId)));
    await drop(() => db.delete(campaigns).where(eq(campaigns.id, campaignId)));
    await closeRealDb();
  });

  const request = (path: string, method: string, body?: unknown): Promise<Response> =>
    pipeline.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: authHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );

  it('PUT class_features round-trips on GET, short rest restores short uses, long rest restores HP and all uses', async () => {
    const put = await request(`/v1/characters/${characterId}`, 'PUT', { class_features: spent });
    expect(put.status).toBe(200);

    const got = (await (await request(`/v1/characters/${characterId}`, 'GET')).json()) as {
      class_features: typeof spent;
      stats?: { current_hit_points?: number; max_hit_points?: number };
    };
    expect(got.class_features.second_wind.currentUses).toBe(0);
    expect(got.class_features.second_wind.maxUses).toBe(1);
    expect(got.class_features.indomitable.currentUses).toBe(0);
    expect(got.stats?.current_hit_points).toBe(4);

    const shortRest = await request(`/v1/rest/characters/${characterId}/short`, 'POST', {
      hitDiceToSpend: 0,
    });
    expect(shortRest.status).toBe(200);
    const afterShort = (await (await request(`/v1/characters/${characterId}`, 'GET')).json()) as {
      class_features: typeof spent;
      stats?: { current_hit_points?: number };
    };
    expect(afterShort.class_features.second_wind.currentUses).toBe(1);
    expect(afterShort.class_features.indomitable.currentUses).toBe(0);
    expect(afterShort.stats?.current_hit_points).toBe(4);

    await db.update(characters).set({ classFeatures: spent }).where(eq(characters.id, characterId));

    const longRest = await request(`/v1/rest/characters/${characterId}/long`, 'POST', {});
    expect(longRest.status).toBe(200);
    const afterLong = (await (await request(`/v1/characters/${characterId}`, 'GET')).json()) as {
      class_features: typeof spent;
      stats?: { current_hit_points?: number; max_hit_points?: number };
    };
    expect(afterLong.class_features.second_wind.currentUses).toBe(1);
    expect(afterLong.class_features.indomitable.currentUses).toBe(1);
    expect(afterLong.stats?.current_hit_points).toBe(10);
    expect(afterLong.stats?.max_hit_points).toBe(10);
  });
});
