/**
 * #2598: sheet-facing character payloads serve spell slots from the engine's
 * `character_spell_slots` table — the single source of truth — on every read
 * path. The legacy `characters.spell_slots` JSONB is never read: when the
 * character has slot rows, the payload carries the table's remaining counts;
 * when it has none, the payload carries no stored slots (the sheet falls back
 * to class-calculated totals, the same state the engine derives at first cast).
 *
 * These run the real routes through the real request pipeline; only auth, the
 * services, and the slot data access are stubbed. A mocked API does not count
 * (#2280).
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

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
    DATABASE_URL: 'postgres://user:pass@localhost:5432/testdb',
    PORT: '8892',
    CORS_ORIGIN: 'http://localhost:8891',
    WORKOS_API_KEY: 'test-workos-key',
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

// The seeded divergence: the JSONB claims both level-1 slots remain, while the
// engine's table says both are spent. Before the fix, the list read (and the
// single read for a character with no rows) served the JSONB claim.
const seededCharacter = {
  id: 'character-1',
  name: 'Test Wizard',
  class: 'Wizard',
  level: 1,
  userId: 'user-1',
  spellSlots: { '1': { max: 2, current: 2 } },
};

let slotRows: Array<Record<string, unknown>> = [];
mock.module('../../../services/character-service.js', () => ({
  CharacterService: {
    create: async () => seededCharacter,
    getById: async () => seededCharacter,
    listForUser: async () => [seededCharacter],
    update: async () => seededCharacter,
  },
}));
mock.module('../../../services/campaign-service.js', () => ({
  CampaignService: { getById: async () => ({ id: 'abyssal-descent' }) },
}));
mock.module('../../../services/character/character-spell-service.js', () => ({
  CharacterSpellService: {},
}));
mock.module('../../../services/character-vitals-service.js', () => ({
  CharacterVitalsService: {},
}));
mock.module('../../../services/spell-slots/spell-slot-data-access.js', () => ({
  SpellSlotDataAccess: {
    getCharacterSpellSlots: async () => ({
      characterId: 'character-1',
      slots: slotRows,
      totalAvailableSlots: 0,
      totalUsedSlots: 0,
    }),
  },
}));
// db/client throws at import time when process.env.DATABASE_URL is unset (CI's
// `bun run test` has none); these read paths never touch the real db.
mock.module('../../../../../db/client', () => ({ db: {} }));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { charactersRoutes } = await import('../characters.js');

const app = createRequestPipelineApp().use(charactersRoutes);

const get = (path: string): Promise<Response> =>
  app.handle(
    new Request(`http://localhost${path}`, {
      headers: { authorization: 'Bearer test-token' },
    }),
  );

const spentRow = {
  id: 'slot-1',
  characterId: 'character-1',
  spellLevel: 1,
  totalSlots: 2,
  usedSlots: 2,
  remainingSlots: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('GET character payloads — spell_slots come from the engine table (#2598)', () => {
  beforeEach(() => {
    slotRows = [spentRow];
  });

  it('serves the table, not the JSONB, on the single-character read', async () => {
    const response = await get('/v1/characters/character-1');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { spell_slots?: unknown };
    // JSONB claimed current 2; the table says both are spent.
    expect(body.spell_slots).toEqual({ '1': { max: 2, current: 0 } });
  });

  it('serves the table, not the JSONB, on the character list', async () => {
    const response = await get('/v1/characters');
    expect(response.status).toBe(200);
    const body = (await response.json()) as Array<{ spell_slots?: unknown }>;
    expect(body).toHaveLength(1);
    expect(body[0].spell_slots).toEqual({ '1': { max: 2, current: 0 } });
  });
});

describe('GET character payloads — a character with no slot rows (#2598)', () => {
  beforeEach(() => {
    slotRows = [];
  });

  it('reports no stored slots instead of falling back to the JSONB', async () => {
    const single = await get('/v1/characters/character-1');
    expect(single.status).toBe(200);
    expect(((await single.json()) as { spell_slots?: unknown }).spell_slots).toEqual({});

    const list = await get('/v1/characters');
    expect(list.status).toBe(200);
    const body = (await list.json()) as Array<{ spell_slots?: unknown }>;
    expect(body[0].spell_slots).toEqual({});
  });
});
