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

import {
  characterFeatures,
  characters,
  characterEquipment,
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
    const name = `Gold Monk ${testId('901')}`;
    const res = await request('/v1/characters', 'POST', { ...monkGoldPayload, name });
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);

    const [row] = await db.select().from(characters).where(eq(characters.id, id));
    expect(row).toBeDefined();
    expect(row.goldPieces).toBe(14);

    const equipmentRows = await db
      .select()
      .from(characterEquipment)
      .where(eq(characterEquipment.characterId, id));
    expect(equipmentRows.map((r: { itemName: string }) => r.itemName)).toContain('Staff');

    const getRes = await request(`/v1/characters/${id}`, 'GET');
    expect(getRes.status).toBe(200);
    const fetched = JSON.parse(await getRes.text()) as { gold_pieces?: number };
    expect(fetched.gold_pieces).toBe(14);
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
      (r) => !existingKeys.has(libraryKey(r.className, r.subclassName, r.featureName, r.levelAcquired)),
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
    expect(await grantedFeatures(id)).toEqual([
      'Sorcerous Origin@1',
      'Spellcasting: Sorcerer@1',
    ]);
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
