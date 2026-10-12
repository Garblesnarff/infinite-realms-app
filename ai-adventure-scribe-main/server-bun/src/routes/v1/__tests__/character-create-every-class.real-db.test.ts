/* eslint-disable max-lines */
/**
 * #388: Complete Character must not 500 for any class.
 *
 * Posts the wizard's real wire body (built with the same client transforms the
 * wizard uses) through the real POST /v1/characters route, one case per SRD
 * class at level 1. Auth is stubbed. CharacterService is not.
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

const pipeline = await importWithRealDb(async () => {
  const { createRequestPipelineApp } = await import('../../../http-pipeline.ts');
  const { charactersRoutes } = await import('../characters.ts');
  return createRequestPipelineApp().use(charactersRoutes);
});

// The wizard's client transforms, imported from the client source so the wire
// body follows the real producer (AGENTS.md: test objects must have the shape
// production really sends).
const client = await importWithRealDb(async () => {
  const { transformCharacterForStorage } = await import(
    '../../../../../src/types/character.ts'
  );
  const {
    transformAbilityScoresForStorage,
    transformEquipmentForStorage,
    transformMulticlassingForStorage,
  } = await import('../../../../../src/utils/characterTransformations.ts');
  const { applyRacialBonusesToAbilityScores } = await import(
    '../../../../../src/utils/racialAbilityBonuses.ts'
  );
  const { prepareCharacterPayload } = await import(
    '../../../../../src/services/user-data-payload-helpers.ts'
  );
  const { dwarf } = await import('../../../../../src/data/races/dwarf.ts');
  const { getStartingEquipment } = await import('../../../../../src/data/equipment/api.ts');
  return {
    transformCharacterForStorage,
    transformAbilityScoresForStorage,
    transformEquipmentForStorage,
    transformMulticlassingForStorage,
    applyRacialBonusesToAbilityScores,
    prepareCharacterPayload,
    dwarf,
    getStartingEquipment,
  };
});

const authHeaders = {
  authorization: 'Bearer <redacted>',
  'content-type': 'application/json',
};

/** The twelve 2014 SRD classes. */
const CLASSES = [
  'Barbarian',
  'Bard',
  'Cleric',
  'Druid',
  'Fighter',
  'Monk',
  'Paladin',
  'Ranger',
  'Rogue',
  'Sorcerer',
  'Warlock',
  'Wizard',
];

const baseScores = {
  strength: { score: 15, modifier: 2 },
  dexterity: { score: 13, modifier: 1 },
  constitution: { score: 14, modifier: 2 },
  intelligence: { score: 10, modifier: 0 },
  wisdom: { score: 12, modifier: 1 },
  charisma: { score: 8, modifier: -1 },
};

describeWithDb('character creation does not 500 for any class at L1 (#388)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const createdIds: string[] = [];

  beforeAll(() => {
    userId = testId('388-owner');
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

  const request = (path: string, method: string, body?: unknown): Promise<Response> =>
    (pipeline as { handle: (r: Request) => Promise<Response> }).handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: authHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );

  /** Build the exact wire body the wizard's save path produces. */
  const wizardBody = (className: string) => {
    const c = client as any;
    const hillDwarf = c.dwarf.subraces.find((s: any) => s.id === 'hill-dwarf');
    const equipmentNames: string[] = c
      .getStartingEquipment(className)
      .map((eq: any) => eq.name);

    const character: any = {
      name: `L1 ${className} 388`,
      race: c.dwarf,
      subrace: hillDwarf,
      class: { name: className },
      level: 1,
      background: { name: 'Soldier' },
      alignment: 'Lawful Good',
      abilityScores: baseScores,
      equipment: equipmentNames,
      fightingStyles: className === 'Fighter' ? ['defense'] : [],
      classFeatures: {},
      skillProficiencies: ['Athletics'],
      languages: ['Common', 'Dwarvish'],
      cantrips: [],
      knownSpells: [],
    };

    const characterData = {
      ...c.transformCharacterForStorage({ ...character, campaign_id: null, user_id: userId }),
      ...c.transformMulticlassingForStorage(character),
    };
    const finalAbilityScores = c.applyRacialBonusesToAbilityScores(
      character.abilityScores,
      character.race,
      character.subrace,
      undefined,
    );
    const raceTraits = [
      ...(character.race?.traits || []),
      ...(character.subrace?.traits || []),
    ];
    const statsData = c.transformAbilityScoresForStorage(
      finalAbilityScores,
      '00000000-0000-0000-0000-000000000000',
      character.class?.name,
      raceTraits,
    );
    const effectiveInventory = (character.equipment || []).map((name: string) => ({
      itemId: name,
      itemType: 'equipment',
      quantity: 1,
      equipped: false,
    }));
    const equipmentData =
      effectiveInventory.length > 0
        ? c.transformEquipmentForStorage(
            { ...character, inventory: effectiveInventory },
            '00000000-0000-0000-0000-000000000000',
          )
        : null;

    return c.prepareCharacterPayload({
      ...characterData,
      stats: {
        strength: statsData.strength,
        dexterity: statsData.dexterity,
        constitution: statsData.constitution,
        intelligence: statsData.intelligence,
        wisdom: statsData.wisdom,
        charisma: statsData.charisma,
        armor_class: statsData.armor_class,
        current_hit_points: statsData.current_hit_points,
        max_hit_points: statsData.max_hit_points,
      },
      equipment: equipmentData || undefined,
    });
  };

  for (const className of CLASSES) {
    it(`creates a Hill Dwarf ${className} at L1`, async () => {
      const res = await request('/v1/characters', 'POST', wizardBody(className));
      const text = await res.text();
      expect(`${res.status}: ${text.slice(0, 300)}`).toBe(`${201}: ${text.slice(0, 300)}`);
      const { id } = JSON.parse(text) as { id: string };
      createdIds.push(id);

      // The row and its stats row exist.
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
