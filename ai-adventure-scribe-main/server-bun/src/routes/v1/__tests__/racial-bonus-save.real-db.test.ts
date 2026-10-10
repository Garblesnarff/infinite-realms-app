/**
 * #203: the server stores the final ability scores the client sends at creation, and a reload
 * returns them unchanged. Racial bonuses are applied once on the client (see
 * applyRacialBonusesToAbilityScores); the server must not drop or re-add them.
 *
 * Real database, real character routes. Auth is stubbed. CharacterService is not.
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';

import { characterStats, characters } from '../../../../../db/schema/index';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../services/__tests__/fixtures/real-db.js';

const stub = () => ({
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
  child: () => stub(),
});

let userId = '';

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer test-token'
      ? { user: { userId, email: 'user@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
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

const pipeline = await importWithRealDb(async () => {
  const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
  const { charactersRoutes } = await import('../characters.js');
  return createRequestPipelineApp().use(charactersRoutes);
});

if (!hasRealDb) {
  console.warn('[racial-bonus-save] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run.');
}

const authHeaders = {
  authorization: 'Bearer test-token',
  'content-type': 'application/json',
};

/**
 * The body the client sends for a Hill Dwarf Fighter after applyRacialBonusesToAbilityScores.
 * Base standard array 15/14/13/12/10/8; Dwarf +2 CON, Hill Dwarf +1 WIS.
 */
const hillDwarfCreateBody = (name: string) => ({
  name,
  race: 'Dwarf',
  subrace: 'Hill Dwarf',
  class: 'Fighter',
  level: 1,
  stats: {
    strength: 15,
    dexterity: 14,
    constitution: 15,
    intelligence: 12,
    wisdom: 11,
    charisma: 8,
    armor_class: 12,
    current_hit_points: 12,
    max_hit_points: 12,
  },
});

describeWithDb('racial ability bonuses survive create and reload (#203)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const createdIds: string[] = [];

  beforeAll(() => {
    if (!hasRealDb) return;
    userId = testId('racial-bonus-user');
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    for (const id of createdIds) {
      try {
        await db.delete(characterStats).where(eq(characterStats.characterId, id));
        await db.delete(characters).where(eq(characters.id, id));
      } catch {
        /* fixture teardown is best-effort */
      }
    }
    await closeRealDb();
  });

  it('stores final scores and AC/HP on create, and returns them unchanged on reload', async () => {
    const created = await pipeline.handle(
      new Request('http://localhost/v1/characters', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(hillDwarfCreateBody(testId('hill-dwarf'))),
      }),
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { id: string };
    createdIds.push(createdBody.id);

    const reloaded = await pipeline.handle(
      new Request(`http://localhost/v1/characters/${createdBody.id}`, {
        method: 'GET',
        headers: authHeaders,
      }),
    );
    expect(reloaded.status).toBe(200);
    const body = (await reloaded.json()) as { stats: Record<string, number> };

    expect(body.stats.strength).toBe(15);
    expect(body.stats.constitution).toBe(15);
    expect(body.stats.wisdom).toBe(11);
    expect(body.stats.charisma).toBe(8);
    expect(body.stats.armorClass ?? body.stats.armor_class).toBe(12);
    expect(body.stats.maxHitPoints ?? body.stats.max_hit_points).toBe(12);
  });
});
