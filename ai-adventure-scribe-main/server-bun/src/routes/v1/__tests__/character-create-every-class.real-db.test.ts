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

import { characters, characterEquipment, characterStats } from '../../../../../db/schema/index';
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
