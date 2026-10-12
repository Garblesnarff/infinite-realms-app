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

const CLASSES: Array<{ name: string; hitDie: string; baseHp: number }> = [
  // baseHp = hit die max + CON mod (+2 for CON 15) + Dwarven Toughness (+1).
  // Base CON 14 -> 16 after Hill Dwarf +2 = +3 mod. Using base 14 per strategist.
  { name: 'Barbarian', hitDie: '1d12', baseHp: 12 + 3 + 1 },
  { name: 'Bard', hitDie: '1d8', baseHp: 8 + 3 + 1 },
  { name: 'Cleric', hitDie: '1d8', baseHp: 8 + 3 + 1 },
  { name: 'Druid', hitDie: '1d8', baseHp: 8 + 3 + 1 },
  { name: 'Fighter', hitDie: '1d10', baseHp: 10 + 3 + 1 }, // = 14 per #388 RG-006
  { name: 'Monk', hitDie: '1d8', baseHp: 8 + 3 + 1 },
  { name: 'Paladin', hitDie: '1d10', baseHp: 10 + 3 + 1 },
  { name: 'Ranger', hitDie: '1d10', baseHp: 10 + 3 + 1 },
  { name: 'Rogue', hitDie: '1d8', baseHp: 8 + 3 + 1 },
  { name: 'Sorcerer', hitDie: '1d6', baseHp: 6 + 3 + 1 },
  { name: 'Warlock', hitDie: '1d8', baseHp: 8 + 3 + 1 },
  { name: 'Wizard', hitDie: '1d6', baseHp: 6 + 3 + 1 },
];

/**
 * Wire body following the wizard's prepareCharacterPayload output.
 * Hill Dwarf (+2 CON, +1 WIS; Dwarven Toughness +1 HP/level via raceTraits).
 * Base scores: STR 15, DEX 14, CON 14, INT 12, WIS 10, CHA 8.
 * After racials: STR 15, DEX 14, CON 16 (+3), INT 12, WIS 11 (+1), CHA 8.
 */
const wizardBody = (cls: { name: string; hitDie: string; baseHp: number }) => ({
  name: `L1 ${cls.name} 388`,
  race: 'Dwarf',
  subrace: 'Hill Dwarf',
  class: cls.name,
  level: 1,
  background: 'Soldier',
  alignment: 'Lawful Good',
  // Stats block as the wizard sends it (nested under `stats`).
  stats: {
    strength: 15,
    dexterity: 14,
    constitution: 16,
    intelligence: 12,
    wisdom: 11,
    charisma: 8,
    armor_class: 10,
    max_hit_points: cls.baseHp,
    current_hit_points: cls.baseHp,
    temporary_hit_points: 0,
    hit_dice: cls.hitDie,
  },
  skill_proficiencies: JSON.stringify(['Athletics']),
  languages: ['Common', 'Dwarvish'],
  fighting_styles: cls.name === 'Fighter' ? ['defense'] : [],
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

  for (const cls of CLASSES) {
    it(`creates a Hill Dwarf ${cls.name} at L1`, async () => {
      const res = await request('/v1/characters', 'POST', wizardBody(cls));
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
      // 2014 rules: Hill Dwarf +2 CON +1 WIS; HP = hit die + CON mod (+3) + Toughness (+1).
      expect(stats.maxHitPoints).toBe(cls.baseHp);
    });
  }
});
