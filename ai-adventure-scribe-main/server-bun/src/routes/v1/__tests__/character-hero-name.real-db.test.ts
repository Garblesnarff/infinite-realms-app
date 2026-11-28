/**
 * #1741: a premade hero can carry the name its player typed at hero choice. Real database, real
 * character routes and the real session services. Auth is stubbed.
 *
 * - The typed name, the premade's template id and title are saved on the player's copy.
 * - A premade start with a name the shared rule refuses is a 400, and nothing is saved.
 * - The DM context (the session load payload) and the sessions list carry the typed name and
 *   the template id, so a renamed hero resumes.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL (see services/__tests__/fixtures/real-db.ts).
 */
import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import postgres from 'postgres';

import {
  PREMADE_TYPED_HERO_NAME,
  PREMADE_TEMPLATE_ROW,
  premadeCreateBody,
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

const loaded = await importWithRealDb(async () => {
  const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
  const { charactersRoutes } = await import('../characters.js');
  const { SessionService } = await import('../../../services/session-service.js');
  return {
    pipeline: createRequestPipelineApp().use(charactersRoutes),
    SessionService,
  };
});
const { pipeline, SessionService } = loaded;

describeWithDb('a premade hero keeps the name typed at hero choice (#1741)', () => {
  const createdIds: string[] = [];
  const campaignId = `hero-name-1741-${process.pid}`;
  let userCampaignId = '';
  let sessionId = '';

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
    const [campaignRow] = (await sql`
      INSERT INTO campaigns (user_id, name) VALUES (${userId}, ${testId('hero-name-camp')}) RETURNING id
    `) as unknown as Array<{ id: string }>;
    userCampaignId = campaignRow.id;
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    if (sessionId) await sql`DELETE FROM game_sessions WHERE id = ${sessionId}`.catch(() => {});
    for (const id of createdIds) {
      await sql`DELETE FROM characters WHERE id = ${id}`.catch(() => {});
    }
    await sql`DELETE FROM campaigns WHERE id = ${userCampaignId}`.catch(() => {});
    await sql`DELETE FROM starter_character_templates WHERE id = ${HERO_NAME_TEMPLATE_ID}`.catch(
      () => {},
    );
    await sql`DELETE FROM starter_campaigns WHERE id = ${campaignId}`.catch(() => {});
    await sql`DELETE FROM users WHERE id = ${userId}`.catch(() => {});
    await client?.end({ timeout: 5 }).catch(() => {});
  });

  it('saves the typed name with the template id and title, and leaves the template row unchanged', async () => {
    const res = await post(premadeCreateBody(HERO_NAME_TEMPLATE_ID, PREMADE_TYPED_HERO_NAME));
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; name: string };
    createdIds.push(created.id);
    expect(created.name).toBe(PREMADE_TYPED_HERO_NAME);

    const [row] = (await sql`
      SELECT name, origin, starter_template_id, starter_title FROM characters WHERE id = ${created.id}
    `) as unknown as Array<{
      name: string;
      origin: string;
      starter_template_id: string;
      starter_title: string;
    }>;
    expect(row.name).toBe(PREMADE_TYPED_HERO_NAME);
    expect(row.origin).toBe('starter');
    expect(row.starter_template_id).toBe(HERO_NAME_TEMPLATE_ID);
    expect(row.starter_title).toBe(PREMADE_TEMPLATE_ROW.name);

    const [template] = (await sql`
      SELECT name FROM starter_character_templates WHERE id = ${HERO_NAME_TEMPLATE_ID}
    `) as unknown as Array<{ name: string }>;
    expect(template.name).toBe(PREMADE_TEMPLATE_ROW.name);
  });

  it('refuses a typed name the shared rule does not allow, and saves nothing', async () => {
    const refused = ['Mara2', 'R2-D2!', ' Mara', 'Mara ', 'a'.repeat(41)];
    for (const name of refused) {
      const res = await post(premadeCreateBody(HERO_NAME_TEMPLATE_ID, name));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('HERO_NAME_INVALID');
    }
    const saved = (await sql`
      SELECT id FROM characters WHERE user_id = ${userId} AND starter_template_id = ${HERO_NAME_TEMPLATE_ID}
    `) as unknown as Array<{ id: string }>;
    expect(saved.map((row) => row.id).filter((id) => !createdIds.includes(id))).toEqual([]);
  });

  it('accepts a name at the 40-character limit, and the premade title with no typed name', async () => {
    const forty = `${'a'.repeat(39)}b`;
    const res = await post(premadeCreateBody(HERO_NAME_TEMPLATE_ID, forty));
    expect(res.status).toBe(201);
    createdIds.push(((await res.json()) as { id: string }).id);

    const title = await post(premadeCreateBody(HERO_NAME_TEMPLATE_ID, PREMADE_TEMPLATE_ROW.name));
    expect(title.status).toBe(201);
    createdIds.push(((await title.json()) as { id: string }).id);
  });

  it('the DM context and the sessions list carry the typed name, and the template id resumes it', async () => {
    const res = await post(premadeCreateBody(HERO_NAME_TEMPLATE_ID, 'Brenna'));
    expect(res.status).toBe(201);
    const heroId = ((await res.json()) as { id: string }).id;
    createdIds.push(heroId);

    const [sessionRow] = (await sql`
      INSERT INTO game_sessions (campaign_id, character_id, session_number, status, starter_campaign_id)
      VALUES (${userCampaignId}, ${heroId}, 1, 'active', ${campaignId})
      RETURNING id
    `) as unknown as Array<{ id: string }>;
    sessionId = sessionRow.id;

    // The DM context: the session load payload the DM prompt is built from.
    const context = await SessionService.getSessionContext(sessionId, userId);
    expect(context.character.name).toBe('Brenna');

    // The sessions list: the nested character carries the template id, so the picker can
    // find this hero by its premade and resume it under its own name.
    const listed = await SessionService.listSessions({ campaignId: userCampaignId }, userId);
    const row = listed.find((entry) => entry.id === sessionId);
    expect(row).toBeDefined();
    const character = row!.character as { name: string; starter_template_id: string };
    expect(character.name).toBe('Brenna');
    expect(character.starter_template_id).toBe(HERO_NAME_TEMPLATE_ID);
  });
});
