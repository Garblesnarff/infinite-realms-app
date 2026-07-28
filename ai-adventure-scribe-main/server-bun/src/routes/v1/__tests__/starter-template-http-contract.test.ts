import { describe, expect, it, mock } from 'bun:test';

const templates = Array.from({ length: 5 }, (_, index) => ({
  id: `template-${index + 1}`,
  starter_campaign_id: 'the-eternal-feast',
  name: `Eternal Feast hero ${index + 1}`,
  description: 'A complete starter character template used by the pre-commitment campaign flow.',
  backstory: `Hero ${index + 1}: ${'A richly detailed starter-character fixture. '.repeat(64)}`,
}));

// postgres.js returns queries as Result instances: Array subclasses with
// non-enumerable query metadata. The subclass shape is what exercises Elysia's
// production response mapper rather than its plain-array fast path.
class MockRowList<T> extends Array<T> {
  constructor(items: T[]) {
    super(...items);
    Object.defineProperties(this, {
      count: { value: items.length, writable: true },
      state: { value: null, writable: true },
      command: { value: 'SELECT', writable: true },
      columns: { value: [], writable: true },
      statement: { value: null, writable: true },
    });
  }

  static get [Symbol.species]() {
    return Array;
  }
}

const templateRows = new MockRowList(templates);

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

mock.module('../../../lib/db.js', () => ({ sql: async () => templateRows }));
mock.module('../../../lib/env.js', () => ({ env: { WORKOS_CLIENT_ID: 'test-client' } }));
mock.module('../../../lib/logger.js', () => ({ logger: noopLogger }));
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const token = request.headers.get('authorization');
    if (token === 'Bearer valid-token') {
      return {
        user: { userId: 'member-1', email: 'member@example.test', plan: 'free' },
        error: null,
      };
    }
    return { user: null, error: 'Unauthorized' };
  },
}));
mock.module('../../../../../db/client', () => ({ db: {} }));
mock.module('../../../services/campaign-service.js', () => ({ CampaignService: {} }));
mock.module('../../../services/character-service.js', () => ({ CharacterService: {} }));
mock.module('../../../services/class-features-service.js', () => ({ ClassFeaturesService: {} }));
mock.module('../../../services/progression-service.js', () => ({ ProgressionService: {} }));
mock.module('../../../services/spell-slots-service.js', () => ({ SpellSlotsService: {} }));
mock.module(import.meta.resolve('../combat/helpers.js'), () => ({
  verifySessionOwnership: async () => ({ success: true }),
  verifyEncounterOwnership: async () => ({ success: true }),
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { securedGameDataRoutes } = await import('../secured-game-data.js');
const { classFeaturesRoutes } = await import('../class-features.js');
const { progressionRoutes } = await import('../progression.js');
const { spellSlotsUtilityRoutes } = await import('../spell-slots.js');

const endpoint = 'http://localhost/v1/starter-character-templates?campaign_id=the-eternal-feast';
const app = createRequestPipelineApp().use(securedGameDataRoutes);

describe('starter template HTTP contract', () => {
  for (const testCase of [
    { name: 'without Authorization', authorization: undefined },
    { name: 'with a valid token', authorization: 'Bearer valid-token' },
    { name: 'with an expired token', authorization: 'Bearer expired-token' },
  ]) {
    it(`returns the complete public template collection ${testCase.name}`, async () => {
      const request = new Request(endpoint, {
        headers: testCase.authorization ? { authorization: testCase.authorization } : undefined,
      });
      const response = await app.handle(request);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(body.length).toBeGreaterThan(10_000);
      const payload = JSON.parse(body);
      expect(Array.isArray(payload)).toBe(true);
      expect(payload).toHaveLength(5);
      expect(payload).toEqual(templates);
    });
  }

  it('serializes a postgres.js RowList-shaped result through the Elysia HTTP pipeline', async () => {
    expect(templateRows).toBeInstanceOf(Array);
    expect(templateRows.constructor).not.toBe(Array);

    const response = await app.handle(new Request(endpoint));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(body.length).toBeGreaterThan(10_000);
    expect(JSON.parse(body)).toEqual(templates);
  });

  it('normalizes quest progress query results before returning them', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/characters/character-1/quest-progress', {
        headers: { authorization: 'Bearer valid-token' },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual(templates);
  });
});

const collateralRoutes = [
  {
    name: 'class feature library',
    app: classFeaturesRoutes,
    request: new Request('http://localhost/v1/class-features'),
  },
  {
    name: 'class subclass library',
    app: classFeaturesRoutes,
    request: new Request('http://localhost/v1/class-features/subclasses/Wizard'),
  },
  {
    name: 'class feature detail',
    app: classFeaturesRoutes,
    request: new Request('http://localhost/v1/class-features/feature-1'),
  },
  {
    name: 'progression XP table',
    app: progressionRoutes,
    request: new Request('http://localhost/v1/progression/xp-table'),
  },
  {
    name: 'spell-slot calculation',
    app: spellSlotsUtilityRoutes,
    request: new Request('http://localhost/v1/spell-slots/calculate?className=Wizard&level=5'),
  },
  {
    name: 'multiclass spell-slot calculation',
    app: spellSlotsUtilityRoutes,
    request: new Request('http://localhost/v1/spell-slots/calculate-multiclass', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ classes: [{ className: 'Wizard', level: 5 }] }),
    }),
  },
  {
    name: 'spell upcast check',
    app: spellSlotsUtilityRoutes,
    request: new Request(
      'http://localhost/v1/spell-slots/can-upcast?spellName=Fireball&baseLevel=3&targetLevel=4',
    ),
  },
];

describe('auth-scope collateral HTTP contracts', () => {
  for (const route of collateralRoutes) {
    it(`keeps ${route.name} explicitly protected with a real error status`, async () => {
      const response = await route.app.handle(route.request.clone());
      const body = await response.text();
      const payload = JSON.parse(body) as { error?: unknown };

      expect(response.status).toBe(401);
      expect(payload.error).toBe('Unauthorized');
      expect(body.length).toBeGreaterThan(20);
    });
  }
});

describe('HTTP response pipeline invariant', () => {
  it('never pairs an error envelope with 200 or a success envelope with an error status', async () => {
    const samples = [
      {
        app,
        request: new Request(endpoint),
      },
      {
        app,
        request: new Request('http://localhost/v1/quests?campaign_id=campaign-1'),
      },
      {
        app,
        request: new Request('http://localhost/v1/quests', {
          method: 'POST',
          headers: {
            authorization: 'Bearer valid-token',
            'content-type': 'application/json',
          },
          body: '{}',
        }),
      },
      {
        app,
        request: new Request('http://localhost/v1/route-that-does-not-exist'),
      },
      ...collateralRoutes,
    ];

    for (const sample of samples) {
      const response = await sample.app.handle(sample.request.clone());
      const body = await response.text();
      expect(response.headers.get('content-type')).toContain('application/json');
      const payload = JSON.parse(body) as { error?: unknown };
      const isErrorEnvelope = Object.hasOwn(payload, 'error');

      if (isErrorEnvelope) {
        expect(response.status).toBeGreaterThanOrEqual(400);
      } else {
        expect(response.status).toBe(200);
      }
    }
  });
});
