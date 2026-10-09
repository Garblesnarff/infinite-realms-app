/**
 * #224: the sheet's Use Feature and rest bodies, posted through the real
 * character and rest routes. Auth and the services are stubbed. The route
 * schema and the handler arguments are not.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

const CID = '123e4567-e89b-42d3-a456-426614174000';

const secondWindUsed = {
  second_wind: {
    name: 'second_wind',
    currentUses: 0,
    maxUses: 1,
    usesPerRest: 'short',
  },
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

let updateArgs: unknown[] = [];
const shortArgs: unknown[][] = [];
const longArgs: unknown[][] = [];

mock.module('../../../services/character-service.js', () => ({
  CharacterService: {
    getById: async () => ({ id: CID, name: 'QA Dwarven Fighter Alpha' }),
    update: async (...args: unknown[]) => {
      updateArgs = args;
      const data = args[2] as { classFeatures?: unknown };
      return { id: CID, name: 'QA Dwarven Fighter Alpha', classFeatures: data.classFeatures };
    },
    listForUser: async () => [],
    create: async () => ({ id: CID }),
  },
}));

mock.module('../../../services/rest-service.js', () => ({
  RestService: {
    takeShortRest: async (...args: unknown[]) => {
      shortArgs.push(args);
      return {
        characterId: CID,
        restType: 'short',
        hpRestored: 0,
        hitDiceRemaining: [],
        resourcesRestored: [],
        spellSlots: null,
        pactSlots: null,
        classFeatures: {
          second_wind: { ...secondWindUsed.second_wind, currentUses: 1 },
        },
        restEventId: 'rest-1',
      };
    },
    takeLongRest: async (...args: unknown[]) => {
      longArgs.push(args);
      return {
        characterId: CID,
        restType: 'long',
        hpRestored: 5,
        hitDiceRemaining: [],
        resourcesRestored: [],
        spellSlots: null,
        pactSlots: null,
        classFeatures: {
          second_wind: { ...secondWindUsed.second_wind, currentUses: 1 },
        },
        restEventId: 'rest-2',
      };
    },
  },
}));

mock.module('../../../services/campaign-service.js', () => ({
  CampaignService: { getById: async () => null },
}));
mock.module('../../../services/character/character-spell-service.js', () => ({
  CharacterSpellService: {},
}));
mock.module('../../../services/character-vitals-service.js', () => ({
  CharacterVitalsService: {},
}));
mock.module('../../../services/spell-slots/spell-slot-data-access.js', () => ({
  SpellSlotDataAccess: { getCharacterSpellSlots: async () => ({ slots: [] }) },
}));
mock.module('../../../../../db/client', () => ({ db: {} }));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { charactersRoutes } = await import('../characters.js');
const { restRoutes } = await import('../rest.js');

const app = createRequestPipelineApp().use(charactersRoutes).use(restRoutes);

const authHeaders = {
  authorization: 'Bearer test-token',
  'content-type': 'application/json',
};

describe('sheet feature and rest wire (#224)', () => {
  beforeEach(() => {
    updateArgs = [];
    shortArgs.length = 0;
    longArgs.length = 0;
  });

  it('PUT /v1/characters/:id accepts class_features and hands them to the service', async () => {
    const response = await app.handle(
      new Request(`http://localhost/v1/characters/${CID}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ class_features: secondWindUsed }),
      }),
    );

    expect(response.status).toBe(200);
    expect(updateArgs[0]).toBe(CID);
    expect(updateArgs[1]).toBe('user-1');
    expect((updateArgs[2] as { classFeatures: unknown }).classFeatures).toEqual(secondWindUsed);
    const body = (await response.json()) as { class_features?: unknown };
    expect(body.class_features).toEqual(secondWindUsed);
  });

  it('POST short rest accepts { hitDiceToSpend: 0 }', async () => {
    const response = await app.handle(
      new Request(`http://localhost/v1/rest/characters/${CID}/short`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ hitDiceToSpend: 0 }),
      }),
    );

    expect(response.status).toBe(200);
    expect(shortArgs[0]?.[0]).toBe(CID);
    expect(shortArgs[0]?.[1]).toBe('user-1');
    expect(shortArgs[0]?.[2]).toBe(0);
  });

  it('POST long rest accepts an empty body', async () => {
    const response = await app.handle(
      new Request(`http://localhost/v1/rest/characters/${CID}/long`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(200);
    expect(longArgs[0]?.[0]).toBe(CID);
    expect(longArgs[0]?.[1]).toBe('user-1');
  });
});
