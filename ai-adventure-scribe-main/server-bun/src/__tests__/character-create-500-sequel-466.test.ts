/**
 * #466: after POST /v1/characters 500s, subsequent API traffic must not hang.
 *
 * Hark's night run saw two 500s on Complete Character (the #388 UNIQUE-violation
 * shape), then navigation and even a fresh tab to /app/characters stalling for
 * 10-30 s while plain HTTP stayed fast. This test replays that sequence against
 * the real Elysia app: two 500s on the create route, then a list-characters
 * request. Every request must settle promptly — a request that never settles
 * is the hang, failed via the timeout race.
 *
 * No real DB: CharacterService is stubbed to throw the #388 duplicate-kit-item
 * UNIQUE violation, and the list path is stubbed to return []. What is real is
 * the whole request pipeline (http-pipeline onError, requireAuth, the route
 * handlers), which is exactly the code the "leaked handler / never-settling
 * 500 path" hypothesis blames.
 */
import { describe, expect, it, mock } from 'bun:test';

// db/client throws at module load without DATABASE_URL; the isolated suite
// sets none of these, and no query ever runs here.
process.env.DATABASE_URL ??= 'postgres://u466:u466@127.0.0.1:1/db_466';
process.env.WORKOS_API_KEY ??= 'test-dummy-key';
process.env.WORKOS_CLIENT_ID ??= 'test-dummy-client-id';
process.env.PORT ??= '3101';
process.env.CORS_ORIGIN ??= 'http://localhost:3101';
process.env.SUPABASE_URL ??= 'http://127.0.0.1:1';
process.env.SUPABASE_ANON_KEY ??= 'test-dummy-anon';
process.env.RESEND_API_KEY ??= 'test-dummy-resend';

mock.module('../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'user-466', email: 'user466@example.test', plan: 'free' },
    error: null,
  }),
  resolveUserPlan: async () => 'free',
}));

// The #388 failure, as the route's catch saw it: the Fighter kit's two
// handaxes violating UNIQUE(character_id, item_name) inside the create
// transaction. #407 merged duplicates before insert; this stub replays the
// pre-fix 500 the Hark run hit.
const uniqueViolation = Object.assign(
  new Error(
    'duplicate key value violates unique constraint "character_equipment_character_id_item_name_key"',
  ),
  { code: '23505' },
);

mock.module('../services/character-service.js', () => ({
  CharacterService: {
    create: async (): Promise<never> => {
      throw uniqueViolation;
    },
    listForUser: async () => [],
    getById: async () => null,
    update: async () => null,
    delete: async () => undefined,
    upsertStats: async () => undefined,
  },
}));

mock.module('../services/spell-slots/spell-slot-data-access.js', () => ({
  SpellSlotDataAccess: {
    getCharacterSpellSlots: async () => ({ slots: [] }),
  },
}));

type TestApp = { handle: (req: Request) => Promise<Response> };
const { createApp } = (await import('../app.js')) as unknown as {
  createApp: () => TestApp;
};

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: no response within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

const postCharacter = (app: TestApp): Promise<Response> =>
  withTimeout(
    app.handle(
      new Request('http://localhost/v1/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
        body: JSON.stringify({ name: 'Hang Repro Barbarian' }),
      }),
    ),
    10_000,
    'POST /v1/characters',
  );

describe('#466 tab hang after the Complete Character 500', () => {
  const app = createApp();

  it('two 500s on create, then the list route still answers promptly', async () => {
    const first = await postCharacter(app);
    expect(first.status).toBe(500);

    const second = await postCharacter(app);
    expect(second.status).toBe(500);

    // The wizard navigates to /app/characters after save; the roster is this call.
    const list = await withTimeout(
      app.handle(
        new Request('http://localhost/v1/characters', {
          headers: { Authorization: 'Bearer test-token' },
        }),
      ),
      10_000,
      'GET /v1/characters after the 500s',
    );
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([]);
  });

  it('a 500 on create does not wedge a later create either', async () => {
    const first = await postCharacter(app);
    expect(first.status).toBe(500);
    const retry = await postCharacter(app);
    expect(retry.status).toBe(500);
  });
});
