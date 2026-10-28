/* eslint-disable max-lines */
/**
 * #1232: Bardic Inspiration and War Priest are refused when the character has
 * no characterStats row, and a successful Divine Intervention is not refilled
 * by a long rest for 7 days. A logged failure is refilled.
 *
 * Posts through POST /v1/characters and the class-features use and restore
 * routes. Auth is stubbed. CharacterService and ClassFeatureUsageService are not.
 */
import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { and, eq } from 'drizzle-orm';

import {
  characterFeatures,
  characterStats,
  characters,
  classFeaturesLibrary,
} from '../../../../../db/schema/index';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../services/__tests__/fixtures/real-db.ts';

const stub = () => ({
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
  child: () => stub(),
});

let userId = '';

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId, email: 'user@example.test', plan: 'free' },
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

type HeldFeature = {
  featureId: string;
  usesRemaining: number | null;
  feature?: { featureName?: string };
};

describeWithDb('ability-gated features and Divine Intervention (#1232)', () => {
  let app: {
    handle: (request: Request) => Promise<Response>;
  };
  let db: ReturnType<typeof realDb>;
  const createdIds: string[] = [];

  const request = async (path: string, method: string, body?: unknown) => {
    const response = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    );
    const text = await response.text();
    return { status: response.status, text, json: text ? (JSON.parse(text) as unknown) : null };
  };

  const create = async (name: string, className: string, level: number) => {
    const created = await request('/v1/characters', 'POST', { name, class: className, level });
    expect(created.status, created.text.slice(0, 300)).toBe(201);
    const id = (created.json as { id: string }).id;
    createdIds.push(id);
    return id;
  };

  const held = async (characterId: string): Promise<HeldFeature[]> => {
    const listed = await request(`/v1/class-features/characters/${characterId}/features`, 'GET');
    expect(listed.status, listed.text.slice(0, 300)).toBe(200);
    const body = listed.json as { features?: HeldFeature[] } | HeldFeature[];
    return Array.isArray(body) ? body : (body.features ?? []);
  };

  const named = (rows: HeldFeature[], featureName: string) =>
    rows.find((row) => row.feature?.featureName === featureName);

  // Two library rows share the name. Only the counted one (uses_count 1) is
  // decremented and refilled. The generated row has a NULL count.
  const countedDivineIntervention = async (characterId: string) => {
    const [row] = await db
      .select({
        featureId: characterFeatures.featureId,
        usesRemaining: characterFeatures.usesRemaining,
      })
      .from(characterFeatures)
      .innerJoin(classFeaturesLibrary, eq(characterFeatures.featureId, classFeaturesLibrary.id))
      .where(
        and(
          eq(characterFeatures.characterId, characterId),
          eq(classFeaturesLibrary.featureName, 'Divine Intervention'),
          eq(classFeaturesLibrary.usesCount, 1),
        ),
      )
      .limit(1);
    return row;
  };

  beforeAll(async () => {
    userId = testId('user-1232');
    db = realDb();
    const pipeline = await importWithRealDb(async () => {
      const { createRequestPipelineApp } = await import('../../../http-pipeline.ts');
      const { charactersRoutes } = await import('../characters.ts');
      const { classFeaturesRoutes } = await import('../class-features.ts');
      return { createRequestPipelineApp, charactersRoutes, classFeaturesRoutes };
    });
    app = pipeline
      .createRequestPipelineApp()
      .use(pipeline.charactersRoutes)
      .use(pipeline.classFeaturesRoutes);
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await db
        .delete(characters)
        .where(eq(characters.id, id))
        .catch(() => {});
    }
    await closeRealDb();
  });

  it('refuses Bardic Inspiration and War Priest when the stats row is gone', async () => {
    const bardId = await create(`Bard ${testId('1232')}`, 'Bard', 1);
    await db.delete(characterStats).where(eq(characterStats.characterId, bardId));
    const bardic = named(await held(bardId), 'Bardic Inspiration (d6)');
    expect(bardic?.featureId).toBeDefined();
    const bardicUse = await request(
      `/v1/class-features/characters/${bardId}/features/${bardic!.featureId}/use`,
      'POST',
      {},
    );
    expect(bardicUse.status).toBe(400);
    expect((bardicUse.json as { message?: string }).message).toContain('ability score');

    const clericId = await create(`Cleric ${testId('1232')}`, 'Cleric', 1);
    await db.delete(characterStats).where(eq(characterStats.characterId, clericId));
    const [library] = await db
      .select({ id: classFeaturesLibrary.id })
      .from(classFeaturesLibrary)
      .where(
        and(
          eq(classFeaturesLibrary.className, 'Cleric'),
          eq(classFeaturesLibrary.featureName, 'War Priest'),
        ),
      )
      .limit(1);
    expect(library?.id).toBeDefined();
    await db.insert(characterFeatures).values({
      characterId: clericId,
      featureId: library!.id,
      usesRemaining: 1,
      acquiredAtLevel: 1,
    });
    const warPriestUse = await request(
      `/v1/class-features/characters/${clericId}/features/${library!.id}/use`,
      'POST',
      {},
    );
    expect(warPriestUse.status).toBe(400);
    expect((warPriestUse.json as { message?: string }).message).toContain('ability score');
  });

  it('does not refill Divine Intervention for 7 days after a success', async () => {
    const clericId = await create(`Invoker ${testId('1232')}`, 'Cleric', 10);
    const feature = await countedDivineIntervention(clericId);
    expect(feature?.usesRemaining).toBe(1);
    const used = await request(
      `/v1/class-features/characters/${clericId}/features/${feature!.featureId}/use`,
      'POST',
      {},
    );
    expect(used.status).toBe(200);
    const again = await request(
      `/v1/class-features/characters/${clericId}/features/${feature!.featureId}/use`,
      'POST',
      {},
    );
    expect(again.status).toBe(400);
    const restored = await request(
      `/v1/class-features/characters/${clericId}/features/restore`,
      'POST',
      { restType: 'long' },
    );
    expect(restored.status).toBe(200);
    expect((await countedDivineIntervention(clericId))?.usesRemaining).toBe(0);
  });

  it('refills Divine Intervention on a long rest after a failed attempt', async () => {
    const clericId = await create(`Invoker fail ${testId('1232')}`, 'Cleric', 10);
    const feature = await countedDivineIntervention(clericId);
    expect(feature?.usesRemaining).toBe(1);
    const used = await request(
      `/v1/class-features/characters/${clericId}/features/${feature!.featureId}/use`,
      'POST',
      { context: 'divine-intervention:failure' },
    );
    expect(used.status).toBe(200);
    const restored = await request(
      `/v1/class-features/characters/${clericId}/features/restore`,
      'POST',
      { restType: 'long' },
    );
    expect(restored.status).toBe(200);
    expect((await countedDivineIntervention(clericId))?.usesRemaining).toBe(1);
  });
});
