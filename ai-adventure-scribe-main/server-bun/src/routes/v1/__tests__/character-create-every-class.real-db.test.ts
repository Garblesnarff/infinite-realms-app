/* eslint-disable max-lines */
/**
 * #388: Complete Character must not 500 for any class.
 *
 * Posts wire bodies through the real POST /v1/characters route, one case per
 * SRD class at level 1 (Hill Dwarf). Auth is stubbed. CharacterService is not.
 *
 * Fixture fidelity: the Fighter case posts the pinned client payload —
 * shared/test-fixtures/hill-dwarf-fighter-create-payload.json, produced by
 * src/hooks/__tests__/wizard-save-388-payload.test.ts through the real wizard
 * producer chain (transformCharacterForStorage, applyRacialBonusesToAbilityScores,
 * transformAbilityScoresForStorage, mapWizardEquipmentToInventory,
 * transformEquipmentForStorage, prepareCharacterPayload). The 12-class loop
 * bodies follow the same wire shape with each class's real starting kit.
 *
 * Root cause (Hetzner, #388 05:24Z): the Fighter kit lists two handaxes, and
 * the create inserted two character_equipment rows with the same item_name,
 * violating UNIQUE(character_id, item_name) — a 500 on every such create.
 * CharacterService.create now merges duplicate kit items (quantity summed)
 * before insert; the Fighter/Barbarian cases below carry duplicate kit items
 * and assert the merged row.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';

import {
  characters,
  characterEquipment,
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

/**
 * The pinned real wizard payload for a Hill Dwarf Fighter (base CON 14),
 * saved by the client vitest. Read with readFileSync so the server suite
 * never imports client modules.
 */
const fighterPayload = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../../shared/test-fixtures/hill-dwarf-fighter-create-payload.json',
    ),
    'utf8',
  ),
) as Record<string, unknown>;

/**
 * Real starting-kit item names per class, transcribed from
 * getStartingEquipment (src/data/equipment/api.ts) — the same producer the
 * wizard's equipment step reads.
 */
const KITS: Record<string, string[]> = {
  Barbarian: ['Leather Armor', 'Shield', 'Handaxe', 'Handaxe'],
  Bard: ['Leather Armor', 'Dagger', 'Rapier'],
  Cleric: ['Chain Shirt', 'Shield', 'Mace', 'Crossbow, light'],
  Druid: ['Leather Armor', 'Shield', 'Scimitar'],
  Fighter: ['Chain Mail', 'Shield', 'Longsword', 'Handaxe', 'Handaxe', 'Crossbow, light'],
  Monk: ['Dagger'],
  Paladin: ['Chain Mail', 'Shield', 'Longsword'],
  Ranger: ['Leather Armor', 'Dagger', 'Dagger', 'Longbow'],
  Rogue: ['Leather Armor', 'Dagger', 'Dagger', "Thieves' Tools", 'Shortbow'],
  Sorcerer: ['Dagger', 'Dagger', 'Crossbow, light'],
  Warlock: ['Leather Armor', 'Dagger', 'Crossbow, light'],
  Wizard: ['Dagger', 'Quarterstaff'],
};

/** L1 prepared spells the wizard would send (comma-joined names), by class. */
const PREPARED: Record<string, string> = {
  Bard: 'Vicious Mockery',
  Cleric: 'Cure Wounds',
  Druid: 'Entangle',
  Paladin: 'Bless',
  Sorcerer: 'Magic Missile',
  Warlock: 'Hex',
  Wizard: 'Magic Missile',
};

const CLASSES: Array<{ name: string; hitDie: string; baseHp: number }> = [
  // baseHp = hit die max + CON mod (+3 for CON 16) + Dwarven Toughness (+1).
  // Base CON 14 -> 16 after Hill Dwarf +2, per the pinned client fixture.
  { name: 'Barbarian', hitDie: '1d12', baseHp: 12 + 3 + 1 },
  { name: 'Bard', hitDie: '1d8', baseHp: 8 + 3 + 1 },
  { name: 'Cleric', hitDie: '1d8', baseHp: 8 + 3 + 1 },
  { name: 'Druid', hitDie: '1d8', baseHp: 8 + 3 + 1 },
  { name: 'Fighter', hitDie: '1d10', baseHp: 10 + 3 + 1 }, // = 14 per #388
  { name: 'Monk', hitDie: '1d8', baseHp: 8 + 3 + 1 },
  { name: 'Paladin', hitDie: '1d10', baseHp: 10 + 3 + 1 },
  { name: 'Ranger', hitDie: '1d10', baseHp: 10 + 3 + 1 },
  { name: 'Rogue', hitDie: '1d8', baseHp: 8 + 3 + 1 },
  { name: 'Sorcerer', hitDie: '1d6', baseHp: 6 + 3 + 1 },
  { name: 'Warlock', hitDie: '1d8', baseHp: 8 + 3 + 1 },
  { name: 'Wizard', hitDie: '1d6', baseHp: 6 + 3 + 1 },
];

/**
 * One equipment row in the shape transformEquipmentForStorage emits
 * (the wizard's `equipment` body on create).
 */
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

/**
 * Wire body following the wizard's prepareCharacterPayload output for a
 * Hill Dwarf at L1 (base scores STR 15, DEX 14, CON 14, INT 12, WIS 10,
 * CHA 8; racials applied: CON 16, WIS 11): the class's real starting kit,
 * inventory_items, prepared_spells, gold and class_levels.
 */
const wizardBody = (cls: { name: string; hitDie: string; baseHp: number }) => ({
  name: `L1 ${cls.name} 388`,
  race: 'Dwarf',
  subrace: 'Hill Dwarf',
  class: cls.name,
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
    armor_class: 12,
    max_hit_points: cls.baseHp,
    current_hit_points: cls.baseHp,
    temporary_hit_points: 0,
    hit_dice: cls.hitDie,
  },
  skill_proficiencies: 'Athletics',
  languages: ['Common', 'Dwarvish'],
  fighting_styles: cls.name === 'Fighter' ? ['Defense'] : [],
  class_features: {},
  class_levels: [{ classId: cls.name.toLowerCase(), className: cls.name, level: 1 }],
  total_level: 1,
  cantrips: '',
  known_spells: '',
  prepared_spells: PREPARED[cls.name] ?? '',
  gold_pieces: 15,
  equipment: (KITS[cls.name] ?? []).map(equipmentRow),
  inventory_items: [{ name: 'Backpack', item_type: 'gear', quantity: 1 }],
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

  it('posts the real Hill Dwarf Fighter payload: 201, 14 HP, one merged Handaxe row', async () => {
    const res = await request('/v1/characters', 'POST', {
      ...fighterPayload,
      name: `Hill Dwarf Fighter ${testId('388')}`,
    });
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    expect(stats).toBeDefined();
    // Non-circular: the fixture's stats block was computed by the real client
    // transforms from base CON 14 (pinned in the client vitest); the server
    // must persist exactly what the client sent.
    const fixtureStats = fighterPayload.stats as Record<string, unknown>;
    expect(stats.maxHitPoints).toBe(fixtureStats.max_hit_points);
    expect(stats.maxHitPoints).toBe(14);

    // #388 root cause: the two Handaxe kit rows must merge into one row
    // with quantity 2 instead of 500ing on the unique constraint.
    const rows = await db
      .select()
      .from(characterEquipment)
      .where(eq(characterEquipment.characterId, id));
    const handaxes = rows.filter((r: { itemName: string }) => r.itemName === 'Handaxe');
    expect(handaxes).toHaveLength(1);
    expect(handaxes[0].quantity).toBe(2);
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

      // Kits with duplicate items (Fighter, Barbarian handaxes; Rogue, Ranger,
      // Sorcerer daggers) must merge to one row per item_name with summed quantity.
      const rows = await db
        .select()
        .from(characterEquipment)
        .where(eq(characterEquipment.characterId, id));
      const byName = new Map<string, number>();
      for (const r of rows as Array<{ itemName: string; quantity: number }>) {
        byName.set(r.itemName, (byName.get(r.itemName) ?? 0) + 1);
        const kitCount = (KITS[cls.name] ?? []).filter((n) => n === r.itemName).length;
        if (kitCount > 1) expect(r.quantity).toBe(kitCount);
      }
      for (const [, count] of byName) expect(count).toBe(1);
    });
  }
});
