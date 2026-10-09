import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const quiet = () => {};
const user = { userId: 'u1', email: 'a@b.c', plan: 'free' };
mock.module('../../../lib/logger.js', () => ({
  logger: { debug: quiet, info: quiet, warn: quiet, error: quiet },
}));
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({ user, error: null }),
}));
mock.module('../../../../../db/client', () => ({ db: {} }));
const owned = async () => ({ success: true });
mock.module('../combat/helpers.js', () => ({ verifySessionOwnership: owned }));
const { AppError } = await import('../../../lib/errors.js');
const fail = (c: number, m: string, d?: unknown): never => {
  throw new AppError(c, m, undefined, d);
};
for (const [file, key, method, code, message] of [
  ['class-features-service', 'ClassFeaturesService', 'getAvailableSubclasses', 403, 'hidden'],
  ['inventory-service', 'InventoryService', 'getInventory', 500, 'db down'],
  ['progression-service', 'ProgressionService', 'getXPTable', 404, 'missing'],
  ['issue-1784-data-service', 'Issue1784DataService', 'getCharacterEquipment', 500, 'boom'],
] as const) {
  mock.module(`../../../services/${file}.js`, () => ({
    [key]: { [method]: () => fail(code, message) },
  }));
}
process.env.COMPANIONS_ENABLED = 'true';
const { classFeaturesRoutes } = await import('../class-features.js');
const { inventoryRoutes } = await import('../inventory.js');
const { progressionRoutes } = await import('../progression.js');
const { issue1784DataRoutes } = await import('../issue-1784-data.js');
const { requireAuth } = await import('../../../middleware/auth.js');
const { createCompanionRoutes } = await import('../companion-routes.js');
const headers = { authorization: 'Bearer ok', 'content-type': 'application/json' };
const join = () => fail(422, 'nope', { limit: 2 });
const app = new Elysia()
  .use(classFeaturesRoutes)
  .use(inventoryRoutes)
  .use(progressionRoutes)
  .use(issue1784DataRoutes)
  .use(
    createCompanionRoutes({
      auth: requireAuth,
      verifyOwnership: owned,
      service: { join } as never,
      mapCompanion: (row) => row as never,
    }),
  );

describe('route error shapes (#2674 step 6)', () => {
  it('keeps each route status and body for one error', async () => {
    for (const row of [
      ['GET', '/v1/class-features/subclasses/wizard', undefined, 404, 'Not found'],
      ['GET', '/v1/characters/c1/inventory', undefined, 500, 'Failed to fetch inventory'],
      ['GET', '/v1/progression/xp-table', undefined, 404, 'Character not found'],
      ['GET', '/v1/characters/c1/equipment', undefined, 500, 'boom'],
      ['POST', '/v1/sessions/s1/companions', '{"character_id":"c"}', 422, 'nope', { limit: 2 }],
    ] as const) {
      const [method, url, body, status, error, details] = row;
      const res = await app.handle(
        new Request(`http://localhost${url}`, { method, headers, body }),
      );
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual(details ? { error, details } : { error });
    }
  });
});
