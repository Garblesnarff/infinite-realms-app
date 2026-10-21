/**
 * #710: a new custom martial character's starting package is stored equipped.
 *
 * The wizard posts equipment with equipped: false (mapWizardEquipmentToInventory).
 * POST /v1/characters must still wear the SRD armor, the shield, and the first
 * catalog weapon, and store the armor class that loadout produces. Extra
 * weapons and a backpack stay carried.
 *
 * The fighter case posts the pinned wizard payload
 * shared/test-fixtures/hill-dwarf-fighter-create-payload.json. The dashed-name
 * case uses the same wire shape with catalog ids (chain-mail, shield, longsword).
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
  levelProgression,
} from '../../../../../db/schema/index';
import fighterChoices from '../../../../../shared/test-fixtures/fighter-package-choices.json';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../services/__tests__/fixtures/real-db.ts';

import type { ProgressionService as ProgressionServiceClass } from '../../../services/progression-service.ts';

// Same logger stub the other character-route real-DB suites use.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
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

const fighterPayload = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../../shared/test-fixtures/hill-dwarf-fighter-create-payload.json',
    ),
    'utf8',
  ),
) as {
  equipment: Array<Record<string, unknown>>;
  stats: { dexterity: number };
};

// #972: the Half-Orc Paladin wizard payload (Acolyte background + the Paladin
// package: Chain Mail, Shield, Longsword), produced by the client's real
// producers (getStartingEquipment -> mapWizardEquipmentToInventory ->
// transformEquipmentForStorage -> prepareCharacterPayload), pinned the same
// way the Fighter payload above is pinned.
const paladinPayload = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../../shared/test-fixtures/half-orc-paladin-create-payload.json',
    ),
    'utf8',
  ),
) as {
  equipment: Array<Record<string, unknown>>;
  stats: { dexterity: number };
};

// #971: the pinned wizard payloads for the two Hark cases. The Monk body is
// the #901 pin (Starting Gold roll of 14 + the Outlander kit, whose equipment
// list carries the background's gold as a bare '10 gp' item). The Criminal
// Rogue body is pinned by src/hooks/__tests__/wizard-save-971-payload.test.ts
// (package path: gold_pieces 0, the Criminal kit's '15 gp' as an item).
const monkGoldPayload971 = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../../shared/test-fixtures/wood-elf-monk-starting-gold-create-payload.json',
    ),
    'utf8',
  ),
) as Record<string, unknown>;

const criminalRoguePayload971 = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../../shared/test-fixtures/criminal-rogue-create-payload.json',
    ),
    'utf8',
  ),
) as Record<string, unknown>;

// #898: the pinned wizard payloads for the proficiency round trip, produced
// by the client's real producers in
// src/hooks/__tests__/wizard-save-898-payload.test.ts (the wizard state is
// built exactly as ProficienciesSelection leaves it). Rogue: Human/Criminal,
// class choices Acrobatics/Insight/Perception/Stealth, Expertise in Insight
// and Stealth (Hark D20-010's picks). Fighter: Half-Orc/Acolyte, choices
// Athletics/Perception (the D20-005 shape). Warlock: Human/Acolyte, choices
// Arcana/Deception (the D20-012 shape). Sorcerer: Human/Noble, choices
// Arcana/Deception, saves constitution + charisma (the D20-011 shape,
// added by #995). Wizard: Human/Acolyte, choices Arcana/Investigation,
// background Insight + Religion in the saved set (the D20-013 shape,
// added by #995).
const roguePayload898 = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../../shared/test-fixtures/rogue-898-create-payload.json',
    ),
    'utf8',
  ),
) as Record<string, unknown>;

const fighterPayload898 = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../../shared/test-fixtures/fighter-898-create-payload.json',
    ),
    'utf8',
  ),
) as Record<string, unknown>;

const warlockPayload898 = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../../shared/test-fixtures/warlock-898-create-payload.json',
    ),
    'utf8',
  ),
) as Record<string, unknown>;

const sorcererPayload898 = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../../shared/test-fixtures/sorcerer-898-create-payload.json',
    ),
    'utf8',
  ),
) as Record<string, unknown>;

const wizardPayload898 = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../../shared/test-fixtures/wizard-898-create-payload.json',
    ),
    'utf8',
  ),
) as Record<string, unknown>;

type EquipRow = { itemName: string; equipped: boolean; quantity: number };
function equippedByName(rows: EquipRow[]): Map<string, EquipRow> {
  return new Map(rows.map((row) => [row.itemName, row]));
}

describeWithDb('character create starting package (#710)', () => {
  let app: { handle: (request: Request) => Promise<Response> };
  let db: ReturnType<typeof realDb>;
  const createdIds: string[] = [];

  beforeAll(async () => {
    userId = testId('user-710');
    db = realDb();
    const pipeline = await importWithRealDb(async () => {
      const { createRequestPipelineApp } = await import('../../../http-pipeline.ts');
      const { charactersRoutes } = await import('../characters.ts');
      return { createRequestPipelineApp, charactersRoutes };
    });
    app = pipeline.createRequestPipelineApp().use(pipeline.charactersRoutes);
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

  async function create(body: unknown): Promise<string> {
    const res = await app.handle(
      new Request('http://localhost/v1/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    const text = await res.text();
    expect(res.status, text.slice(0, 400)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);
    return id;
  }

  for (const fixture of fighterChoices) {
    it(`#921 ${fixture.name}: stores the wizard-selected equipment and reads it back`, async () => {
      const id = await create(fixture.body);
      const rows = await db
        .select()
        .from(characterEquipment)
        .where(eq(characterEquipment.characterId, id));
      // #971: the wizard's list carries the background's gold as a bare coin
      // string ('10 gp'); the create lands it in gold_pieces, so the stored
      // and exported names are the selection minus coin strings. The client
      // pin keeps '10 gp' in equipmentNames — that is the wizard's list,
      // not the stored rows.
      const storedNames = [...fixture.equipmentNames].filter(
        (name) => !/^\s*\d+\s*gp\s*$/i.test(name),
      );
      expect(rows.flatMap((row) => Array(row.quantity ?? 1).fill(row.itemName)).sort()).toEqual(
        storedNames.sort(),
      );
      // #971: the split coin value is not dropped — it lands in the purse.
      const [charRow] = await db.select().from(characters).where(eq(characters.id, id));
      expect(charRow?.goldPieces).toBe(10);
      const [stats] = await db
        .select()
        .from(characterStats)
        .where(eq(characterStats.characterId, id));
      expect(stats?.armorClass).toBe(fixture.mode === 'shield' ? 18 : 16);
      const read = await app.handle(new Request(`http://localhost/v1/characters/${id}/export`));
      expect(read.status).toBe(200);
      const saved = await read.json();
      expect(
        saved.character.equipment
          .flatMap((item: { item_name: string; quantity: number }) =>
            Array(item.quantity).fill(item.item_name),
          )
          .sort(),
      ).toEqual(storedNames.sort());
    });
  }

  it('persists Defense through create and read and grants AC 17 in chain mail (#824)', async () => {
    const id = await create({
      ...fighterPayload,
      name: testId('defense-fighter'),
      fighting_styles: ['defense'],
      stats: { ...fighterPayload.stats, dexterity: 10 },
      equipment: [{ item_name: 'Chain Mail', item_type: 'armor', equipped: true }],
    });
    const response = await app.handle(new Request(`http://localhost/v1/characters/${id}`));
    expect(response.status).toBe(200);
    const character = await response.json();
    expect(character.fighting_styles).toEqual(['defense']);
    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    expect(stats.armorClass).toBe(17);
    const update = async (body: unknown) => {
      const response = await app.handle(
        new Request(`http://localhost/v1/characters/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
      expect(response.status).toBe(200);
      const [stats] = await db
        .select()
        .from(characterStats)
        .where(eq(characterStats.characterId, id));
      return stats.armorClass;
    };
    expect(await update({ fighting_styles: ['archery'] })).toBe(16);
    expect(await update({ fighting_styles: ['defense'] })).toBe(17);
    expect(
      await update({
        equipment: [{ item_name: 'Chain Mail', item_type: 'armor', equipped: false }],
      }),
    ).toBe(10);
    expect(
      await update({
        equipment: [{ item_name: 'Chain Mail', item_type: 'armor', equipped: true }],
      }),
    ).toBe(17);
  });

  it('wears Chain Mail, Shield, and Longsword from the Hill Dwarf Fighter payload and stores AC 19', async () => {
    const id = await create({
      ...fighterPayload,
      name: `Hill Dwarf Fighter ${testId('710')}`,
    });

    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    expect(stats).toBeDefined();
    // Chain Mail 16 (heavy, DEX ignored) + Shield 2 + Defense 1. The payload sends armor_class 12.
    expect(stats.armorClass).toBe(19);

    const rows = (await db
      .select()
      .from(characterEquipment)
      .where(eq(characterEquipment.characterId, id))) as EquipRow[];
    const byName = equippedByName(rows);
    expect(byName.get('Chain Mail')?.equipped).toBe(true);
    expect(byName.get('Shield')?.equipped).toBe(true);
    expect(byName.get('Longsword')?.equipped).toBe(true);
    expect(byName.get('Handaxe')?.equipped).toBe(false);
    expect(byName.get('Handaxe')?.quantity).toBe(2);
    expect(byName.get('Crossbow, light')?.equipped).toBe(false);
  });

  it('wears Chain Mail, Shield, and Longsword from the Half-Orc Paladin payload and stores AC 18 (#972)', async () => {
    const id = await create({
      ...paladinPayload,
      name: `Half-Orc Paladin ${testId('972')}`,
    });

    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    expect(stats).toBeDefined();
    // Chain Mail 16 (heavy, DEX ignored) + Shield 2. No Defense style for a
    // level-1 Paladin. Hark N21-005 saw AC 12 (10 + DEX 2) — the unarmored
    // value — on the final step and the sheet.
    expect(stats.armorClass).toBe(18);

    const rows = (await db
      .select()
      .from(characterEquipment)
      .where(eq(characterEquipment.characterId, id))) as EquipRow[];
    const byName = equippedByName(rows);
    expect(byName.get('Chain Mail')?.equipped).toBe(true);
    expect(byName.get('Shield')?.equipped).toBe(true);
    expect(byName.get('Longsword')?.equipped).toBe(true);

    const read = await app.handle(new Request(`http://localhost/v1/characters/${id}/export`));
    expect(read.status).toBe(200);
    const saved = await read.json();
    // #971: the Acolyte kit's '15 gp' lands in gold_pieces at create, so the
    // exported equipment is the payload's list minus the bare coin string.
    const [charRow] = await db.select().from(characters).where(eq(characters.id, id));
    expect(charRow?.goldPieces).toBe(15);
    expect(
      saved.character.equipment
        .flatMap((item: { item_name: string; quantity: number }) =>
          Array(item.quantity).fill(item.item_name),
        )
        .sort(),
    ).toEqual(
      paladinPayload.equipment
        .map((item) => String(item.item_name))
        .filter((name) => !/^\s*\d+\s*gp\s*$/i.test(name))
        .sort(),
    );
  });

  it('wears dashed catalog ids and leaves a backpack carried', async () => {
    const template = fighterPayload.equipment[0];
    const id = await create({
      ...fighterPayload,
      name: `Dashed martial ${testId('710')}`,
      equipment: ['chain-mail', 'shield', 'longsword', 'Backpack'].map((itemName) => ({
        ...template,
        item_name: itemName,
        equipped: false,
        quantity: 1,
      })),
    });

    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    expect(stats.armorClass).toBe(19);

    const rows = (await db
      .select()
      .from(characterEquipment)
      .where(eq(characterEquipment.characterId, id))) as EquipRow[];
    const byName = equippedByName(rows);
    expect(byName.get('chain-mail')?.equipped).toBe(true);
    expect(byName.get('shield')?.equipped).toBe(true);
    expect(byName.get('longsword')?.equipped).toBe(true);
    expect(byName.get('Backpack')?.equipped).toBe(false);
  });
});

describeWithDb('character create XP seeding + awardXP demotion guard (#829 finding 4)', () => {
  let app: { handle: (request: Request) => Promise<Response> };
  let db: ReturnType<typeof realDb>;
  let ProgressionService: typeof ProgressionServiceClass;
  const createdIds: string[] = [];

  beforeAll(async () => {
    userId = testId('user-829xp');
    db = realDb();
    const pipeline = await importWithRealDb(async () => {
      const { createRequestPipelineApp } = await import('../../../http-pipeline.ts');
      const { charactersRoutes } = await import('../characters.ts');
      const progression = await import('../../../services/progression-service.ts');
      return {
        createRequestPipelineApp,
        charactersRoutes,
        ProgressionService: progression.ProgressionService,
      };
    });
    app = pipeline.createRequestPipelineApp().use(pipeline.charactersRoutes);
    ProgressionService = pipeline.ProgressionService;
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

  async function createViaRoute(body: unknown): Promise<string> {
    const res = await app.handle(
      new Request('http://localhost/v1/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    const text = await res.text();
    expect(res.status, text.slice(0, 400)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);
    return id;
  }

  // The pinned wizard payload with only the level fields raised to 3: the wire
  // shape of an above-level-1 character (a premade template) arriving at the
  // one create writer. The wizard producer sends experience_points: 0.
  const fighterPayloadClassLevels = (
    fighterPayload as unknown as { class_levels?: Array<Record<string, unknown>> }
  ).class_levels ?? [{}];

  function level3TemplateBody(name: string): Record<string, unknown> {
    return {
      ...fighterPayload,
      name,
      level: 3,
      total_level: 3,
      class_levels: [{ ...fighterPayloadClassLevels[0], level: 3 }],
    };
  }

  async function characterRow(id: string): Promise<typeof characters.$inferSelect> {
    const [row] = await db.select().from(characters).where(eq(characters.id, id));
    if (!row) throw new Error(`character ${id} missing after create`);
    return row;
  }

  async function progressionRow(
    id: string,
  ): Promise<typeof levelProgression.$inferSelect> {
    const [row] = await db
      .select()
      .from(levelProgression)
      .where(eq(levelProgression.characterId, id));
    if (!row) throw new Error(`level_progression row missing for ${id}`);
    return row;
  }

  it('(a) a level-3 template character starts at the level-3 XP threshold (900)', async () => {
    const id = await createViaRoute(level3TemplateBody(testId('lvl3-template')));
    const row = await characterRow(id);
    expect(row.level).toBe(3);
    expect(row.experiencePoints).toBe(900);
  });

  it('(b) initializeProgression seeds the row from the character record (level 3, 900 XP)', async () => {
    const id = await createViaRoute(level3TemplateBody(testId('lvl3-init')));
    const progression = await ProgressionService.initializeProgression(id, userId);
    expect(progression.currentLevel).toBe(3);
    expect(progression.currentXp).toBe(900);
    expect(progression.totalXp).toBe(900);
    expect(progression.xpToNextLevel).toBe(1800);
  });

  it('(b) awarding 500 XP to the level-3 character stores 1400 XP and keeps level 3', async () => {
    const id = await createViaRoute(level3TemplateBody(testId('lvl3-award')));
    const result = await ProgressionService.awardXP(id, 500, 'combat', userId, 'test award');
    expect(result).toMatchObject({
      newXp: 1400,
      totalXp: 1400,
      oldLevel: 3,
      newLevel: 3,
      leveledUp: false,
      levelsGained: 0,
    });
    const progression = await progressionRow(id);
    expect(progression.currentLevel).toBe(3);
    expect(progression.currentXp).toBe(1400);
    expect(progression.totalXp).toBe(1400);
    expect(progression.xpToNextLevel).toBe(1300);
    expect((await characterRow(id)).level).toBe(3);
  });

  it('(c) a level-3 character with low recorded XP and no progression row is not demoted', async () => {
    // The row the pre-fix producers left behind: create() recorded level 3
    // with 0 XP, and the live story/combat XP writers added 100 XP to
    // characters.experience_points only. No level_progression row exists.
    const [{ id }] = await db
      .insert(characters)
      .values({ userId, name: testId('legacy-norow'), level: 3, experiencePoints: 100 })
      .returning({ id: characters.id });
    createdIds.push(id);

    const result = await ProgressionService.awardXP(id, 50, 'quest', userId);
    expect(result).toMatchObject({ totalXp: 150, oldLevel: 3, newLevel: 3, leveledUp: false });
    expect((await progressionRow(id)).currentLevel).toBe(3);
    expect((await characterRow(id)).level).toBe(3);
  });

  it('(c) a stale level-1 progression row cannot demote a level-3 character either', async () => {
    const [{ id }] = await db
      .insert(characters)
      .values({ userId, name: testId('legacy-stalerow'), level: 3, experiencePoints: 100 })
      .returning({ id: characters.id });
    createdIds.push(id);
    // Exactly what the old initializeProgression wrote for this character.
    await db.insert(levelProgression).values({
      characterId: id,
      currentLevel: 1,
      currentXp: 0,
      xpToNextLevel: 300,
      totalXp: 0,
    });

    const result = await ProgressionService.awardXP(id, 500, 'combat', userId);
    expect(result).toMatchObject({ oldLevel: 3, newLevel: 3, leveledUp: false });
    const progression = await progressionRow(id);
    expect(progression.currentLevel).toBe(3);
    expect(progression.totalXp).toBe(500);
    expect((await characterRow(id)).level).toBe(3);
  });

  it('a genuine level-up still lands: level 1 with 0 XP + 300 XP reaches level 2', async () => {
    const id = await createViaRoute({
      ...fighterPayload,
      name: testId('pin-levelup'),
    });
    const result = await ProgressionService.awardXP(id, 300, 'combat', userId);
    expect(result).toMatchObject({
      oldLevel: 1,
      newLevel: 2,
      leveledUp: true,
      levelsGained: 1,
      totalXp: 300,
    });
    expect((await characterRow(id)).level).toBe(2);
    const progression = await progressionRow(id);
    expect(progression.currentLevel).toBe(2);
    expect(progression.xpToNextLevel).toBe(600);
  });

  it('(d) PIN: a true level-1 character initializes and awards exactly as before', async () => {
    const id = await createViaRoute({
      ...fighterPayload,
      name: testId('pin-lvl1'),
    });
    const created = await characterRow(id);
    expect(created.level).toBe(1);
    expect(created.experiencePoints).toBe(0);

    const initial = await ProgressionService.initializeProgression(id, userId);
    expect(initial.currentLevel).toBe(1);
    expect(initial.currentXp).toBe(0);
    expect(initial.totalXp).toBe(0);
    expect(initial.xpToNextLevel).toBe(300);

    const result = await ProgressionService.awardXP(id, 50, 'combat', userId, 'killed a goblin');
    expect(result).toMatchObject({
      newXp: 50,
      totalXp: 50,
      oldLevel: 1,
      newLevel: 1,
      leveledUp: false,
      levelsGained: 0,
    });
    const progression = await progressionRow(id);
    expect(progression.currentLevel).toBe(1);
    expect(progression.currentXp).toBe(50);
    expect(progression.totalXp).toBe(50);
    expect(progression.xpToNextLevel).toBe(250);
  });
});

describeWithDb('character create gold lands in the purse, never as an item (#971)', () => {
  let app: { handle: (request: Request) => Promise<Response> };
  let db: ReturnType<typeof realDb>;
  const createdIds: string[] = [];

  beforeAll(async () => {
    userId = testId('user-971');
    db = realDb();
    const pipeline = await importWithRealDb(async () => {
      const { createRequestPipelineApp } = await import('../../../http-pipeline.ts');
      const { charactersRoutes } = await import('../characters.ts');
      return { createRequestPipelineApp, charactersRoutes };
    });
    app = pipeline.createRequestPipelineApp().use(pipeline.charactersRoutes);
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

  async function create(body: unknown): Promise<string> {
    const res = await app.handle(
      new Request('http://localhost/v1/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    const text = await res.text();
    expect(res.status, text.slice(0, 400)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);
    return id;
  }

  async function goldPieces(id: string): Promise<number | null | undefined> {
    const [row] = await db.select().from(characters).where(eq(characters.id, id));
    return row?.goldPieces;
  }

  async function equipmentNames(id: string): Promise<string[]> {
    const rows = await db
      .select()
      .from(characterEquipment)
      .where(eq(characterEquipment.characterId, id));
    return rows.map((row) => row.itemName);
  }

  async function fetchedGoldPieces(id: string): Promise<number | undefined> {
    const res = await app.handle(new Request(`http://localhost/v1/characters/${id}`));
    expect(res.status).toBe(200);
    const fetched = (await res.json()) as { gold_pieces?: number };
    return fetched.gold_pieces;
  }

  const BARE_GOLD = /^\s*\d+\s*gp\s*$/i;

  it('Starting Gold monk: the roll and the Outlander 10 gp both land in the purse (N21-001)', async () => {
    // The pinned wizard body carries gold_pieces 14 (the roll) and the
    // Outlander kit's '10 gp' as an equipment item. Pre-fix the create stored
    // 14 and a '10 gp' row; the purse must hold 24 and no coin row may exist.
    const id = await create({ ...monkGoldPayload971, name: testId('monk-gold') });

    expect(await goldPieces(id)).toBe(24);
    const names = await equipmentNames(id);
    expect(names).toContain('Staff');
    expect(names).toContain('Belt pouch');
    expect(names.filter((name) => BARE_GOLD.test(name))).toEqual([]);
    expect(await fetchedGoldPieces(id)).toBe(24);
    // The split runs before the AC computation and a coin string was never
    // armour: Unarmoured Defence stands (10 + DEX 4 + WIS 3).
    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    expect(stats?.armorClass).toBe(17);
  });

  it('Starting Gold monk with a 100 gp roll saves 110 (100 roll + 10 background)', async () => {
    const id = await create({
      ...monkGoldPayload971,
      name: testId('monk-gold-100'),
      gold_pieces: 100,
    });

    expect(await goldPieces(id)).toBe(110);
    const names = await equipmentNames(id);
    expect(names.filter((name) => BARE_GOLD.test(name))).toEqual([]);
    expect(await fetchedGoldPieces(id)).toBe(110);
  });

  it('Criminal package rogue: the background 15 gp lands in the purse, not as an item (N21-006)', async () => {
    // The pinned wizard body carries gold_pieces 0 and the Criminal kit's
    // '15 gp' as an equipment item. Pre-fix the create stored 0 and a
    // '15 gp' row (Hark's '15 gp Qty:1').
    const id = await create({ ...criminalRoguePayload971, name: testId('criminal-rogue') });

    expect(await goldPieces(id)).toBe(15);
    const names = await equipmentNames(id);
    expect(names).toContain('A crowbar');
    expect(names.filter((name) => BARE_GOLD.test(name))).toEqual([]);
    expect(await fetchedGoldPieces(id)).toBe(15);
  });

  it('a coin string with quantity multiplies into the purse', async () => {
    const id = await create({
      ...criminalRoguePayload971,
      name: testId('criminal-rogue-qty'),
      equipment: [
        ...(criminalRoguePayload971.equipment as Array<Record<string, unknown>>),
        // Whitespace-padded on purpose: the production pattern tolerates it
        // and the split must too.
        { item_name: ' 5 gp ', item_type: 'equipment', quantity: 2 },
      ],
    });

    expect(await goldPieces(id)).toBe(25);
    const names = await equipmentNames(id);
    expect(names.filter((name) => BARE_GOLD.test(name))).toEqual([]);
  });
});

describeWithDb('character create proficiencies survive to the saved sheet (#898)', () => {
  let app: { handle: (request: Request) => Promise<Response> };
  let db: ReturnType<typeof realDb>;
  const createdIds: string[] = [];

  beforeAll(async () => {
    userId = testId('user-898');
    db = realDb();
    const pipeline = await importWithRealDb(async () => {
      const { createRequestPipelineApp } = await import('../../../http-pipeline.ts');
      const { charactersRoutes } = await import('../characters.ts');
      return { createRequestPipelineApp, charactersRoutes };
    });
    app = pipeline.createRequestPipelineApp().use(pipeline.charactersRoutes);
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

  async function create(body: unknown): Promise<string> {
    const res = await app.handle(
      new Request('http://localhost/v1/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    const text = await res.text();
    expect(res.status, text.slice(0, 400)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);
    return id;
  }

  const sortedCsv = (v: unknown): string[] =>
    String(v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .sort();

  // The D20 sweep (builds 43a2a4d7 / e8a0e324) found these sets lost or
  // wrong on the saved sheet: the Fighter read back with only its racial
  // skill and one choice, the Warlock's saves came back as another class's,
  // the Rogue's Expertise showed +0. The client pin proves the wizard body
  // carries the full sets; this block proves the create stores them verbatim
  // and the GET serves them back — the two hops the sheet reads. #995 adds
  // the Sorcerer (D20-011) and Wizard (D20-013) shapes #993 did not cover.
  const CASES = [
    {
      label: 'rogue',
      payload: roguePayload898,
      // Criminal fixed (Deception, Stealth) + class choices (Acrobatics,
      // Insight, Perception, Stealth); Expertise in Insight and Stealth.
      skills: ['Acrobatics', 'Deception', 'Insight', 'Perception', 'Stealth'],
      saves: ['dexterity', 'intelligence'],
      expertise: ['Insight', 'Stealth'],
      tools: ["Thieves' tools", 'One type of gaming set'],
    },
    {
      label: 'fighter',
      payload: fighterPayload898,
      // Acolyte fixed (Insight, Religion) + Half-Orc Menacing (Intimidation)
      // + class choices (Athletics, Perception).
      skills: ['Athletics', 'Insight', 'Intimidation', 'Perception', 'Religion'],
      saves: ['strength', 'constitution'],
      expertise: [] as string[],
      tools: [] as string[],
    },
    {
      label: 'warlock',
      payload: warlockPayload898,
      // Acolyte fixed (Insight, Religion) + class choices (Arcana, Deception).
      skills: ['Arcana', 'Deception', 'Insight', 'Religion'],
      saves: ['wisdom', 'charisma'],
      expertise: [] as string[],
      tools: [] as string[],
    },
    {
      label: 'sorcerer',
      payload: sorcererPayload898,
      // Noble fixed (History, Persuasion) + class choices (Arcana,
      // Deception); the D20-011 shape is the CON/CHA save pair.
      skills: ['Arcana', 'Deception', 'History', 'Persuasion'],
      saves: ['constitution', 'charisma'],
      expertise: [] as string[],
      tools: ['One type of gaming set'],
    },
    {
      label: 'wizard',
      payload: wizardPayload898,
      // Acolyte fixed (Insight, Religion) + class choices (Arcana,
      // Investigation); the D20-013 shape is the background Insight
      // surviving into the saved set.
      skills: ['Arcana', 'Insight', 'Investigation', 'Religion'],
      saves: ['intelligence', 'wisdom'],
      expertise: [] as string[],
      tools: [] as string[],
    },
  ];

  for (const c of CASES) {
    it(`${c.label}: chosen skills, class saves and expertise are stored and served back`, async () => {
      const id = await create({ ...c.payload, name: testId(`prof-898-${c.label}`) });

      const [row] = await db.select().from(characters).where(eq(characters.id, id));
      expect(sortedCsv(row?.skillProficiencies), 'stored skills').toEqual([...c.skills].sort());
      expect(sortedCsv(row?.savingThrowProficiencies), 'stored saves').toEqual([...c.saves].sort());
      expect(sortedCsv(row?.expertiseProficiencies), 'stored expertise').toEqual(
        [...c.expertise].sort(),
      );
      expect(sortedCsv(row?.toolProficiencies), 'stored tools').toEqual([...c.tools].sort());

      const res = await app.handle(new Request(`http://localhost/v1/characters/${id}`));
      expect(res.status).toBe(200);
      const api = (await res.json()) as Record<string, unknown>;
      expect(sortedCsv(api.skill_proficiencies), 'GET skills').toEqual([...c.skills].sort());
      expect(sortedCsv(api.saving_throw_proficiencies), 'GET saves').toEqual([...c.saves].sort());
      expect(sortedCsv(api.expertise_proficiencies), 'GET expertise').toEqual(
        [...c.expertise].sort(),
      );
      expect(sortedCsv(api.tool_proficiencies), 'GET tools').toEqual([...c.tools].sort());
    });
  }
});
