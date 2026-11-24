/**
 * #1741: a premade hero can carry the name its player typed at hero choice. The client
 * posts the shared premade body with `name` set; the real character route saves that name on
 * the player's copy and leaves the starter template row alone. The DM, sheet and chronicle
 * read the saved character row, so that row is what this test checks.
 *
 * Real database, real character routes. Auth is stubbed. Requires TEST_DATABASE_URL or
 * DATABASE_URL (see services/__tests__/fixtures/real-db.ts).
 */
import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import postgres from 'postgres';

import {
  PREMADE_TYPED_HERO_NAME,
  premadeCreateBody,
  PREMADE_TEMPLATE_ROW,
} from '../../../../../shared/test-fixtures/premade-create-body';
import {
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDbUrl,
  testId,
} from '../../../services/__tests__/fixtures/real-db.js';

// A template id of its own, so this file never touches the row the legend-gate file uses.
const HERO_NAME_TEMPLATE_ID = '7c2e1f4a-9b3d-4c8e-8a1f-2d3e4f5a6b7c';

const stub = () => ({
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
  child: () => stub(),
});

let client: ReturnType<typeof postgres> | null = null;
const sql = (...args: Parameters<ReturnType<typeof postgres>>) => {
  client ??= postgres(realDbUrl, { max: 2, connect_timeout: 10, onnotice: () => {} });
  return client(...args);
};

let userId = '';

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    if (request.headers.get('authorization') !== 'Bearer test-token') {
      return { user: null, error: 'Unauthorized' };
    }
    return {
      user: { userId, email: 'hero-name@example.test', plan: 'free' },
      error: null,
    };
  },
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

const pipeline = await importWithRealDb(async () => {
  const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
  const { charactersRoutes } = await import('../characters.js');
  return createRequestPipelineApp().use(charactersRoutes);
});

describeWithDb('a premade hero keeps the name typed at hero choice (#1741)', () => {
  const createdIds: string[] = [];
  const campaignId = `hero-name-1741-${process.pid}`;

  const post = (body: unknown): Promise<Response> =>
    pipeline.handle(
      new Request('http://localhost/v1/characters', {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
    );

  beforeAll(async () => {
    userId = testId('hero-name-user');
    await sql`INSERT INTO users (id, email, plan) VALUES (${userId}, ${`${userId}@fixture.test`}, 'free')`;
    await sql`DELETE FROM starter_character_templates WHERE id = ${HERO_NAME_TEMPLATE_ID}`;
    await sql`DELETE FROM starter_campaigns WHERE id = ${campaignId}`;
    await sql`INSERT INTO starter_campaigns (id, slug, title, genre, tone, difficulty, premise, is_complete, is_published)
          VALUES (${campaignId}, ${campaignId}, 'Hero name 1741', ARRAY['fantasy']::text[], ARRAY['heroic']::text[],
                  CAST(${'medium'} AS campaign_difficulty), 'Fixture for the #1741 typed hero name.', false, false)`;
    await sql`INSERT INTO starter_character_templates
            (id, starter_campaign_id, template_key, name, race, class, background, level,
             ability_scores, skills, languages, equipment)
          VALUES (${HERO_NAME_TEMPLATE_ID}, ${campaignId}, 'hero-name-champion', ${PREMADE_TEMPLATE_ROW.name},
                  ${PREMADE_TEMPLATE_ROW.race}, ${PREMADE_TEMPLATE_ROW.class}, ${PREMADE_TEMPLATE_ROW.background}, ${PREMADE_TEMPLATE_ROW.level},
                  CAST(${JSON.stringify(PREMADE_TEMPLATE_ROW.abilityScores)} AS jsonb),
                  CAST(${JSON.stringify(PREMADE_TEMPLATE_ROW.skills)} AS jsonb),
                  CAST(${JSON.stringify(PREMADE_TEMPLATE_ROW.languages)} AS jsonb),
                  CAST(${'[]'} AS jsonb))`;
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    for (const id of createdIds) {
      await sql`DELETE FROM characters WHERE id = ${id}`.catch(() => {});
    }
    await sql`DELETE FROM starter_character_templates WHERE id = ${HERO_NAME_TEMPLATE_ID}`.catch(
      () => {},
    );
    await sql`DELETE FROM starter_campaigns WHERE id = ${campaignId}`.catch(() => {});
    await sql`DELETE FROM users WHERE id = ${userId}`.catch(() => {});
    await client?.end({ timeout: 5 }).catch(() => {});
  });

  it('saves the typed name on the character row and leaves the template row unchanged', async () => {
    const res = await post(premadeCreateBody(HERO_NAME_TEMPLATE_ID, PREMADE_TYPED_HERO_NAME));
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; name: string };
    createdIds.push(created.id);
    expect(created.name).toBe(PREMADE_TYPED_HERO_NAME);

    const [row] = (await sql`
      SELECT name, origin FROM characters WHERE id = ${created.id}
    `) as unknown as Array<{ name: string; origin: string }>;
    expect(row.name).toBe(PREMADE_TYPED_HERO_NAME);
    expect(row.origin).toBe('starter');

    const [template] = (await sql`
      SELECT name FROM starter_character_templates WHERE id = ${HERO_NAME_TEMPLATE_ID}
    `) as unknown as Array<{ name: string }>;
    expect(template.name).toBe(PREMADE_TEMPLATE_ROW.name);
  });
});
