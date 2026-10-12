/* eslint-disable max-lines */
/**
 * #388: Complete Character must not 500 for any class.
 *
 * Posts a wire body through the real POST /v1/characters route, one case per
 * SRD class at level 1 (Hill Dwarf). Auth is stubbed. CharacterService is not.
 *
 * Fixture fidelity: the bodies follow the wizard's `prepareCharacterPayload`
 * output shape (src/services/user-data-payload-helpers.ts) — the same fields
 * the Complete Character save path sends, including the ability-score block
 * with racial bonuses applied and the equipment list. The 500 in #388 did not
 * reproduce on current main; this is a regression guard.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';

import {
  characters,
  characterStats,
} from '../../../../../db/schema/index';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../services/__tests__/fixtures/real-db.ts';

const stub = () => ({
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
  child: () => stub(),
});

let userId = '';

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId, email: 'user@example.test', plan: 'free' },
    error: null,
  }),
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

const CLASSES = [
  'Barbarian', 'Bard', 'Cleric', 'Druid', 'Fighter', 'Monk',
  'Paladin', 'Ranger', 'Rogue', 'Sorcerer', 'Warlock', 'Wizard',
];

/**
 * Wire body following the wizard's prepareCharacterPayload output.
 * Hill Dwarf (+2 CON, +1 WIS; Dwarven Toughness +1 HP/level via raceTraits).
 * Base scores: STR 15, DEX 14, CON 13, INT 12, WIS 10, CHA 8.
 * After racials: STR 15, DEX 14, CON 15 (+2), INT 12, WIS 11 (+1), CHA 8.
 */
const wizardBody = (className: string) => ({
  name: `L1 ${className} 388`,
  race: 'Dwarf',
  subrace: 'Hill Dwarf',
  class: className,
  level: 1,
  background: 'Soldier',
  alignment: 'Lawful Good',
  // Stats block as the wizard sends it (nested under `stats`).
  stats: {
    strength: 15,
    dexterity: 14,
    constitution: 15,
    intelligence: 12,
    wisdom: 11,
    charisma: 8,
    armor_class: 10,
    max_hit_points: 13, // d10 + CON (+2) + Dwarven Toughness (+1)
    current_hit_points: 13,
    temporary_hit_points: 0,
    hit_dice: '1d10',
  },
  skill_proficiencies: JSON.stringify(['Athletics']),
  languages: ['Common', 'Dwarvish'],
  fighting_styles: className === 'Fighter' ? ['defense'] : [],
  class_features: {},
  cantrips: JSON.stringify([]),
  known_spells: JSON.stringify([]),
});

describeWithDb('character create every class (#388)', () => {
  let app: any;
  let db: any;
  let request: (path: string, method: string, body?: unknown) => Promise<Response>;
  const createdIds: string[] = [];

  beforeAll(async () => {
    userId = testId('user-388');
    db = realDb();
    const pipeline = await importWithRealDb(async () => {
      const { createRequestPipelineApp } = await import('../../../http-pipeline.ts');
      const { charactersRoutes } = await import('../characters.ts');
      return { createRequestPipelineApp, charactersRoutes };
    });
    app = pipeline.createRequestPipelineApp().use(pipeline.charactersRoutes);
    request = async (path: string, method: string, body?: unknown) =>
      app.handle(
        new Request(`http://localhost${path}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        }),
      );
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      await db.delete(characters).where(eq(characters.id, createdIds[0]));
      // Clean up the rest; ignore errors if already gone.
      for (const id of createdIds.slice(1)) {
        await db.delete(characters).where(eq(characters.id, id)).catch(() => {});
      }
    }
    await closeRealDb();
  });

  for (const className of CLASSES) {
    it(`creates a Hill Dwarf ${className} at L1`, async () => {
      const res = await request('/v1/characters', 'POST', wizardBody(className));
      const text = await res.text();
      expect(res.status, text.slice(0, 300)).toBe(201);
      const { id } = JSON.parse(text) as { id: string };
      createdIds.push(id);

      const [row] = await db.select().from(characters).where(eq(characters.id, id));
      expect(row).toBeDefined();
      const [stats] = await db
        .select()
        .from(characterStats)
        .where(eq(characterStats.characterId, id));
      expect(stats).toBeDefined();
      expect(stats.maxHitPoints).toBeGreaterThan(0);
    });
  }
});
