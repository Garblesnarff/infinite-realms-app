/**
 * #2459: the starter-campaign seeder's exact `spell_slots` wire value, posted
 * through the real `POST /v1/characters` route schema and the real request
 * pipeline.
 *
 * The client test asserts the seeder emits exactly this value; this test
 * asserts the route accepts it and hands it to the service verbatim. Only auth
 * and the services are stubbed. A mocked API does not count: #2250's tests
 * mocked it, and the body they approved 422'd on every narrative roll in
 * production (#2280).
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { premadeWizardSpellSlotsWireValue } from '../../../../../shared/test-fixtures/premade-wizard-spell-slots';

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer test-token'
      ? { user: { userId: 'user-1', email: 'user@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));

mock.module('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    PORT: '8892',
    CORS_ORIGIN: 'http://localhost:8891',
    WORKOS_API_KEY: 'test-key',
    WORKOS_CLIENT_ID: 'test-workos-client',
    NODE_ENV: 'test',
  },
}));

mock.module('../../../lib/logger.js', () => ({
  logger: noopLogger,
  combatLogger: noopLogger,
  spellLogger: noopLogger,
  progressionLogger: noopLogger,
  errorLogSerializers: {},
  default: noopLogger,
}));

let createdArgs: unknown[] = [];
mock.module('../../../services/character-service.js', () => ({
  CharacterService: {
    create: async (...args: unknown[]) => {
      createdArgs = args;
      return { id: 'character-1', ...(args[1] as Record<string, unknown>) };
    },
    getById: async () => null,
  },
}));
mock.module('../../../services/campaign-service.js', () => ({
  CampaignService: {
    getById: async () => ({ id: 'abyssal-descent' }),
  },
}));
mock.module('../../../services/character/character-spell-service.js', () => ({
  CharacterSpellService: {},
}));
mock.module('../../../services/character-vitals-service.js', () => ({
  CharacterVitalsService: {},
}));
// db/client throws at import time when process.env.DATABASE_URL is unset (CI's
// `bun run test` has none); the POST path never touches the real db.
mock.module('../../../../../db/client', () => ({ db: {} }));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { charactersRoutes } = await import('../characters.js');

// The production composition: the request pipeline (with its error handler) and then the routes.
const app = createRequestPipelineApp().use(charactersRoutes);

const post = (body: unknown): Promise<Response> =>
  app.handle(
    new Request('http://localhost/v1/characters', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  );

describe('POST /v1/characters — premade spell_slots wire value (#2459)', () => {
  beforeEach(() => {
    createdArgs = [];
  });

  it('accepts the seeder spell_slots shape and passes it to the service verbatim', async () => {
    const response = await post({
      name: 'The Scholar',
      race: 'Human',
      class: 'Wizard',
      level: 1,
      campaign_id: 'abyssal-descent',
      spell_slots: premadeWizardSpellSlotsWireValue,
    });

    expect(response.status).toBe(201);
    const [, data] = createdArgs as [string, Record<string, unknown>];
    expect(data.spellSlots).toEqual(premadeWizardSpellSlotsWireValue);
    const body = (await response.json()) as { spell_slots?: unknown };
    expect(body.spell_slots).toEqual(premadeWizardSpellSlotsWireValue);
  });
});
