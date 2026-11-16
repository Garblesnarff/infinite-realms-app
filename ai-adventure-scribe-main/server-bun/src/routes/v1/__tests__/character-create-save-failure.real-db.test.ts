/**
 * #466: a failed Complete Character save must not leave the server stuck.
 *
 * Forces the create to fail after its transaction has committed (the
 * class-feature grant throws once), then posts through the real
 * POST /v1/characters route. Asserts, per class:
 *   - the failed create answers 500 and leaves no character row behind;
 *   - the very next reads and writes answer promptly (a leaked connection or
 *     lock would stall them until the timeout below);
 *   - a retry of the same body then answers 201.
 *
 * Auth is stubbed. CharacterService and the database are real.
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, expect, it, mock, spyOn } from 'bun:test';
import { and, eq, like } from 'drizzle-orm';

import { characters } from '../../../../../db/schema/index';
import {
  closeRealDb,
  describeWithDb,
  grantLegendPlan,
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
  child: mock(() => stub()),
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

/** Starting kits as the wizard's equipment step sends them (see character-create-every-class). */
const KITS: Record<string, string[]> = {
  Barbarian: ['Leather Armor', 'Shield', 'Handaxe', 'Handaxe'],
  Rogue: ['Leather Armor', 'Dagger', 'Dagger', "Thieves' Tools", 'Shortbow'],
  Sorcerer: ['Dagger', 'Dagger', 'Crossbow, light'],
};
const PREPARED: Record<string, string> = { Sorcerer: 'Magic Missile' };
const HIT_DIE: Record<string, string> = { Barbarian: '1d12', Rogue: '1d8', Sorcerer: '1d6' };
const CLASSES = ['Barbarian', 'Rogue', 'Sorcerer'] as const;

const equipmentRow = (itemName: string) => ({
  item_name: itemName,
  item_type: 'equipment',
  quantity: 1,
  equipped: false,
  is_magic: false,
  magic_bonus: 0,
  magic_properties: null,
  requires_attunement: false,
  is_attuned: false,
  attunement_requirements: null,
  magic_item_type: null,
  magic_item_rarity: 'common',
  magic_effects: null,
});

/** Wire body shaped like the wizard's prepareCharacterPayload output (Hill Dwarf, L1). */
const wizardBody = (className: (typeof CLASSES)[number], name: string) => ({
  name,
  race: 'Dwarf',
  subrace: 'Hill Dwarf',
  class: className,
  level: 1,
  background: 'Soldier',
  alignment: 'Lawful Good',
  stats: {
    strength: 15,
    dexterity: 14,
    constitution: 16,
    intelligence: 12,
    wisdom: 11,
    charisma: 8,
    temporary_hit_points: 0,
    hit_dice: HIT_DIE[className],
  },
  skill_proficiencies: 'Athletics',
  languages: ['Common', 'Dwarvish'],
  fighting_styles: [],
  class_features: {},
  class_levels: [{ classId: className.toLowerCase(), className, level: 1 }],
  total_level: 1,
  cantrips: '',
  known_spells: '',
  prepared_spells: PREPARED[className] ?? '',
  gold_pieces: 15,
  equipment: KITS[className].map(equipmentRow),
  inventory_items: [{ name: 'Backpack', item_type: 'equipment', quantity: 1 }],
});

/** A route call must settle within this bound, or the server is treated as hung. */
const PROMPT_MS = 5000;

describeWithDb('character create save failure leaves the server responsive (#466)', () => {
  let app: any;
  let db: any;
  let grantSpy: {
    mockImplementationOnce: (fn: () => Promise<never>) => unknown;
    mockRestore: () => void;
  };
  let request: (path: string, method: string, body?: unknown) => Promise<Response>;
  const createdIds: string[] = [];

  beforeAll(async () => {
    userId = testId('user-466');
    await grantLegendPlan(userId);
    db = realDb();
    const pipeline = await importWithRealDb(async () => {
      const { createRequestPipelineApp } = await import('../../../http-pipeline.ts');
      const { charactersRoutes } = await import('../characters.ts');
      const { ClassFeaturesService } = await import('../../../services/class-features-service.ts');
      return { createRequestPipelineApp, charactersRoutes, ClassFeaturesService };
    });
    app = pipeline.createRequestPipelineApp().use(pipeline.charactersRoutes);
    grantSpy = spyOn(pipeline.ClassFeaturesService, 'grantFeaturesForLevel') as any;
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
    grantSpy?.mockRestore();
    if (createdIds.length > 0) {
      for (const id of createdIds) {
        await db
          .delete(characters)
          .where(eq(characters.id, id))
          .catch(() => {});
      }
    }
    await closeRealDb();
  });

  /** Resolves with the response, or rejects if it has not settled within PROMPT_MS. */
  const settledWithin = <T>(label: string, promise: Promise<T>): Promise<T> =>
    Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`${label} did not settle within ${PROMPT_MS} ms`)),
          PROMPT_MS,
        ),
      ),
    ]);

  for (const className of CLASSES) {
    it(`a ${className} create that fails after commit answers 500, leaves no row, and the server stays responsive`, async () => {
      const name = `L1 ${className} 466`;
      grantSpy.mockImplementationOnce(() =>
        Promise.reject(new Error('forced grant failure (#466)')),
      );

      const failed = await settledWithin(
        `failed ${className} create`,
        request('/v1/characters', 'POST', wizardBody(className, name)),
      );
      expect(failed.status).toBe(500);

      const orphans = await db
        .select({ id: characters.id })
        .from(characters)
        .where(and(eq(characters.userId, userId), like(characters.name, `${name}%`)));
      expect(orphans).toHaveLength(0);

      const list = await settledWithin(
        `GET /v1/characters after failed ${className} create`,
        request('/v1/characters', 'GET'),
      );
      expect(list.status).toBe(200);

      const retry = await settledWithin(
        `retry ${className} create`,
        request('/v1/characters', 'POST', wizardBody(className, `${name} retry`)),
      );
      expect(retry.status, await retry.clone().text()).toBe(201);
      const { id } = (await retry.json()) as { id: string };
      createdIds.push(id);
    });
  }
});
