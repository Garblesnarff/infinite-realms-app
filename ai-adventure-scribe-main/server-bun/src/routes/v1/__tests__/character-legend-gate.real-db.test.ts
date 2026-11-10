/**
 * #1344: the server decides whether a hero is a free premade ('starter') or a Legend custom or
 * import hero. Real database, real character routes. Auth is stubbed; the plan comes from the
 * users table through the strict resolver, as in production.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL (see fixtures/real-db.ts).
 */
import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import postgres from 'postgres';

import {
  PREMADE_TEMPLATE_ID,
  premadeCreateBody,
} from '../../../../../shared/test-fixtures/premade-create-body';
import {
  describeWithDb,
  grantLegendPlan,
  hasRealDb,
  importWithRealDb,
  realDbUrl,
  testId,
} from '../../../services/__tests__/fixtures/real-db.js';

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

let freeUserId = '';
let legendUserId = '';

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    if (request.headers.get('authorization') !== 'Bearer test-token') {
      return { user: null, error: 'Unauthorized' };
    }
    const header = request.headers.get('x-test-user');
    // 'broken': a NUL byte in the id. Postgres rejects it, so the plan lookup fails for real (#1344).
    const userId =
      header === 'broken' ? `${freeUserId}\u0000` : header === 'legend' ? legendUserId : freeUserId;
    return {
      user: { userId, email: 'gate@example.test', plan: header === 'legend' ? 'pro' : 'free' },
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

if (!hasRealDb) {
  console.warn(
    '[character-legend-gate] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

describeWithDb('Legend gate on character create and import (#1344)', () => {
  const createdIds: string[] = [];
  const campaignId = `gate-1344-${process.pid}`;
  let templateRowId = PREMADE_TEMPLATE_ID;

  const post = (
    path: string,
    body: unknown,
    who: 'free' | 'legend' | 'broken',
  ): Promise<Response> =>
    pipeline.handle(
      new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-token',
          'content-type': 'application/json',
          'x-test-user': who,
        },
        body: JSON.stringify(body),
      }),
    );

  const rowsNamed = async (name: string) =>
    (await sql`SELECT id, user_id, origin FROM characters WHERE name = ${name}`) as unknown as Array<{
      id: string;
      user_id: string;
      origin: string;
    }>;

  const created = async (res: Response): Promise<string> => {
    const body = (await res.json()) as { id: string };
    createdIds.push(body.id);
    return body.id;
  };

  beforeAll(async () => {
    freeUserId = testId('gate-free');
    legendUserId = testId('gate-legend');
    await sql`INSERT INTO users (id, email, plan) VALUES (${freeUserId}, ${`${freeUserId}@fixture.test`}, 'free')`;
    await grantLegendPlan(legendUserId);
    await sql`DELETE FROM starter_character_templates WHERE id = ${PREMADE_TEMPLATE_ID}`;
    await sql`DELETE FROM starter_campaigns WHERE id = ${campaignId}`;
    await sql`INSERT INTO starter_campaigns (id, slug, title, genre, tone, difficulty, premise, is_complete, is_published)
          VALUES (${campaignId}, ${campaignId}, 'Gate 1344', ARRAY['fantasy']::text[], ARRAY['heroic']::text[],
                  CAST(${'medium'} AS campaign_difficulty), 'Fixture for the #1344 Legend gate.', false, false)`;
    await sql`INSERT INTO starter_character_templates
            (id, starter_campaign_id, template_key, name, race, class, background, level,
             ability_scores, skills, languages, equipment)
          VALUES (${PREMADE_TEMPLATE_ID}, ${campaignId}, 'gate-champion', 'Gate Champion', 'Human', 'Fighter',
                  'Soldier', 3,
                  CAST(${JSON.stringify({ strength: 16, dexterity: 14, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 })} AS jsonb),
                  CAST(${JSON.stringify(['Athletics', 'Perception'])} AS jsonb),
                  CAST(${JSON.stringify(['Common'])} AS jsonb),
                  CAST(${'[]'} AS jsonb))`;
    templateRowId = PREMADE_TEMPLATE_ID;
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    for (const id of createdIds) {
      await sql`DELETE FROM characters WHERE id = ${id}`.catch(() => {});
    }
    await sql`DELETE FROM starter_character_templates WHERE id = ${templateRowId}`.catch(() => {});
    await sql`DELETE FROM starter_campaigns WHERE id = ${campaignId}`.catch(() => {});
    await client?.end({ timeout: 5 });
    client = null;
  });

  it('lets a Free player create a premade hero: 201, stored as starter', async () => {
    const name = testId('Premade Gate');
    const res = await post('/v1/characters', { ...premadeCreateBody(), name }, 'free');
    expect(res.status).toBe(201);
    const id = await created(res);
    const row = await rowsNamed(name);
    expect(row).toHaveLength(1);
    expect(row[0].origin).toBe('starter');
    expect(row[0].id).toBe(id);
  });

  it('refuses a Free player a custom hero: 403 LEGEND_REQUIRED, no row written', async () => {
    const name = testId('Custom Free');
    const { starter_template_id: _omit, ...custom } = premadeCreateBody();
    const res = await post('/v1/characters', { ...custom, name }, 'free');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'LEGEND_REQUIRED' });
    expect(await rowsNamed(name)).toHaveLength(0);
  });

  it('creates a custom hero for a Legend player: 201, stored as custom, owned by the caller', async () => {
    const name = testId('Custom Legend');
    const { starter_template_id: _omit, ...custom } = premadeCreateBody();
    const res = await post('/v1/characters', { ...custom, name }, 'legend');
    expect(res.status).toBe(201);
    await created(res);
    const row = await rowsNamed(name);
    expect(row).toHaveLength(1);
    expect(row[0].origin).toBe('custom');
    expect(row[0].user_id).toBe(legendUserId);
  });

  it('refuses a Free player an import: 403 LEGEND_REQUIRED, no row written', async () => {
    const name = testId('Import Free');
    const { starter_template_id: _omit, ...custom } = premadeCreateBody();
    const res = await post(
      '/v1/characters/import',
      {
        format: 'infinite-realms.character',
        version: 1,
        character: { ...custom, name },
      },
      'free',
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'LEGEND_REQUIRED' });
    expect(await rowsNamed(name)).toHaveLength(0);
  });

  it('creates an import for a Legend player: 201, stored as import', async () => {
    const name = testId('Import Legend');
    const { starter_template_id: _omit, ...custom } = premadeCreateBody();
    const res = await post(
      '/v1/characters/import',
      { format: 'infinite-realms.character', version: 1, character: { ...custom, name } },
      'legend',
    );
    expect(res.status).toBe(201);
    await created(res);
    const row = await rowsNamed(name);
    expect(row[0].origin).toBe('import');
  });

  it('refuses a Free player who names a real template but changes the class: 403', async () => {
    const name = testId('Changed Class');
    const res = await post(
      '/v1/characters',
      { ...premadeCreateBody(), name, class: 'Wizard' },
      'free',
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'LEGEND_REQUIRED' });
    expect(await rowsNamed(name)).toHaveLength(0);
  });

  it('refuses a Free player who names a real template but changes the level: 403', async () => {
    const name = testId('Changed Level');
    const res = await post('/v1/characters', { ...premadeCreateBody(), name, level: 4 }, 'free');
    expect(res.status).toBe(403);
    expect(await rowsNamed(name)).toHaveLength(0);
  });

  it('refuses a Free player who names a template id that is not in the catalog: 403', async () => {
    const name = testId('Unknown Template');
    const res = await post(
      '/v1/characters',
      { ...premadeCreateBody('00000000-0000-4000-8000-000000000000'), name },
      'free',
    );
    expect(res.status).toBe(403);
    expect(await rowsNamed(name)).toHaveLength(0);
  });

  it('ignores an origin the body sends: a Free import with origin starter is still refused', async () => {
    const name = testId('Forged Origin');
    const { starter_template_id: _omit, ...custom } = premadeCreateBody();
    const res = await post(
      '/v1/characters/import',
      {
        format: 'infinite-realms.character',
        version: 1,
        origin: 'starter',
        character: { ...custom, name, origin: 'starter' },
      },
      'free',
    );
    expect(res.status).toBe(403);
    expect(await rowsNamed(name)).toHaveLength(0);
  });
  it('answers 503 PLAN_UNAVAILABLE for a custom create when the plan lookup fails', async () => {
    const { starter_template_id: _omit, ...custom } = premadeCreateBody();
    const res = await post('/v1/characters', { ...custom, name: testId('Lookup Fails') }, 'broken');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'PLAN_UNAVAILABLE' });
  });

  it('answers 503 PLAN_UNAVAILABLE for an import when the plan lookup fails', async () => {
    const { starter_template_id: _omit, ...custom } = premadeCreateBody();
    const res = await post(
      '/v1/characters/import',
      { format: 'infinite-realms.character', version: 1, character: custom },
      'broken',
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'PLAN_UNAVAILABLE' });
  });
});
