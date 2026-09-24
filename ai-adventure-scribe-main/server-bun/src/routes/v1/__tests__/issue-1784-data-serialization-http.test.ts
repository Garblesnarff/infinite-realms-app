import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

/**
 * #2150: postgres.js resolves queries to a RowList (class `Result extends Array`).
 * Elysia <= 1.4.22 switches on `constructor.name`, has no case for "Result", and
 * falls back to `new Response(value)`: the body became
 * "[object Object][object Object]…" with status 200. Elysia 1.4.23+ has an
 * Array.isArray fallback, so on the pinned version the HTTP body alone cannot
 * catch a regression; the service-level test below asserts a plain Array, which
 * serializes as JSON on every Elysia version.
 */

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

mock.module('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://test.invalid/unused',
    PORT: '3000',
    CORS_ORIGIN: 'http://localhost:3000',
    WORKOS_CLIENT_ID: 'test-client-id',
    NODE_ENV: 'test',
  },
}));

mock.module('../../../lib/logger.js', () => ({ logger: noopLogger }));

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer owner-token'
      ? { user: { userId: 'user-1', email: 'owner@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));

/** Stand-in for postgres.js `Result`: an Array subclass with the same class name. */
class Result<T> extends Array<T> {
  count = 0;
  command = 'SELECT';
}

const rowList = <T>(rows: T[]): Result<T> => {
  const list = new Result<T>();
  list.push(...rows);
  list.count = rows.length;
  return list;
};

const equipmentRows = [
  { id: 'equipment-1', character_id: 'character-1', item_name: 'Longsword', quantity: 1 },
  { id: 'equipment-2', character_id: 'character-1', item_name: 'Rations', quantity: 5 },
];

const mappingRows = [
  { id: 'mapping-1', session_id: 'session-1', character_name: 'Mira', voice_id: 'voice-1' },
];

const sql = (strings: TemplateStringsArray): unknown => {
  const text = strings.join('?');
  if (text.includes('FROM public.characters')) {
    return rowList([{ user_id: 'user-1', owner_id: null }]);
  }
  if (text.includes('FROM public.game_sessions')) {
    return rowList([{ id: 'session-1', owned: true }]);
  }
  if (text.includes('WHERE character_id')) return rowList(equipmentRows);
  if (text.includes('WHERE session_id')) return rowList(mappingRows);
  // Module-load column fragments (selectEquipment etc.) and anything else.
  return rowList([]);
};

mock.module('../../../lib/db.js', () => ({ sql }));

const { issue1784DataRoutes } = await import('../issue-1784-data.js');
const { Issue1784DataService } = await import('../../../services/issue-1784-data-service.js');
const app = new Elysia().use(issue1784DataRoutes);

const get = (path: string): Promise<Response> =>
  app.handle(
    new Request(`http://localhost${path}`, { headers: { authorization: 'Bearer owner-token' } }),
  );

describe('issue #1784 routes serialize postgres RowList results as JSON (#2150)', () => {
  it('GET /v1/characters/:id/equipment returns a JSON array of objects', async () => {
    const response = await get('/v1/characters/character-1/equipment');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(body).not.toContain('[object Object]');
    expect(JSON.parse(body)).toEqual(equipmentRows);
  });

  it('GET /v1/sessions/:id/voice-mappings returns a JSON array of objects', async () => {
    const response = await get('/v1/sessions/session-1/voice-mappings');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(body).not.toContain('[object Object]');
    expect(JSON.parse(body)).toEqual(mappingRows);
  });

  it('service returns plain Arrays, not the postgres RowList subclass', async () => {
    const equipment = await Issue1784DataService.getCharacterEquipment('character-1', 'user-1');
    const mappings = await Issue1784DataService.getSessionMappings('session-1', 'user-1');

    expect(Object.getPrototypeOf(equipment)).toBe(Array.prototype);
    expect(Object.getPrototypeOf(mappings)).toBe(Array.prototype);
    expect(equipment as unknown).toEqual(equipmentRows);
    expect(mappings as unknown).toEqual(mappingRows);
  });
});
