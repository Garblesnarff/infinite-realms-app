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
import { eq, inArray } from 'drizzle-orm';
import { Client } from 'pg';

import {
  campaigns,
  characterFeatures,
  characters,
  characterEquipment,
  characterSpellSlots,
  characterStats,
  characterSubclasses,
  classFeaturesLibrary,
} from '../../../../../db/schema/index';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  realDbUrl,
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
 * The pinned real wizard payload for a Wood Elf Monk who chose Starting
 * Gold and rolled 14 gp (Outlander background, so the equipment rows carry
 * a Staff), produced by src/hooks/__tests__/wizard-save-901-payload.test.ts
 * through the same real producer chain as the Fighter pin.
 */
const monkGoldPayload = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../../shared/test-fixtures/wood-elf-monk-starting-gold-create-payload.json',
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
    // #620: no HP or AC — the server derives both from the inputs above.
    // (temporary_hit_points and hit_dice are inputs, not derived values.)
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
  // item_type must satisfy the inventory_items CHECK
  // ('weapon','armor','consumable','ammunition','equipment','treasure').
  inventory_items: [{ name: 'Backpack', item_type: 'equipment', quantity: 1 }],
});

/**
 * #620: the server is the only place that computes level-1 HP and AC. These
 * cases send inputs only (class, ability scores, equipment) — no HP or AC —
 * and assert the server derives the right values. `wizardBody` already sends
 * no HP/AC; this only swaps in a custom name and equipment list.
 */
const inputsOnlyBody = (
  cls: { name: string; hitDie: string; baseHp: number },
  equipment: string[],
  name: string,
) => {
  const body = wizardBody(cls) as Record<string, unknown>;
  return {
    ...body,
    name,
    equipment: equipment.map(equipmentRow),
  };
};

/**
 * #829: the wizardBody wire shape for a level-3 Human Fighter template with
 * CON 14 — the issue's real-route proving case. Same producer output as
 * wizardBody with level, total_level and the class_levels row at the
 * template's level, and a Human's scores (no subrace toughness).
 */
const level3FighterBody = (name: string) => ({
  ...wizardBody({ name: 'Fighter', hitDie: '1d10', baseHp: 14 }),
  name,
  race: 'Human',
  subrace: null,
  level: 3,
  total_level: 3,
  class_levels: [{ classId: 'fighter', className: 'Fighter', level: 3 }],
  stats: {
    strength: 15,
    dexterity: 14,
    constitution: 14,
    intelligence: 12,
    wisdom: 10,
    charisma: 8,
    temporary_hit_points: 0,
    hit_dice: '1d10',
  },
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
        await db
          .delete(characters)
          .where(eq(characters.id, id))
          .catch(() => {});
      }
    }
    await closeRealDb();
  });

  it('persists the actual Mobile writer body through create and reload (#1317)', async () => {
    const body = JSON.parse(
      readFileSync(
        resolve(
          dirname(fileURLToPath(import.meta.url)),
          '../../../../../shared/test-fixtures/mobile-1317-create.json',
        ),
        'utf8',
      ),
    );
    const created = await request('/v1/characters', 'POST', body);
    expect(created.status, await created.clone().text()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    createdIds.push(id);
    const loaded = await request(`/v1/characters/${id}`, 'GET');
    expect(loaded.status).toBe(200);
    const json = (await loaded.json()) as { class_features: unknown };
    expect(json.class_features).toMatchObject({ 'feat:mobile': { name: 'Mobile' } });
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
    // #620: the fixture no longer carries HP or AC — the client sends inputs
    // only. The server computes level-1 HP itself: d10 + CON (+3) + Dwarven
    // Toughness (+1) = 14.
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

  it('writes default ability scores when the wizard route omits stats', async () => {
    const body = {
      ...wizardBody({ name: 'Fighter', hitDie: '1d10', baseHp: 10 }),
      stats: undefined,
    };
    const res = await request('/v1/characters', 'POST', body);
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    expect(stats).toEqual(
      expect.objectContaining({
        strength: 10,
        dexterity: 10,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      }),
    );
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

  it('computes Barbarian Unarmoured Defence on create (#620)', async () => {
    // No armour in the payload and no HP/AC sent: 10 + DEX (+2) + CON (+3) = 15.
    // HP: d12 + 3 (CON) + 1 (Dwarven Toughness) = 16.
    const res = await request(
      '/v1/characters',
      'POST',
      inputsOnlyBody({ name: 'Barbarian', hitDie: '1d12', baseHp: 16 }, [], 'L1 Barbarian 620'),
    );
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    expect(stats.armorClass).toBe(15);
    expect(stats.maxHitPoints).toBe(16);
    expect(stats.currentHitPoints).toBe(16);
  });

  it('computes Monk Unarmoured Defence on create (#620)', async () => {
    // A dagger is a weapon, not armour: 10 + DEX (+2) + WIS (+0) = 12.
    // HP: d8 + 3 (CON) + 1 (Dwarven Toughness) = 12.
    const res = await request(
      '/v1/characters',
      'POST',
      inputsOnlyBody({ name: 'Monk', hitDie: '1d8', baseHp: 12 }, ['Dagger'], 'L1 Monk 620'),
    );
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    expect(stats.armorClass).toBe(12);
    expect(stats.maxHitPoints).toBe(12);
    expect(stats.currentHitPoints).toBe(12);
  });

  it('computes Wizard HP/AC from inputs only on create (#620)', async () => {
    // d6, no armour, no HP/AC sent: HP = 6 + CON (+3) + Dwarven
    // Toughness (+1) = 10; AC = 10 + DEX (+2) = 12. A dagger and a
    // quarterstaff are weapons, not armour, so they add nothing.
    const res = await request(
      '/v1/characters',
      'POST',
      inputsOnlyBody(
        { name: 'Wizard', hitDie: '1d6', baseHp: 10 },
        ['Dagger', 'Quarterstaff'],
        'L1 Wizard 620',
      ),
    );
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    expect(stats.armorClass).toBe(12);
    expect(stats.maxHitPoints).toBe(10);
    expect(stats.currentHitPoints).toBe(10);
  });

  it('adds Dwarven Toughness to Hill Dwarf HP on create (#620)', async () => {
    // Bard, no armour, no HP/AC sent: d8 + 3 (CON) + 1 (Dwarven Toughness) = 12.
    const res = await request(
      '/v1/characters',
      'POST',
      inputsOnlyBody({ name: 'Bard', hitDie: '1d8', baseHp: 12 }, [], 'L1 Bard 620'),
    );
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    expect(stats.maxHitPoints).toBe(12);
    expect(stats.currentHitPoints).toBe(12);
  });

  it('derives AC from armour in the create payload (#620)', async () => {
    // Chain Mail (16, heavy) + shield (+2) + Defense (+1), DEX ignored: AC 19.
    // HP: d10 + 3 (CON) + 1 (Dwarven Toughness) = 14.
    const res = await request(
      '/v1/characters',
      'POST',
      inputsOnlyBody(
        { name: 'Fighter', hitDie: '1d10', baseHp: 14 },
        ['Chain Mail', 'Shield', 'Longsword'],
        'L1 Fighter 620',
      ),
    );
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    expect(stats.armorClass).toBe(19);
    expect(stats.maxHitPoints).toBe(14);
    expect(stats.currentHitPoints).toBe(14);
  });

  it('ignores client HP/AC on stats update and recomputes (#620)', async () => {
    // Create a Barbarian with no armour: AC 15 (10 + DEX 2 + CON 3), HP 16.
    const createRes = await request(
      '/v1/characters',
      'POST',
      inputsOnlyBody({ name: 'Barbarian', hitDie: '1d12', baseHp: 16 }, [], 'L1 Barbarian 620u'),
    );
    const createText = await createRes.text();
    expect(createRes.status, createText.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(createText) as { id: string };
    createdIds.push(id);

    // A stale/malicious client sends wrong HP/AC with a real DEX increase.
    // The server must ignore the derived values and recompute from inputs:
    // AC = 10 + DEX (+3) + CON (+3) = 16; HP stays d12 + 3 + 1 = 16, full.
    const updateRes = await request(`/v1/characters/${id}/stats`, 'PUT', {
      dexterity: 16,
      armor_class: 99,
      max_hit_points: 99,
      current_hit_points: 99,
    });
    expect(updateRes.status, (await updateRes.text()).slice(0, 300)).toBe(200);

    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    expect(stats.dexterity).toBe(16);
    expect(stats.armorClass).toBe(16);
    expect(stats.maxHitPoints).toBe(16);
    expect(stats.currentHitPoints).toBe(16);
  });

  it('rejects fractional gold with 422 and creates nothing (#901)', async () => {
    // The pre-fix wizard put the monk's 12.5 gp average on the wire; the
    // route's t.Number() let it through and the integer gold_pieces column
    // threw at insert — a 500 and a lost character. The schema now requires
    // an integer, so the same body is a validation error and no row exists.
    const name = `Fraction Monk ${testId('901')}`;
    const res = await request('/v1/characters', 'POST', {
      ...monkGoldPayload,
      name,
      gold_pieces: 12.5,
    });
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(422);

    const rows = await db.select().from(characters).where(eq(characters.name, name));
    expect(rows).toHaveLength(0);
  });

  it('lands a starting-gold monk with whole gp and its weapon (#901)', async () => {
    // The pinned wizard body: Starting Gold (rolled 14) + the Outlander
    // background kit. Both the gold and the weapon must persist — the QA
    // symptom was a saved starting-gold character with 0 gp and no weapon.
    // #971: the kit's gold rides in the body as a '10 gp' equipment item;
    // the purse holds the roll plus that background gold (24), and no coin
    // row is stored — this assertion read 14 while the split was the bug.
    const name = `Gold Monk ${testId('901')}`;
    const res = await request('/v1/characters', 'POST', { ...monkGoldPayload, name });
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    const [row] = await db.select().from(characters).where(eq(characters.id, id));
    expect(row).toBeDefined();
    expect(row.goldPieces).toBe(24);

    const equipmentRows = await db
      .select()
      .from(characterEquipment)
      .where(eq(characterEquipment.characterId, id));
    expect(equipmentRows.map((r: { itemName: string }) => r.itemName)).toContain('Staff');

    const getRes = await request(`/v1/characters/${id}`, 'GET');
    expect(getRes.status).toBe(200);
    const fetched = JSON.parse(await getRes.text()) as { gold_pieces?: number };
    expect(fetched.gold_pieces).toBe(24);
  });

  // #899: the class_features body below is the ClassFeatureSelection
  // producer's output shape (Record<featureId, {name, description, choice}>)
  // with the real Sorcerous Origin option strings from src/data/classes/
  // sorcerer.ts. Draconic Resilience: +1 HP and unarmoured AC 13 + DEX.
  const sorcererOriginBody = (originChoice: string, name: string) => {
    const body = wizardBody({ name: 'Sorcerer', hitDie: '1d6', baseHp: 10 }) as Record<
      string,
      unknown
    >;
    return {
      ...body,
      name,
      class_features: {
        'sorcerous-origin': {
          name: 'Sorcerous Origin',
          description:
            'Choose a sorcerous origin, which describes the source of your innate magical power.',
          choice: originChoice,
        },
        spellcasting: {
          name: 'Spellcasting',
          description:
            'An event in your past, or in the life of a parent or ancestor, left an indelible mark on you, infusing you with arcane magic.',
        },
      },
    };
  };

  it('applies Draconic Resilience to a Draconic Bloodline sorcerer on create (#899)', async () => {
    // Kit is weapons only, no HP/AC sent: HP = d6 + 3 (CON) + 1 (Dwarven
    // Toughness) + 1 (Draconic Resilience) = 11; AC = 13 + DEX (+2) = 15.
    const res = await request(
      '/v1/characters',
      'POST',
      sorcererOriginBody(
        'Draconic Bloodline: Your innate magic comes from draconic magic that was mingled with your blood',
        'L1 Draconic Sorcerer 899',
      ),
    );
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    expect(stats.maxHitPoints).toBe(11);
    expect(stats.currentHitPoints).toBe(11);
    expect(stats.armorClass).toBe(15);
  });

  it('gives a Wild Magic sorcerer no Draconic Resilience on create (#899)', async () => {
    // Same body, other origin: HP = 6 + 3 + 1 = 10; AC = 10 + DEX (+2) = 12.
    const res = await request(
      '/v1/characters',
      'POST',
      sorcererOriginBody(
        'Wild Magic: Your innate magic comes from the wild forces of chaos',
        'L1 Wild Magic Sorcerer 899',
      ),
    );
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    expect(stats.maxHitPoints).toBe(10);
    expect(stats.currentHitPoints).toBe(10);
    expect(stats.armorClass).toBe(12);
  });

  it('creates a level-3 Fighter with level-3 HP, not level-1 HP (#829)', async () => {
    // The issue's proving case through the real route: a level-3 Fighter
    // template with CON 14. Level 1: 10 (d10) + 2 (CON) = 12; two more
    // levels at the fixed average: 2 × (6 + 2) = 16; max_hp = 28. Before
    // the fix, create() always used the level-1 formula and stored 12.
    const res = await request(
      '/v1/characters',
      'POST',
      level3FighterBody(`L3 Fighter 829 ${testId('829')}`),
    );
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    const [row] = await db.select().from(characters).where(eq(characters.id, id));
    expect(row.level).toBe(3);
    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    expect(stats.maxHitPoints).toBe(28);
    expect(stats.currentHitPoints).toBe(28);
  });

  it('adds Dwarven Toughness once per level on a level-3 create (#829)', async () => {
    // wizardBody's Hill Dwarf (CON 16 after racials): level 1 is 14
    // (10 + 3 + 1); each further level adds 6 + 3 + 1 = 10, so a level-3
    // Hill Dwarf Fighter is 34 — the +1 lands once per level, not once.
    const res = await request('/v1/characters', 'POST', {
      ...wizardBody({ name: 'Fighter', hitDie: '1d10', baseHp: 14 }),
      name: `L3 Hill Dwarf Fighter 829 ${testId('829')}`,
      level: 3,
      total_level: 3,
      class_levels: [{ classId: 'fighter', className: 'Fighter', level: 3 }],
    });
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    expect(stats.maxHitPoints).toBe(34);
    expect(stats.currentHitPoints).toBe(34);
  });

  it('recomputes HP at the real level on stats update (#829)', async () => {
    // Create the level-3 Fighter (28 HP at CON 14), then raise CON to 18
    // through the real stats route. The recompute must re-derive at
    // level 3: 10 + 4 + 2 × (6 + 4) = 34. Before the fix the recompute
    // kept the stored HP for any level above 1. Full health stays full.
    const createRes = await request(
      '/v1/characters',
      'POST',
      level3FighterBody(`L3 Fighter 829u ${testId('829')}`),
    );
    const createText = await createRes.text();
    expect(createRes.status, createText.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(createText) as { id: string };
    createdIds.push(id);

    const updateRes = await request(`/v1/characters/${id}/stats`, 'PUT', { constitution: 18 });
    expect(updateRes.status, (await updateRes.text()).slice(0, 300)).toBe(200);

    const [raised] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    expect(raised.maxHitPoints).toBe(34);
    expect(raised.currentHitPoints).toBe(34);

    // Damage already taken is kept, capped at the new max: stage 10 HP of
    // damage the way the vitals engine would leave it, then lower CON to
    // 10 — max re-derives to 10 + 0 + 2 × 6 = 22 and current stays 10.
    await db
      .update(characterStats)
      .set({ currentHitPoints: 10 })
      .where(eq(characterStats.characterId, id));
    const lowerRes = await request(`/v1/characters/${id}/stats`, 'PUT', { constitution: 10 });
    expect(lowerRes.status, (await lowerRes.text()).slice(0, 300)).toBe(200);

    const [lowered] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    expect(lowered.maxHitPoints).toBe(22);
    expect(lowered.currentHitPoints).toBe(10);
  });

  it('keeps rolled level-up max HP on stats update (#829)', async () => {
    // A level-3 character whose stored max HP came from rolled level-up
    // gains — staged here the way the vitals engine leaves it, 31 in place
    // of the formula's 28 — must keep 31 when a stats upsert changes CON.
    // 31 matches neither the level-1 formula (12) nor the for-level
    // formula (28) at the pre-upsert CON, so the recompute leaves max HP
    // alone while the rest of the upsert lands.
    const createRes = await request(
      '/v1/characters',
      'POST',
      level3FighterBody(`L3 Fighter 829r ${testId('829')}`),
    );
    const createText = await createRes.text();
    expect(createRes.status, createText.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(createText) as { id: string };
    createdIds.push(id);

    await db
      .update(characterStats)
      .set({ maxHitPoints: 31, currentHitPoints: 31 })
      .where(eq(characterStats.characterId, id));

    const updateRes = await request(`/v1/characters/${id}/stats`, 'PUT', { constitution: 18 });
    expect(updateRes.status, (await updateRes.text()).slice(0, 300)).toBe(200);

    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    expect(stats.constitution).toBe(18);
    expect(stats.maxHitPoints).toBe(31);
    expect(stats.currentHitPoints).toBe(31);
  });

  it('repairs a pre-fix level-3 template carrying level-1 HP on stats update (#829)', async () => {
    // A template created before the fix stored the level-1 value (12 for
    // this Fighter) as its max — staged by writing that value over a fresh
    // create. The stored 12 is the level-1 formula's fingerprint at the
    // pre-upsert CON, so the recompute re-derives at the real level: both
    // when the upsert itself changes CON (12 → 34 at CON 18) and when it
    // changes something else (12 → 28 at the unchanged CON 14).
    const stage = async (name: string) => {
      const res = await request('/v1/characters', 'POST', level3FighterBody(name));
      const text = await res.text();
      expect(res.status, text.slice(0, 300)).toBe(201);
      const { id } = JSON.parse(text) as { id: string };
      createdIds.push(id);
      await db
        .update(characterStats)
        .set({ maxHitPoints: 12, currentHitPoints: 12 })
        .where(eq(characterStats.characterId, id));
      return id;
    };

    const conChanged = await stage(`L3 Fighter 829p ${testId('829')}`);
    const conRes = await request(`/v1/characters/${conChanged}/stats`, 'PUT', {
      constitution: 18,
    });
    expect(conRes.status, (await conRes.text()).slice(0, 300)).toBe(200);
    const [raised] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, conChanged));
    expect(raised.maxHitPoints).toBe(34);
    expect(raised.currentHitPoints).toBe(34);

    const dexChanged = await stage(`L3 Fighter 829q ${testId('829')}`);
    const dexRes = await request(`/v1/characters/${dexChanged}/stats`, 'PUT', {
      dexterity: 18,
    });
    expect(dexRes.status, (await dexRes.text()).slice(0, 300)).toBe(200);
    const [repaired] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, dexChanged));
    expect(repaired.maxHitPoints).toBe(28);
    expect(repaired.currentHitPoints).toBe(28);
  });
});

/**
 * #829 finding 2: create() granted no class features at all, so a pregen
 * created from a level-3 starter template held none of its level 1–3
 * features. CharacterService.create now grants levels 1..N through
 * ClassFeaturesService after the creation transaction commits.
 *
 * The library rows below are the rows a fully migrated database grants
 * from. Two seed generations exist: 20251112_06_add_class_features.sql
 * seeded Fighter/Rogue (and their subclasses) first with database-generated
 * ids, and the generated 20261009 seed deliberately skips any feature the
 * library already holds under the same name (ignoring a "(1 use)"-style
 * suffix) — so for Fighter/Rogue the 20251112_06 names and values are the
 * live ones, while Sorcerer exists only in the 20261009 seed. The rows here
 * follow that split (ids are the 20261009 deterministic ones; only names
 * and levels are asserted). beforeAll inserts a row only when no row with
 * the same class/subclass/name/level key is already present, so running
 * against a migrated database (CI) never duplicates a library row.
 */
const SEED_LIBRARY_ROWS = [
  {
    id: 'a584b9d4-38c4-a0fd-274c-88cdc36de138',
    className: 'Fighter',
    subclassName: null,
    featureName: 'Fighting Style',
    levelAcquired: 1,
    description:
      'You adopt a particular style of fighting as your specialty. Choose one: Archery, Defense, Dueling, Great Weapon Fighting, Protection, or Two-Weapon Fighting.',
    usageType: 'passive' as const,
    usesPerRest: 'at_will' as const,
    usesCount: null,
  },
  {
    id: 'a43cba29-7da0-5840-c801-28b7ddb889de',
    className: 'Fighter',
    subclassName: null,
    featureName: 'Second Wind',
    levelAcquired: 1,
    description:
      'You have a limited well of stamina that you can draw on to protect yourself from harm. On your turn, you can use a bonus action to regain hit points equal to 1d10 + your fighter level.',
    usageType: 'bonus_action' as const,
    usesPerRest: 'short_rest' as const,
    usesCount: 1,
  },
  {
    id: '06828104-d03c-924d-0c13-50d7af60abf8',
    className: 'Fighter',
    subclassName: null,
    featureName: 'Action Surge',
    levelAcquired: 2,
    description:
      'You can push yourself beyond your normal limits for a moment. On your turn, you can take one additional action on top of your regular action and a possible bonus action.',
    usageType: 'action' as const,
    usesPerRest: 'short_rest' as const,
    usesCount: 1,
  },
  {
    id: 'e448c2ac-e518-5503-e6a6-fed713506678',
    className: 'Fighter',
    subclassName: null,
    featureName: 'Martial Archetype',
    levelAcquired: 3,
    description:
      'Choose a martial archetype that you strive to emulate in your combat styles and techniques: Champion, Battle Master, or Eldritch Knight.',
    usageType: 'passive' as const,
    usesPerRest: 'at_will' as const,
    usesCount: null,
  },
  {
    id: '1fd90528-8ece-ee04-c38e-e686a2267793',
    className: 'Fighter',
    subclassName: null,
    featureName: 'Ability Score Improvement',
    levelAcquired: 4,
    description:
      "You can increase one ability score of your choice by 2, or you can increase two ability scores of your choice by 1. You can't increase an ability score above 20 using this feature.",
    usageType: 'passive' as const,
    usesPerRest: 'at_will' as const,
    usesCount: null,
  },
  {
    id: 'b5abe4c7-3fa9-ac32-dcdc-de2459ea4b33',
    className: 'Fighter',
    subclassName: 'Champion',
    featureName: 'Improved Critical',
    levelAcquired: 3,
    description: 'Your weapon attacks score a critical hit on a roll of 19 or 20.',
    usageType: 'passive' as const,
    usesPerRest: 'at_will' as const,
    usesCount: null,
  },
  {
    id: 'edd3b810-bfa2-93af-38cc-b854ef4eba3e',
    className: 'Sorcerer',
    subclassName: null,
    featureName: 'Sorcerous Origin',
    levelAcquired: 1,
    description:
      'Choose a sorcerous origin, which describes the source of your innate magical power, such as Draconic Bloodline.\n\nYour choice grants you features when you choose it at 1st level and again at 6th, 14th, and 18th level.',
    usageType: 'passive' as const,
    usesPerRest: null,
    usesCount: null,
  },
  {
    id: 'fb305946-df48-7198-2668-d5a572476e53',
    className: 'Sorcerer',
    subclassName: null,
    featureName: 'Spellcasting: Sorcerer',
    levelAcquired: 1,
    description:
      'An event in your past, or in the life of a parent or ancestor, left an indelible mark on you, infusing you with arcane magic. This font of magic, whatever its origin, fuels your spells.',
    usageType: 'passive' as const,
    usesPerRest: null,
    usesCount: null,
  },
  {
    id: '2d778c25-1e91-f0ea-ca35-1c6cf8013f0b',
    className: 'Sorcerer',
    subclassName: 'Draconic Bloodline',
    featureName: 'Dragon Ancestor',
    levelAcquired: 1,
    description: 'Choose a dragon type and learn Draconic.',
    usageType: 'passive' as const,
    usesPerRest: null,
    usesCount: null,
  },
  {
    id: '8d4940a1-3035-c186-c801-05ab91c2cf49',
    className: 'Sorcerer',
    subclassName: 'Draconic Bloodline',
    featureName: 'Draconic Resilience',
    levelAcquired: 1,
    description: 'Gain additional maximum HP and an unarmored AC of 13 + Dexterity.',
    usageType: 'passive' as const,
    usesPerRest: null,
    usesCount: null,
  },
  {
    id: '87f17777-b675-65cd-88ee-7b16a6ad3ffe',
    className: 'Rogue',
    subclassName: null,
    featureName: 'Expertise',
    levelAcquired: 1,
    description:
      "Choose two of your skill proficiencies, or one of your skill proficiencies and your proficiency with thieves' tools. Your proficiency bonus is doubled for any ability check you make that uses either of the chosen proficiencies.",
    usageType: 'passive' as const,
    usesPerRest: 'at_will' as const,
    usesCount: null,
  },
  {
    id: '68dbfdd2-1875-c042-0c2c-0b624f0e8596',
    className: 'Rogue',
    subclassName: null,
    featureName: 'Sneak Attack',
    levelAcquired: 1,
    description:
      "You know how to strike subtly and exploit a foe's distraction. Once per turn, you can deal an extra 1d6 damage to one creature you hit with an attack if you have advantage on the attack roll. The attack must use a finesse or a ranged weapon.",
    usageType: 'passive' as const,
    usesPerRest: 'at_will' as const,
    usesCount: null,
  },
  {
    id: '2998647e-e562-e00a-dee2-cf8ea0e72d18',
    className: 'Rogue',
    subclassName: null,
    featureName: "Thieves' Cant",
    levelAcquired: 1,
    description:
      "You have learned thieves' cant, a secret mix of dialect, jargon, and code that allows you to hide messages in seemingly normal conversation.",
    usageType: 'passive' as const,
    usesPerRest: 'at_will' as const,
    usesCount: null,
  },
  {
    id: '0bc2197b-3b2a-8e07-5750-f5d782abdbfa',
    className: 'Rogue',
    subclassName: null,
    featureName: 'Cunning Action',
    levelAcquired: 2,
    description:
      'Your quick thinking and agility allow you to move and act quickly. You can take a bonus action on each of your turns in combat. This action can be used only to take the Dash, Disengage, or Hide action.',
    usageType: 'bonus_action' as const,
    usesPerRest: 'at_will' as const,
    usesCount: null,
  },
];

describeWithDb('character create grants class features for levels 1..N (#829)', () => {
  let db: any;
  let request: (path: string, method: string, body?: unknown) => Promise<Response>;
  let ClassFeaturesService: any;
  const createdIds: string[] = [];

  /** Granted features as sorted "Name@acquiredAtLevel" strings. */
  const grantedFeatures = async (characterId: string): Promise<string[]> => {
    const rows = await db
      .select()
      .from(characterFeatures)
      .where(eq(characterFeatures.characterId, characterId));
    if (rows.length === 0) return [];
    const library = await db
      .select()
      .from(classFeaturesLibrary)
      .where(
        inArray(
          classFeaturesLibrary.id,
          rows.map((r: { featureId: string }) => r.featureId),
        ),
      );
    const nameById = new Map(
      library.map((f: { id: string; featureName: string }) => [f.id, f.featureName]),
    );
    return rows
      .map(
        (r: { featureId: string; acquiredAtLevel: number }) =>
          `${nameById.get(r.featureId)}@${r.acquiredAtLevel}`,
      )
      .sort();
  };

  beforeAll(async () => {
    userId = testId('user-829');
    db = realDb();
    // Insert only the rows the database does not already hold under the
    // same key (the 20261009 seed's own matching rule: class, subclass,
    // level, and name ignoring a trailing "(…)" suffix), so a migrated
    // database keeps exactly one row per feature.
    const libraryKey = (
      className: string,
      subclassName: string | null,
      featureName: string,
      levelAcquired: number,
    ): string =>
      [
        className,
        subclassName ?? '',
        featureName.replace(/\s*\(.*\)\s*$/, '').toLowerCase(),
        levelAcquired,
      ].join('|');
    const existingLibrary = await db
      .select()
      .from(classFeaturesLibrary)
      .where(inArray(classFeaturesLibrary.className, ['Fighter', 'Rogue', 'Sorcerer']));
    const existingKeys = new Set(
      existingLibrary.map(
        (r: {
          className: string;
          subclassName: string | null;
          featureName: string;
          levelAcquired: number;
        }) => libraryKey(r.className, r.subclassName, r.featureName, r.levelAcquired),
      ),
    );
    const missingRows = SEED_LIBRARY_ROWS.filter(
      (r) =>
        !existingKeys.has(libraryKey(r.className, r.subclassName, r.featureName, r.levelAcquired)),
    );
    if (missingRows.length > 0) {
      await db.insert(classFeaturesLibrary).values(missingRows).onConflictDoNothing();
    }
    const pipeline = await importWithRealDb(async () => {
      const { createRequestPipelineApp } = await import('../../../http-pipeline.ts');
      const { charactersRoutes } = await import('../characters.ts');
      return { createRequestPipelineApp, charactersRoutes };
    });
    const app = pipeline.createRequestPipelineApp().use(pipeline.charactersRoutes);
    request = async (path: string, method: string, body?: unknown) =>
      app.handle(
        new Request(`http://localhost${path}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        }),
      );
    ClassFeaturesService = (
      await importWithRealDb(() => import('../../../services/class-features-service.ts'))
    ).ClassFeaturesService;
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await db
        .delete(characters)
        .where(eq(characters.id, id))
        .catch(() => {});
    }
    await closeRealDb();
  });

  it('creates a level-3 Fighter with its level 1–3 features', async () => {
    // wizardBody is the wizard's wire shape; a level-3 template pregen sends
    // the same body with the template's level on it.
    const body = wizardBody({ name: 'Fighter', hitDie: '1d10', baseHp: 14 }) as Record<
      string,
      unknown
    >;
    const res = await request('/v1/characters', 'POST', {
      ...body,
      name: 'L3 Fighter 829',
      level: 3,
      total_level: 3,
      class_levels: [{ classId: 'fighter', className: 'Fighter', level: 3 }],
    });
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    // Second Wind (L1) and Action Surge (L2) are present. Martial Archetype
    // is the subclass choice point, not a feature, and Improved Critical
    // belongs to Champion, which this character has not chosen.
    expect(await grantedFeatures(id)).toEqual([
      'Action Surge@2',
      'Fighting Style@1',
      'Second Wind@1',
    ]);
  });

  it('PIN: a level-1 Fighter create grants exactly the level-1 set', async () => {
    const res = await request('/v1/characters', 'POST', {
      ...fighterPayload,
      name: `Hill Dwarf Fighter ${testId('829')}`,
    });
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    expect(await grantedFeatures(id)).toEqual(['Fighting Style@1', 'Second Wind@1']);
  });

  it('PIN: a level-1 Sorcerer create grants no subclass features', async () => {
    const res = await request(
      '/v1/characters',
      'POST',
      wizardBody({ name: 'Sorcerer', hitDie: '1d6', baseHp: 10 }),
    );
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    // Dragon Ancestor and Draconic Resilience are Draconic Bloodline rows;
    // no subclass row exists for this character, so the base grant must not
    // hand them out. (A wizard body that picks Draconic Bloodline stores the
    // choice as a class_features string; granting that origin's rows at
    // create is a separate gap — see the note in CharacterService.create.)
    expect(await grantedFeatures(id)).toEqual(['Sorcerous Origin@1', 'Spellcasting: Sorcerer@1']);
  });

  // #899: a Life Cleric picked in the wizard is stored as a divine-domain
  // choice string, not a subclass column. Create must record that subclass so
  // its level-1 feature (Disciple of Life) is granted, as a premade's is.
  it('PIN: a wizard-created Life Cleric gets Disciple of Life at level 1 (#899)', async () => {
    const res = await request('/v1/characters', 'POST', {
      ...wizardBody({ name: 'Cleric', hitDie: '1d8', baseHp: 8 }),
      class_features: {
        'divine-domain': {
          name: 'Divine Domain',
          description: 'Choose one domain related to your deity.',
          choice: 'Life Domain: Focuses on healing and protection',
        },
      },
    });
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    const granted = await grantedFeatures(id);
    expect(granted).toContain('Disciple of Life@1');
    expect(granted).not.toContain('Channel Divinity: Preserve Life@1');
  });

  it('re-granting duplicates nothing; granting level 4 completes the 1–4 set', async () => {
    const body = wizardBody({ name: 'Fighter', hitDie: '1d10', baseHp: 14 }) as Record<
      string,
      unknown
    >;
    const res = await request('/v1/characters', 'POST', {
      ...body,
      name: 'L3 Fighter 829 regrant',
      level: 3,
      total_level: 3,
      class_levels: [{ classId: 'fighter', className: 'Fighter', level: 3 }],
    });
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    const before = await grantedFeatures(id);
    expect(before).toHaveLength(3);

    // The grant is the repair path as well as the create path: running it
    // again sequentially for the same levels must not add a single row
    // (character_features has no unique constraint; the batch grant's
    // pending check is the guard).
    for (let level = 1; level <= 3; level++) {
      await ClassFeaturesService.grantFeaturesForLevel(id, 'Fighter', level, userId);
    }
    expect(await grantedFeatures(id)).toEqual(before);

    // A level-up to 4 grants exactly the level-4 feature on top.
    await ClassFeaturesService.grantFeaturesForLevel(id, 'Fighter', 4, userId);
    expect(await grantedFeatures(id)).toEqual([
      'Ability Score Improvement@4',
      'Action Surge@2',
      'Fighting Style@1',
      'Second Wind@1',
    ]);
  });

  it('grants the recorded subclass its features on re-grant', async () => {
    const body = wizardBody({ name: 'Fighter', hitDie: '1d10', baseHp: 14 }) as Record<
      string,
      unknown
    >;
    const res = await request('/v1/characters', 'POST', {
      ...body,
      name: 'L3 Fighter 829 champion',
      level: 3,
      total_level: 3,
      class_levels: [{ classId: 'fighter', className: 'Fighter', level: 3 }],
    });
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    // The create granted no Champion features — no subclass row existed.
    // Once the choice is recorded (the row SubclassService.setSubclass
    // writes), the same grant entry point delivers the subclass's features
    // for that level through its own subclass query. This pins the split
    // the base-only filter in getFeaturesByLevel relies on: base features
    // from the base query, subclass features from the subclass query.
    await db.insert(characterSubclasses).values({
      characterId: id,
      className: 'Fighter',
      subclassName: 'Champion',
      chosenAtLevel: 3,
    });
    await ClassFeaturesService.grantFeaturesForLevel(id, 'Fighter', 3, userId);

    expect(await grantedFeatures(id)).toEqual([
      'Action Surge@2',
      'Fighting Style@1',
      'Improved Critical@3',
      'Second Wind@1',
    ]);
  });

  it('grants each class its own levels on a multiclass create', async () => {
    const body = wizardBody({ name: 'Fighter', hitDie: '1d10', baseHp: 14 }) as Record<
      string,
      unknown
    >;
    const res = await request('/v1/characters', 'POST', {
      ...body,
      name: 'Fighter Rogue 829',
      level: 4,
      total_level: 4,
      class_levels: [
        { classId: 'fighter', className: 'Fighter', level: 2 },
        { classId: 'rogue', className: 'Rogue', level: 2 },
      ],
    });
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    // Total level is 4 but neither class is: the Fighter side stops at
    // level 2 (no Ability Score Improvement) and the Rogue side receives
    // its own level 1–2 features.
    expect(await grantedFeatures(id)).toEqual([
      'Action Surge@2',
      'Cunning Action@2',
      'Expertise@1',
      'Fighting Style@1',
      'Second Wind@1',
      'Sneak Attack@1',
      "Thieves' Cant@1",
    ]);
  });
});

describeWithDb('starter template subclass (#829)', () => {
  let app: any;
  let db: ReturnType<typeof realDb>;
  let request: (path: string, method: string, body?: unknown) => Promise<Response>;
  const createdIds: string[] = [];
  const STARTER_ID = 'test-829-subclass';
  let campaignId = '';

  /**
   * The wire body buildStarterCharacterSeed (src/services/character/
   * starter-character-seeding.ts) emits for the level-3 Fighter template
   * seeded below — same fields, same shapes; the client suite
   * starter-character-seeding.test.ts pins that the real seeder carries the
   * row's subclass into this payload. CON 14 per issue #829's real-route
   * test. HP is not asserted here: level-3 HP is finding 1, not this seam.
   */
  const seederBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    name: 'The Champion',
    race: 'Human',
    subrace: null,
    class: 'Fighter',
    subclass: 'Champion',
    level: 3,
    background: 'Soldier',
    backstory_elements: null,
    description: null,
    campaign_id: campaignId,
    skill_proficiencies: 'Athletics, Perception',
    languages: ['Common'],
    image_url: null,
    avatar_url: null,
    background_image: null,
    cantrips: '',
    known_spells: '',
    prepared_spells: '',
    total_level: 3,
    stats: {
      strength: 16,
      dexterity: 14,
      constitution: 14,
      intelligence: 10,
      wisdom: 12,
      charisma: 8,
    },
    equipment: [
      { item_name: 'Chain Mail', item_type: 'armor', quantity: 1, equipped: true },
      { item_name: 'Longsword', item_type: 'weapon', quantity: 1, equipped: true },
      { item_name: 'Shield', item_type: 'shield', quantity: 1, equipped: true },
    ],
    ...overrides,
  });

  beforeAll(async () => {
    userId = testId('user-829');
    db = realDb();

    // The campaign the seeder targets: in the real flow the bootstrap
    // creates the user's campaign from the starter campaign first.
    const [campaign] = await db
      .insert(campaigns)
      .values({ userId, name: `One-shot 829 ${testId('campaign')}` })
      .returning();
    campaignId = campaign.id;

    // The starter campaign + template rows, in the shape the seed
    // migrations write them (the #222 block in spell-slot-backfill.real-db
    // seeds starter_campaigns the same way). starter_character_templates
    // has no drizzle model, so these go through a pg client.
    const client = new Client({ connectionString: realDbUrl });
    await client.connect();
    try {
      // Idempotent seed: a crashed earlier run can leave these fixed-id
      // rows behind, and an unconditional INSERT would fail the whole file.
      await client.query(
        'DELETE FROM public.starter_character_templates WHERE starter_campaign_id = $1',
        [STARTER_ID],
      );
      await client.query('DELETE FROM public.starter_campaigns WHERE id = $1', [STARTER_ID]);
      await client.query(
        `INSERT INTO public.starter_campaigns
           (id, slug, title, genre, tone, difficulty, premise, is_complete, is_published)
         VALUES ($1, $1, 'One-shot 829', ARRAY['fantasy']::text[], ARRAY['heroic']::text[],
                 'medium', 'Test starter campaign for the #829 subclass proof.', false, false)`,
        [STARTER_ID],
      );
      await client.query(
        `INSERT INTO public.starter_character_templates
           (starter_campaign_id, template_key, name, race, class, background, level,
            ability_scores, skills, languages, equipment, subclass)
         VALUES ($1, 'the-champion', 'The Champion', 'Human', 'Fighter', 'Soldier', 3,
                 '{"strength":16,"dexterity":14,"constitution":14,"intelligence":10,"wisdom":12,"charisma":8}'::jsonb,
                 '["Athletics","Perception"]'::jsonb, '["Common"]'::jsonb,
                 '["Chain Mail","Longsword","Shield"]'::jsonb, 'Champion')`,
        [STARTER_ID],
      );
    } finally {
      await client.end();
    }

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
    for (const id of createdIds) {
      await db
        .delete(characterSubclasses)
        .where(eq(characterSubclasses.characterId, id))
        .catch(() => {});
      await db
        .delete(characters)
        .where(eq(characters.id, id))
        .catch(() => {});
    }
    if (campaignId) {
      await db
        .delete(campaigns)
        .where(eq(campaigns.id, campaignId))
        .catch(() => {});
    }
    const client = new Client({ connectionString: realDbUrl });
    await client.connect();
    try {
      await client.query(
        'DELETE FROM public.starter_character_templates WHERE starter_campaign_id = $1',
        [STARTER_ID],
      );
      await client.query('DELETE FROM public.starter_campaigns WHERE id = $1', [STARTER_ID]);
    } finally {
      await client.end();
    }
    await closeRealDb();
  });

  it('the template row round-trips the subclass column migration 0028 adds', async () => {
    const client = new Client({ connectionString: realDbUrl });
    await client.connect();
    try {
      const res = await client.query(
        `SELECT subclass FROM public.starter_character_templates
         WHERE starter_campaign_id = $1 AND template_key = 'the-champion'`,
        [STARTER_ID],
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].subclass).toBe('Champion');
    } finally {
      await client.end();
    }
  });

  it('creates the level-3 Fighter template character with subclass Champion', async () => {
    const res = await request('/v1/characters', 'POST', seederBody());
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    const [row] = await db.select().from(characters).where(eq(characters.id, id));
    expect(row.level).toBe(3);

    const subclasses = await db
      .select()
      .from(characterSubclasses)
      .where(eq(characterSubclasses.characterId, id));
    expect(subclasses).toHaveLength(1);
    expect(subclasses[0].className).toBe('Fighter');
    expect(subclasses[0].subclassName).toBe('Champion');
    expect(subclasses[0].chosenAtLevel).toBe(3);
  });

  it('PIN: a template below the subclass choice level creates exactly as before — no subclass row', async () => {
    const res = await request(
      '/v1/characters',
      'POST',
      seederBody({ name: 'The Champion (L2)', level: 2, total_level: 2 }),
    );
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    const [row] = await db.select().from(characters).where(eq(characters.id, id));
    expect(row.level).toBe(2);
    const subclasses = await db
      .select()
      .from(characterSubclasses)
      .where(eq(characterSubclasses.characterId, id));
    expect(subclasses).toHaveLength(0);
  });

  it('PIN: a level-3 template with NULL subclass creates exactly as before — no subclass row', async () => {
    const res = await request(
      '/v1/characters',
      'POST',
      seederBody({ name: 'The Champion (no subclass)', subclass: null }),
    );
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    const subclasses = await db
      .select()
      .from(characterSubclasses)
      .where(eq(characterSubclasses.characterId, id));
    expect(subclasses).toHaveLength(0);
  });

  it('PIN: an unknown subclass name does not fail the create — character lands without a subclass', async () => {
    // Other create paths (JSON import, backup restore) can carry subclass
    // names this build does not know; before the create body had a subclass
    // field the schema dropped the value and the create succeeded.
    const res = await request(
      '/v1/characters',
      'POST',
      seederBody({ name: 'The Champion (homebrew)', subclass: 'Oath of the Test' }),
    );
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    const subclasses = await db
      .select()
      .from(characterSubclasses)
      .where(eq(characterSubclasses.characterId, id));
    expect(subclasses).toHaveLength(0);
  });

  it('PIN: a whitespace-only subclass is ignored — character lands without a subclass', async () => {
    const res = await request(
      '/v1/characters',
      'POST',
      seederBody({ name: 'The Champion (blank subclass)', subclass: '   ' }),
    );
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    const subclasses = await db
      .select()
      .from(characterSubclasses)
      .where(eq(characterSubclasses.characterId, id));
    expect(subclasses).toHaveLength(0);
  });

  it('PIN: a level-1 template has NULL subclass — creates without a subclass row (setSubclass never called)', async () => {
    // Level-1 templates predate subclass choice, so their row's subclass
    // is NULL and the seeder body carries subclass: null; the create
    // route's guard then never calls setSubclass. The observable pin is
    // the same as the other PINs: no character_subclasses row exists for
    // the created character.
    const client = new Client({ connectionString: realDbUrl });
    await client.connect();
    try {
      // Idempotent seed, same pattern as the block's beforeAll seed.
      await client.query(
        `DELETE FROM public.starter_character_templates
         WHERE starter_campaign_id = $1 AND template_key = 'the-squire'`,
        [STARTER_ID],
      );
      await client.query(
        `INSERT INTO public.starter_character_templates
           (starter_campaign_id, template_key, name, race, class, background, level,
            ability_scores, skills, languages, equipment, subclass)
         VALUES ($1, 'the-squire', 'The Squire', 'Human', 'Fighter', 'Soldier', 1,
                 '{"strength":16,"dexterity":14,"constitution":14,"intelligence":10,"wisdom":12,"charisma":8}'::jsonb,
                 '["Athletics","Perception"]'::jsonb, '["Common"]'::jsonb,
                 '["Chain Mail","Longsword","Shield"]'::jsonb, NULL)`,
        [STARTER_ID],
      );
      const seeded = await client.query(
        `SELECT subclass FROM public.starter_character_templates
         WHERE starter_campaign_id = $1 AND template_key = 'the-squire'`,
        [STARTER_ID],
      );
      expect(seeded.rows).toHaveLength(1);
      expect(seeded.rows[0].subclass).toBeNull();
    } finally {
      await client.end();
    }

    const res = await request(
      '/v1/characters',
      'POST',
      seederBody({ name: 'The Squire', subclass: null, level: 1, total_level: 1 }),
    );
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    const [row] = await db.select().from(characters).where(eq(characters.id, id));
    expect(row.level).toBe(1);
    const subclasses = await db
      .select()
      .from(characterSubclasses)
      .where(eq(characterSubclasses.characterId, id));
    expect(subclasses).toHaveLength(0);
  });
});

/**
 * #1019: a premade level-3 hero's sheet has no subclass and no class
 * features (Hark G22-002/010, The Gardener's Heir). The bodies below are
 * the pinned client payloads produced by the real premade chain —
 * starter_character_templates row -> mapTemplateRow ->
 * buildStarterCharacterSeed -> prepareCharacterPayload — saved by
 * src/services/character/__tests__/starter-seed-1019-payload.test.ts to
 * shared/test-fixtures/. Read with readFileSync so this suite never
 * imports client modules.
 *
 * Tavo Brejo (Ranger/Hunter L3, CON 14): HP 28 either way; the issue is the
 * missing subclass and features. Clarice Faro (Sorcerer/Draconic Bloodline
 * L3, CON 14, DEX 12): without Draconic Resilience her HP is 20 and her AC
 * 11, exactly what Hark recorded; with it, HP 23 and AC 13 + DEX = 14.
 * Sorcery points have no server store for any character — the sheet derives
 * them from the granted Font of Magic feature, so the feature list is the
 * server-side assertion for them, as it is for Metamagic.
 */
const premadeFixture = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        `../../../../../shared/test-fixtures/${name}`,
      ),
      'utf8',
    ),
  ) as Record<string, unknown>;

describeWithDb('premade level-3 heroes carry subclass and features (#1019)', () => {
  let db: any;
  let request: (path: string, method: string, body?: unknown) => Promise<Response>;
  const createdIds: string[] = [];
  let campaignId = '';

  const grantedFeatures = async (characterId: string): Promise<string[]> => {
    const rows = await db
      .select()
      .from(characterFeatures)
      .where(eq(characterFeatures.characterId, characterId));
    if (rows.length === 0) return [];
    const library = await db
      .select()
      .from(classFeaturesLibrary)
      .where(
        inArray(
          classFeaturesLibrary.id,
          rows.map((r: { featureId: string }) => r.featureId),
        ),
      );
    const nameById = new Map(
      library.map((f: { id: string; featureName: string }) => [f.id, f.featureName]),
    );
    return rows
      .map(
        (r: { featureId: string; acquiredAtLevel: number }) =>
          `${nameById.get(r.featureId)}@${r.acquiredAtLevel}`,
      )
      .sort();
  };

  beforeAll(async () => {
    userId = testId('user-1019');
    db = realDb();
    const [campaign] = await db
      .insert(campaigns)
      .values({ userId, name: `One-shot 1019 ${testId('campaign')}` })
      .returning();
    campaignId = campaign.id;
    const pipeline = await importWithRealDb(async () => {
      const { createRequestPipelineApp } = await import('../../../http-pipeline.ts');
      const { charactersRoutes } = await import('../characters.ts');
      return { createRequestPipelineApp, charactersRoutes };
    });
    const app = pipeline.createRequestPipelineApp().use(pipeline.charactersRoutes);
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
    for (const id of createdIds) {
      await db
        .delete(characters)
        .where(eq(characters.id, id))
        .catch(() => {});
    }
    if (campaignId) {
      await db
        .delete(campaigns)
        .where(eq(campaigns.id, campaignId))
        .catch(() => {});
    }
    await closeRealDb();
  });

  it('writes a stats row when the premade route payload omits ability scores', async () => {
    const body = {
      ...premadeFixture('premade-ranger-l3-create-payload.json'),
      name: `Ranger without stats ${testId('1232')}`,
      campaign_id: campaignId,
      stats: undefined,
    };
    const res = await request('/v1/characters', 'POST', body);
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    expect(stats).toEqual(
      expect.objectContaining({
        strength: 10,
        dexterity: 10,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      }),
    );
  });

  it('creates the Tavo Brejo template (Ranger/Hunter L3) with subclass and the full feature list', async () => {
    const body = {
      ...premadeFixture('premade-ranger-l3-create-payload.json'),
      name: `Tavo Brejo ${testId('1019')}`,
      campaign_id: campaignId,
    };
    const res = await request('/v1/characters', 'POST', body);
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    const [row] = await db.select().from(characters).where(eq(characters.id, id));
    expect(row.level).toBe(3);
    expect(row.experiencePoints).toBe(900);

    const subclasses = await db
      .select()
      .from(characterSubclasses)
      .where(eq(characterSubclasses.characterId, id));
    expect(subclasses).toHaveLength(1);
    expect(subclasses[0].className).toBe('Ranger');
    expect(subclasses[0].subclassName).toBe('Hunter');
    expect(subclasses[0].chosenAtLevel).toBe(3);

    // 'Ranger Archetype' is the subclass choice point, not a feature: the
    // grant filter excludes choice-point rows (Archetype/Tradition/Domain)
    // for every create path, the wizard's included — see the #829 block's
    // Martial Archetype note. Everything else the issue lists is here.
    expect(await grantedFeatures(id)).toEqual([
      'Favored Enemy (1 type)@1',
      'Fighting Style@2',
      "Hunter's Prey@3",
      'Natural Explorer (1 terrain type)@1',
      'Primeval Awareness@3',
      'Spellcasting: Ranger@2',
    ]);

    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    expect(stats.maxHitPoints).toBe(28);
    expect(stats.currentHitPoints).toBe(28);

    const slots = await db
      .select()
      .from(characterSpellSlots)
      .where(eq(characterSpellSlots.characterId, id));
    expect(slots).toEqual([
      expect.objectContaining({ spellLevel: 1, totalSlots: 3, usedSlots: 0 }),
    ]);
  });

  it('creates the Clarice Faro template (Sorcerer/Draconic Bloodline L3) with Draconic Resilience in HP and AC', async () => {
    const body = {
      ...premadeFixture('premade-sorcerer-l3-create-payload.json'),
      name: `Clarice Faro ${testId('1019')}`,
      campaign_id: campaignId,
    };
    const res = await request('/v1/characters', 'POST', body);
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    const subclasses = await db
      .select()
      .from(characterSubclasses)
      .where(eq(characterSubclasses.characterId, id));
    expect(subclasses).toHaveLength(1);
    expect(subclasses[0].className).toBe('Sorcerer');
    expect(subclasses[0].subclassName).toBe('Draconic Bloodline');
    expect(subclasses[0].chosenAtLevel).toBe(3);

    // The feature list is the sheet's source for the subclass features, for
    // Font of Magic (sorcery points) and for Metamagic — all missing on the
    // sheet Hark saw.
    expect(await grantedFeatures(id)).toEqual([
      'Draconic Resilience@1',
      'Dragon Ancestor@1',
      'Flexible Casting: Converting Spell Slot@2',
      'Flexible Casting: Creating Spell Slots@2',
      'Font of Magic@2',
      'Metamagic@3',
      'Sorcerous Origin@1',
      'Spellcasting: Sorcerer@1',
    ]);

    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    // 6 + 2 (CON) + 2 x (4 + 2) = 20 without Draconic Resilience (the value
    // Hark recorded); +1 per level for the bloodline makes 23.
    expect(stats.maxHitPoints).toBe(23);
    expect(stats.currentHitPoints).toBe(23);
    // Unarmoured: 10 + DEX (+1) = 11 without the bloodline (Hark's value);
    // Draconic Resilience makes it 13 + DEX = 14.
    expect(stats.armorClass).toBe(14);
  });

  it('PIN: a wizard-created level-3 Draconic sorcerer lands the same HP and AC as the premade', async () => {
    // The wizard's wire shape (the #899 origin body) at level 3: the shared
    // pipeline must produce the same stats from either payload, which is
    // what "the premade path is the same as POST /v1/characters" means for
    // the numbers the sheet shows.
    const body = wizardBody({ name: 'Sorcerer', hitDie: '1d6', baseHp: 10 }) as Record<
      string,
      unknown
    >;
    const res = await request('/v1/characters', 'POST', {
      ...body,
      name: `L3 Draconic Sorcerer (wizard) ${testId('1019')}`,
      race: 'Human',
      subrace: null,
      level: 3,
      total_level: 3,
      class_levels: [{ classId: 'sorcerer', className: 'Sorcerer', level: 3 }],
      stats: {
        strength: 8,
        dexterity: 12,
        constitution: 14,
        intelligence: 11,
        wisdom: 10,
        charisma: 17,
      },
      class_features: {
        'sorcerous-origin': {
          name: 'Sorcerous Origin',
          description:
            'Choose a sorcerous origin, which describes the source of your innate magical power.',
          choice:
            'Draconic Bloodline: Your innate magic comes from draconic magic that was mingled with your blood',
        },
        spellcasting: {
          name: 'Spellcasting',
          description:
            'An event in your past, or in the life of a parent or ancestor, left an indelible mark on you, infusing you with arcane magic.',
        },
      },
    });
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    // Clarice's scores on a Human (no subrace toughness): 6 + 2 (CON) +
    // 2 x (4 + 2) + 3 (Draconic Resilience, +1 per level) = 23, AC 13 + 1.
    expect(stats.maxHitPoints).toBe(23);
    expect(stats.armorClass).toBe(14);
  });

  it("keeps Clarice's Draconic Resilience through a stats edit (#1019)", async () => {
    const body = {
      ...premadeFixture('premade-sorcerer-l3-create-payload.json'),
      name: `Clarice Faro (stats edit) ${testId('1019')}`,
      campaign_id: campaignId,
    };
    const res = await request('/v1/characters', 'POST', body);
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    // A stats upsert recomputes the server-owned derived stats. The
    // premade's Draconic pick exists only in the subclass row — a recompute
    // that reads only the wizard's classFeatures choice string hands back
    // AC 11 (Hark's recorded value) on the first edit.
    const put = await request(`/v1/characters/${id}/stats`, 'PUT', { dexterity: 12 });
    const putText = await put.text();
    expect(put.status, putText.slice(0, 300)).toBe(200);

    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    expect(stats.armorClass).toBe(14);
    expect(stats.maxHitPoints).toBe(23);
  });

  it('seeds third-caster spell slots for an Eldritch Knight created with its subclass (#1019)', async () => {
    // A Fighter seeds no spell-slot rows in the create transaction; the
    // rows below exist only because create runs the same post-create slot
    // sync SubclassService.setSubclass performed (#420). Without the sync
    // this character has the subclass row and its features but no slots.
    const body = wizardBody({ name: 'Fighter', hitDie: '1d10', baseHp: 14 }) as Record<
      string,
      unknown
    >;
    const res = await request('/v1/characters', 'POST', {
      ...body,
      name: `L3 Eldritch Knight ${testId('1019')}`,
      level: 3,
      total_level: 3,
      class_levels: [{ classId: 'fighter', className: 'Fighter', level: 3 }],
      subclass: 'Eldritch Knight',
    });
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    const subclasses = await db
      .select()
      .from(characterSubclasses)
      .where(eq(characterSubclasses.characterId, id));
    expect(subclasses).toHaveLength(1);
    expect(subclasses[0].className).toBe('Fighter');
    expect(subclasses[0].subclassName).toBe('Eldritch Knight');
    expect(subclasses[0].chosenAtLevel).toBe(3);

    expect(await grantedFeatures(id)).toEqual([
      'Action Surge@2',
      'Fighting Style@1',
      'Second Wind@1',
      'Spellcasting@3',
      'Weapon Bond@3',
    ]);

    const slots = await db
      .select()
      .from(characterSpellSlots)
      .where(eq(characterSpellSlots.characterId, id));
    expect(slots).toEqual([
      expect.objectContaining({ spellLevel: 1, totalSlots: 2, usedSlots: 0 }),
    ]);
  });
});

/**
 * #975 (reopened): the reopen evidence said a NEW level-1 Fighter's sheet
 * lists no Second Wind at all. The grant itself is pinned at the table level
 * by the blocks above; this block pins the SHEET surface — the class-features
 * endpoint the sheet/action tray reads — for both create shapes a player
 * actually hits: the wizard payload (class_levels present) and the starter
 * seed shape (class/level/total_level + campaign_id, no class_levels).
 */
describeWithDb('Fighter sheet exposes level-gated features (#975)', () => {
  let app: any;
  let db: any;
  let request: (path: string, method: string, body?: unknown) => Promise<Response>;
  const createdIds: string[] = [];
  let campaignId = '';

  beforeAll(async () => {
    userId = testId('user-975');
    db = realDb();
    const pipeline = await importWithRealDb(async () => {
      const { createRequestPipelineApp } = await import('../../../http-pipeline.ts');
      const { charactersRoutes } = await import('../characters.ts');
      const { classFeaturesRoutes } = await import('../class-features.ts');
      return { createRequestPipelineApp, charactersRoutes, classFeaturesRoutes };
    });
    app = pipeline
      .createRequestPipelineApp()
      .use(pipeline.charactersRoutes)
      .use(pipeline.classFeaturesRoutes);
    request = async (path: string, method: string, body?: unknown) =>
      app.handle(
        new Request(`http://localhost${path}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        }),
      );

    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('975-camp') })
      .returning({ id: campaigns.id });
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await db
        .delete(characters)
        .where(eq(characters.id, id))
        .catch(() => {});
    }
    if (campaignId) {
      await db
        .delete(campaigns)
        .where(eq(campaigns.id, campaignId))
        .catch(() => {});
    }
    await closeRealDb();
  });

  const sheetFeatures = async (characterId: string) => {
    const res = await request(`/v1/class-features/characters/${characterId}/features`, 'GET');
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(200);
    const parsed = JSON.parse(text) as { features?: unknown } | unknown[];
    const list = (Array.isArray(parsed) ? parsed : (parsed.features ?? [])) as Array<
      Record<string, unknown>
    >;
    return list;
  };

  // Canonical feature names: the library carries legacy and generated
  // spellings of one feature ("Action Surge" vs "Action Surge (1 use)"),
  // and the sheet must match them as one feature — the same
  // canonicalization the engine uses (fighter-features-service.ts).
  // Exact-name matching would pass the absence assertion vacuously on a
  // suffix-spelled library and false-fail the presence assertion there.
  const canonicalSheetName = (featureName: string): string =>
    featureName
      .replace(/\s*\([^)]*\)\s*$/, '')
      .trim()
      .toLowerCase();

  const expectSecondWindOnSheet = async (characterId: string) => {
    const features = await sheetFeatures(characterId);
    const secondWind = features.find(
      (row) =>
        canonicalSheetName(
          (row.feature as { featureName?: string } | undefined)?.featureName ?? '',
        ) === 'second wind',
    );
    expect(secondWind, JSON.stringify(features).slice(0, 400)).toBeDefined();
    expect(secondWind?.usesRemaining).toBe(1);
  };

  const expectSheetFeature = async (characterId: string, featureName: string, uses: number) => {
    const features = await sheetFeatures(characterId);
    const row = features.find(
      (entry) =>
        canonicalSheetName(
          (entry.feature as { featureName?: string } | undefined)?.featureName ?? '',
        ) === canonicalSheetName(featureName),
    );
    expect(row, JSON.stringify(features).slice(0, 400)).toBeDefined();
    expect(row?.usesRemaining).toBe(uses);
  };

  const expectSheetFeatureAbsent = async (characterId: string, featureName: string) => {
    const features = await sheetFeatures(characterId);
    expect(
      features.find(
        (entry) =>
          canonicalSheetName(
            (entry.feature as { featureName?: string } | undefined)?.featureName ?? '',
          ) === canonicalSheetName(featureName),
      ),
      JSON.stringify(features).slice(0, 400),
    ).toBeUndefined();
  };

  it('wizard create: the sheet endpoint lists Second Wind with its use', async () => {
    const res = await request('/v1/characters', 'POST', {
      ...fighterPayload,
      name: `Sheet Fighter ${testId('975')}`,
    });
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);
    await expectSecondWindOnSheet(id);
  });

  it('starter-seed shape (no class_levels): the sheet endpoint lists Second Wind', async () => {
    // buildStarterCharacterSeed's wire shape: class/level/total_level and
    // campaign_id, inputs only, and NO class_levels array.
    const body = wizardBody({ name: 'Fighter', hitDie: '1d10', baseHp: 14 }) as Record<
      string,
      unknown
    >;
    delete body.class_levels;
    const res = await request('/v1/characters', 'POST', {
      ...body,
      name: `Starter Fighter ${testId('975')}`,
      campaign_id: campaignId,
    });
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);
    await expectSecondWindOnSheet(id);
  });

  it("starter-seed shape at L3 (the premades' level): Second Wind and Action Surge, one use each", async () => {
    // #1181 Required 2: the wizard wire shape minus class_levels (the
    // pre-existing starter-seed test's shape) at the premades' level —
    // level/total_level 3. The grant loop reads none of the extra wizard
    // fields, so this pins the grant for the premade shape; it is not
    // the literal buildStarterCharacterSeed output. Hark N22-010 saw NO
    // Second Wind on a premade Fighter's sheet; if the grant loop does
    // not run for this shape, this test is the tripwire.
    const body = level3FighterBody(`Premade Fighter ${testId('975-l3')}`) as Record<
      string,
      unknown
    >;
    delete body.class_levels;
    expect('class_levels' in body).toBe(false);
    const res = await request('/v1/characters', 'POST', {
      ...body,
      campaign_id: campaignId,
    });
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);
    await expectSheetFeature(id, 'Second Wind', 1);
    await expectSheetFeature(id, 'Action Surge', 1);
  });

  it('starter-seed shape at L1: Action Surge is absent below level 2', async () => {
    const body = wizardBody({ name: 'Fighter', hitDie: '1d10', baseHp: 14 }) as Record<
      string,
      unknown
    >;
    delete body.class_levels;
    expect('class_levels' in body).toBe(false);
    const res = await request('/v1/characters', 'POST', {
      ...body,
      name: `Starter Fighter L1 ${testId('975')}`,
      campaign_id: campaignId,
    });
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);
    await expectSecondWindOnSheet(id);
    await expectSheetFeatureAbsent(id, 'Action Surge');
  });
});
