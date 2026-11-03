import { describe, expect, it, mock } from 'bun:test';

/**
 * #1233 (AGENTS §4 wire rule): the exact bodies the client's variable-cost picker posts
 * (shared/test-fixtures/feature-use-bodies.ts) go through the real use route schema. The
 * service is stubbed so no database is needed; the real-DB suite covers the spend itself.
 */

const quiet = () => {};
const user = { userId: 'u1', email: 'a@b.c', plan: 'free' };
mock.module('../../../lib/logger.js', () => ({
  logger: { debug: quiet, info: quiet, warn: quiet, error: quiet },
}));
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({ user, error: null }),
}));
mock.module('../../../../../db/client', () => ({ db: {} }));

// The route's ownership guard reads the character; the owner is the test user.
mock.module('../../../services/character-service.js', () => ({
  CharacterService: { getById: async () => ({ id: 'c1' }) },
}));

// The route verifies a session id when the body carries one (in-session Smite).
mock.module('../combat/helpers.js', () => ({
  verifySessionOwnership: async () => ({ success: true }),
}));

let nextResult: unknown = null;
const received: unknown[] = [];
mock.module('../../../services/class-features-service.js', () => ({
  ClassFeaturesService: {
    useFeature: async (input: unknown) => {
      received.push(input);
      return nextResult ?? { success: true, usesRemaining: 1, effect: '', message: 'spent' };
    },
  },
}));

const { classFeaturesRoutes } = await import('../class-features.js');
const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const {
  divineSmiteInSessionUseBody,
  divineSmiteUseBody,
  flexibleCastingConvertUseBody,
  flexibleCastingCreateUseBody,
  quickenedMetamagicUseBody,
} = await import('../../../../../shared/test-fixtures/feature-use-bodies');

const app = createRequestPipelineApp().use(classFeaturesRoutes);
const headers = { authorization: 'Bearer ok', 'content-type': 'application/json' };
const path =
  '/v1/class-features/characters/11111111-1111-4111-8111-111111111111/features/22222222-2222-4222-8222-222222222222/use';

const post = (body: unknown) =>
  app.handle(
    new Request(`http://localhost${path}`, { method: 'POST', headers, body: JSON.stringify(body) }),
  );

describe('class-feature use route accepts the picker wire bodies (#1233)', () => {
  it.each([
    ['Divine Smite slot level', divineSmiteUseBody, { slotLevel: 1 }],
    [
      'Divine Smite slot level in a session',
      divineSmiteInSessionUseBody,
      { slotLevel: 1, sessionId: 'session-1' },
    ],
    ['Metamagic option', quickenedMetamagicUseBody, { option: 'quickened' }],
    ['Flexible Casting convert', flexibleCastingConvertUseBody, { option: '1' }],
    ['Flexible Casting create', flexibleCastingCreateUseBody, { option: '2' }],
  ])('passes the %s body through to the service', async (_label, wireBody, expected) => {
    received.length = 0;
    const response = await post(wireBody);
    expect(response.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject(expected);
  });

  it('refuses a Divine Smite slot level outside 1-9 at the schema', async () => {
    received.length = 0;
    const response = await post({ slotLevel: 0 });
    expect(response.status).toBe(422);
    expect(received).toHaveLength(0);
  });

  it('answers a refusal with 400 and the refusal message', async () => {
    received.length = 0;
    nextResult = {
      success: false,
      usesRemaining: 0,
      effect: '',
      message: 'Paladin has no level 1 spell slot left.',
    };
    const response = await post(divineSmiteUseBody);
    nextResult = null;
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      message: 'Paladin has no level 1 spell slot left.',
    });
  });
});
