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
import { and, eq } from 'drizzle-orm';

import {
  campaigns,
  characters,
  characterEquipment,
  characterStats,
  combatEncounters,
  dialogueHistory,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
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

  async function progressionRow(id: string): Promise<typeof levelProgression.$inferSelect> {
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

/**
 * #1007 pin: a new character's package gear reaches the session.
 *
 * Hark N22-024: a fresh Rogue's in-session sheet showed "Attacks: No weapons",
 * "Equipment: Nothing equipped", "Inventory: Nothing carried", and a shortbow
 * shot resolved as an Unarmed Strike. Traced end to end on main: creation
 * writes character_equipment; the session sheet reads those rows back through
 * GET /v1/characters/:id/equipment (loadCharacterWithSpells ->
 * equipmentRowsToInventory); combat reads the same rows (listCarried /
 * listEquippedWeaponProfiles) and the legal-action list is built from the
 * equipped profiles. What was missing was a test that walks the chain for
 * the Rogue package, so a break in any single hop — create, the equipment
 * read, the seat, the weapon resolution — failed nowhere. (The seat below
 * is direct-inserted rows in the shapes the encounter-lifecycle suite's
 * producers use; the session-init producer itself is covered there.) This
 * block walks it for both creation producers:
 *
 * - the wizard payload (shared/test-fixtures/criminal-rogue-create-payload.json,
 *   the pinned output of getStartingEquipment -> mapWizardEquipmentToInventory
 *   -> transformEquipmentForStorage -> prepareCharacterPayload), and
 * - the premade payload (shared/test-fixtures/premade-rogue-create-payload.json,
 *   the pinned output of buildStarterCharacterSeed -> prepareCharacterPayload,
 *   locked to the producer by the pin test in
 *   src/services/character/__tests__/starter-character-seeding.test.ts. The
 *   template it is built from is a reconstruction of Hark's Grimnir package
 *   — Hill Dwarf Rogue, Criminal, the issue's gear list — because the Abyss
 *   premades' prod template rows are data, not repo content; it pins the
 *   producer's handling of that package, not the prod row itself.)
 *
 * The wizard seeds only the first catalog weapon equipped (the Dagger), so
 * its shortbow is carried but not equipped: the honest outcomes are a Dagger
 * attack on the legal list, the shortbow among the carried profiles, and a
 * "not equipped" refusal for a shortbow intent — never an Unarmed Strike.
 * The premade seed equips the shortbow, so its intent resolves as a
 * Shortbow. #1013's two halves are pinned separately: the premade
 * producer's bundle expansion supplies the ammunition (the template's
 * "Quiver with 20 Arrows" becomes real Arrows (20) + Quiver rows), and the
 * third test removes those arrows and pins #1013's no-ammunition refusal
 * for an equipped ranged weapon.
 */
const premadeRoguePayload = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../../shared/test-fixtures/premade-rogue-create-payload.json',
    ),
    'utf8',
  ),
) as Record<string, unknown>;

type IntentOutcome = {
  weaponResolution?: { resolved?: string; substituted?: boolean };
};

describeWithDb('package gear reaches the session (#1007)', () => {
  let app: { handle: (request: Request) => Promise<Response> };
  let db: ReturnType<typeof realDb>;
  let executeCombatIntent: (
    encounterId: string,
    intent: unknown,
    userId: string,
    source: string,
  ) => Promise<IntentOutcome>;
  let getLegalCombatActions: (
    encounterId: string,
    userId: string,
  ) => Promise<{ actions: Array<{ type: string; label?: string }> }>;
  let listCarriedWeaponProfiles: (participant: {
    characterId: string;
  }) => Promise<Array<{ name: string }>>;
  const cleanup: Array<() => Promise<unknown>> = [];

  beforeAll(async () => {
    userId = testId('user-1007');
    db = realDb();
    const pipeline = await importWithRealDb(async () => {
      const { createRequestPipelineApp } = await import('../../../http-pipeline.ts');
      const { charactersRoutes } = await import('../characters.ts');
      const { issue1784DataRoutes } = await import('../issue-1784-data.ts');
      const { inventoryRoutes } = await import('../inventory.ts');
      const { tacticalMapRoutes } = await import('../tactical-maps.ts');
      const { combatRoutes } = await import('../combat/index.ts');
      const { sessionsRoutes } = await import('../sessions.ts');
      const intentService = await import('../../../services/combat/combat-intent-service.ts');
      const dataAccess = await import('../../../services/combat/data-access.ts');
      return {
        createRequestPipelineApp,
        charactersRoutes,
        issue1784DataRoutes,
        inventoryRoutes,
        tacticalMapRoutes,
        combatRoutes,
        sessionsRoutes,
        intentService,
        dataAccess,
      };
    });
    app = pipeline
      .createRequestPipelineApp()
      .use(pipeline.charactersRoutes)
      .use(pipeline.inventoryRoutes)
      .use(pipeline.tacticalMapRoutes)
      .use(pipeline.combatRoutes)
      .use(pipeline.sessionsRoutes)
      .use(pipeline.issue1784DataRoutes);
    executeCombatIntent = pipeline.intentService.executeCombatIntent as typeof executeCombatIntent;
    getLegalCombatActions = pipeline.intentService
      .getLegalCombatActions as unknown as typeof getLegalCombatActions;
    listCarriedWeaponProfiles = pipeline.dataAccess
      .listCarriedWeaponProfiles as typeof listCarriedWeaponProfiles;
  });

  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn().catch(() => {});
    await closeRealDb();
  });

  async function create(body: Record<string, unknown>): Promise<string> {
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
    cleanup.push(async () => db.delete(characters).where(eq(characters.id, id)));
    return id;
  }

  type EquipmentRow = { item_name: string; equipped: boolean; quantity: number };

  async function equipmentRows(id: string): Promise<EquipmentRow[]> {
    const res = await app.handle(new Request(`http://localhost/v1/characters/${id}/equipment`));
    expect(res.status).toBe(200);
    return (await res.json()) as EquipmentRow[];
  }

  async function equipmentRowNames(id: string): Promise<string[]> {
    return (await equipmentRows(id)).map((row) => row.item_name);
  }

  /** The "Nothing equipped" / quantity half of N22-024, asserted on the same
   * rows the session sheet reads: the armor must arrive EQUIPPED and the
   * package's Dagger x2 must arrive as quantity 2. */
  function expectPackageEquipped(rows: EquipmentRow[]): void {
    const armor = rows.find((row) => row.item_name === 'Leather Armor');
    expect(armor?.equipped).toBe(true);
    const daggerQuantity = rows
      .filter((row) => row.item_name === 'Dagger')
      .reduce((sum, row) => sum + row.quantity, 0);
    expect(daggerQuantity).toBe(2);
  }

  /** Seat the character in a real encounter (rows copied from the producers
   * encounter-lifecycle uses) and return the ids the intent service needs. */
  async function seat(
    characterId: string,
  ): Promise<{ encounterId: string; heroId: string; foeId: string; sessionId: string }> {
    const [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('camp-1007') })
      .returning({ id: campaigns.id });
    cleanup.push(async () => db.delete(campaigns).where(eq(campaigns.id, campaignId)));
    const [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    cleanup.push(async () => db.delete(gameSessions).where(eq(gameSessions.id, sessionId)));
    const [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });
    cleanup.push(async () =>
      db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId)),
    );
    const inserted = await db
      .insert(combatParticipants)
      .values([
        {
          encounterId,
          characterId,
          name: 'Session Hero',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 14,
          maxHp: 30,
          speed: 30,
        },
        {
          encounterId,
          name: 'Session Foe',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 10,
          armorClass: 12,
          maxHp: 30,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
    const heroId = inserted.find((row) => row.turnOrder === 0)!.id;
    const foeId = inserted.find((row) => row.turnOrder === 1)!.id;
    await db.insert(combatParticipantStatus).values([
      { participantId: heroId, currentHp: 30, maxHp: 30, isConscious: true },
      { participantId: foeId, currentHp: 30, maxHp: 30, isConscious: true },
    ]);
    cleanup.push(async () =>
      db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId)),
    );
    return { encounterId, heroId, foeId, sessionId };
  }

  async function resetTurn(encounterId: string): Promise<void> {
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false })
      .where(eq(combatParticipants.encounterId, encounterId));
    await db
      .update(combatEncounters)
      .set({ currentTurnOrder: 0, updatedAt: new Date() })
      .where(eq(combatEncounters.id, encounterId));
  }

  async function attackLabels(encounterId: string): Promise<string[]> {
    const legal = await getLegalCombatActions(encounterId, userId);
    return legal.actions.filter((a) => a.type === 'attack').map((a) => a.label ?? '');
  }

  it('wizard rogue: package rows are served to the session and the shortbow never becomes an Unarmed Strike', async () => {
    const id = await create({ ...criminalRoguePayload971, name: testId('wiz-rogue-1007') });

    // The read the in-session sheet is built from.
    const rows = await equipmentRows(id);
    const names = rows.map((row) => row.item_name);
    expect(names).toContain('Shortbow');
    expect(names).toContain('Dagger');
    expect(names).toContain('Leather Armor');
    expect(names).toContain("Thieves' Tools");
    expectPackageEquipped(rows);

    const { encounterId, heroId, foeId } = await seat(id);

    // Carried, equipped or not — the session's weapon lookup sees the bow.
    const carried = await listCarriedWeaponProfiles({ characterId: id });
    expect(carried.map((w) => w.name)).toContain('Shortbow');

    // The legal attack list offers the equipped Dagger, not only fists.
    const labels = await attackLabels(encounterId);
    expect(labels).toContain('Attack with Dagger');

    // A shortbow intent is refused as not equipped (the equipped-profile
    // resolver) — on the build Hark played it silently resolved as an
    // Unarmed Strike instead.
    await resetTurn(encounterId);
    let refusal = '';
    try {
      await executeCombatIntent(
        encounterId,
        { type: 'attack', actorId: heroId, targetId: foeId, weaponId: 'Shortbow' },
        userId,
        'dm',
      );
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error);
    }
    expect(refusal).toContain('not equipped');

    // The default attack resolves with the equipped weapon, not fists.
    await resetTurn(encounterId);
    const outcome = await executeCombatIntent(
      encounterId,
      { type: 'attack', actorId: heroId, targetId: foeId },
      userId,
      'dm',
    );
    expect(outcome.weaponResolution?.resolved).toBe('Dagger');
    expect(outcome.weaponResolution?.substituted).toBe(false);
  });

  it('#1124 wizard fighter with a Longbow pick: the bow fires on turn 1 of the first fight', async () => {
    // The exact wizard body for Greatsword + Longbow (#921 fixture, produced by
    // EquipmentSelection -> mapWizardEquipmentToInventory -> transformEquipmentForStorage).
    const fixture = fighterChoices.find((entry) => entry.name === 'two-martial')!;
    const id = await create({ ...fixture.body, name: testId('wiz-archer-1124') });

    const rows = await equipmentRows(id);
    expect(rows.find((row) => row.item_name === 'Longbow')).toBeDefined();
    expect(rows.find((row) => row.item_name === 'Arrows (20)')?.quantity).toBe(1);

    // Turn 1 of the first fight: the picker offers the carried Longbow as
    // equip-and-attack (it is hidden when the bow has no arrows), the client
    // sends the in-session equip with the offered weaponId (#1059), then the attack.
    const { encounterId, heroId, foeId } = await seat(id);
    const legal = (await getLegalCombatActions(encounterId, userId)) as {
      actions: Array<{ type: string; label?: string; weaponId?: string; equipFirst?: boolean }>;
    };
    const offered = legal.actions.find((a) => a.label === 'Equip and attack with Longbow');
    expect(offered?.equipFirst).toBe(true);
    expect(offered?.weaponId).toBeTruthy();
    const equipRes = await app.handle(
      new Request(
        `http://localhost/v1/characters/${id}/equip/${encodeURIComponent(offered!.weaponId!)}`,
        { method: 'POST' },
      ),
    );
    expect(equipRes.status, await equipRes.clone().text()).toBe(200);

    await resetTurn(encounterId);
    const [{ version }] = await db
      .select({ version: combatEncounters.version })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    const outcome = await executeCombatIntent(
      encounterId,
      {
        type: 'attack',
        actorId: heroId,
        targetId: foeId,
        weaponId: 'Longbow',
        expectedVersion: version,
      },
      userId,
      'player',
    );
    expect(outcome.weaponResolution?.resolved).toBe('Longbow');
    expect(outcome.weaponResolution?.substituted).toBe(false);
  });

  it('premade rogue: the seeded shortbow is equipped, offered and resolves as a Shortbow', async () => {
    const [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('premade-camp-1007') })
      .returning({ id: campaigns.id });
    cleanup.push(async () => db.delete(campaigns).where(eq(campaigns.id, campaignId)));
    const id = await create({
      ...premadeRoguePayload,
      name: testId('premade-rogue-1007'),
      campaign_id: campaignId,
    });

    const rows = await equipmentRows(id);
    const names = rows.map((row) => row.item_name);
    expect(names).toContain('Shortbow');
    expect(names).toContain('Dagger');
    expect(names).toContain('Leather Armor');
    expect(names).toContain("Thieves' Tools");
    // #1013: the template's quiver bundle became real ammunition rows.
    expect(names).toContain('Arrows (20)');
    expect(names).toContain('Quiver');
    expectPackageEquipped(rows);
    expect(rows.find((row) => row.item_name === 'Shortbow')?.equipped).toBe(true);

    const { encounterId, heroId, foeId } = await seat(id);

    const carried = await listCarriedWeaponProfiles({ characterId: id });
    expect(carried.map((w) => w.name)).toContain('Shortbow');

    const labels = await attackLabels(encounterId);
    expect(labels).toContain('Attack with Shortbow');

    await resetTurn(encounterId);
    const outcome = await executeCombatIntent(
      encounterId,
      { type: 'attack', actorId: heroId, targetId: foeId, weaponId: 'Shortbow' },
      userId,
      'dm',
    );
    expect(outcome.weaponResolution?.resolved).toBe('Shortbow');
    expect(outcome.weaponResolution?.substituted).toBe(false);
    const remainingArrows = await db
      .select({ id: characterEquipment.id, quantity: characterEquipment.quantity })
      .from(characterEquipment)
      .where(
        and(eq(characterEquipment.characterId, id), eq(characterEquipment.itemName, 'Arrows (20)')),
      );
    // One shot spends one round: 20 seeded, 19 remain (#1096).
    expect(remainingArrows.map((row) => row.quantity)).toEqual([19]);
  });

  it('premade archer seeded from a Longbow + quiver template: three shots resolve and 17 arrows remain (#1096)', async () => {
    // Full producer chain: template -> seed -> wire -> real creation route.
    // The client modules load through the same computed-specifier helper
    // the #260 ammunition suite uses, which keeps them out of the server
    // typecheck program; the seed transform is the code under test, so a
    // hand-built wire body would prove nothing about it.
    const clientModule = (path: string) => import(`../../../../../src/${path}`);
    const { buildStarterCharacterSeed } = await clientModule(
      'services/character/starter-character-seeding',
    );
    const { prepareCharacterPayload } = await clientModule('services/user-data-payload-helpers');
    const [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('archer-camp-1096') })
      .returning({ id: campaigns.id });
    cleanup.push(async () => db.delete(campaigns).where(eq(campaigns.id, campaignId)));
    const seed = buildStarterCharacterSeed(
      {
        name: 'Archer Probe',
        race: 'Human',
        class: 'Fighter',
        level: 1,
        background: 'Outlander',
        ability_scores: {
          strength: 10,
          dexterity: 16,
          constitution: 14,
          intelligence: 10,
          wisdom: 14,
          charisma: 8,
        },
        equipment: ['Leather Armor', 'Longbow', 'quiver with 20 arrows'],
        skills: [],
        languages: [],
      },
      campaignId,
    );
    const wire = prepareCharacterPayload(seed as unknown as Record<string, unknown>);
    const id = await create({ ...wire, name: testId('archer-1096') });

    // The seat reads 20 arrows: the bundle string seeded the PHB count.
    const rows = await equipmentRows(id);
    expect(rows.find((row) => row.item_name === 'Longbow')?.equipped).toBe(true);
    expect(rows.find((row) => row.item_name === 'Arrows (20)')?.quantity).toBe(20);

    const { encounterId, heroId, foeId } = await seat(id);
    const arrowQuantity = async (): Promise<Array<number | null>> =>
      (
        await db
          .select({ quantity: characterEquipment.quantity })
          .from(characterEquipment)
          .where(
            and(
              eq(characterEquipment.characterId, id),
              eq(characterEquipment.itemName, 'Arrows (20)'),
            ),
          )
      ).map((row) => row.quantity);

    // d20 5 misses AC 12 (+5 attack bonus) without a natural 1 or 20, so the
    // foe survives all three shots and the encounter stays active; the spend
    // runs on resolution, not on a hit, so each shot must still cost one arrow.
    for (const expected of [19, 18, 17]) {
      await resetTurn(encounterId);
      const [{ version }] = await db
        .select({ version: combatEncounters.version })
        .from(combatEncounters)
        .where(eq(combatEncounters.id, encounterId));
      const outcome = await executeCombatIntent(
        encounterId,
        {
          type: 'attack',
          actorId: heroId,
          targetId: foeId,
          weaponId: 'Longbow',
          expectedVersion: version,
          d20: 5,
        },
        userId,
        'player',
      );
      expect(outcome.weaponResolution?.resolved).toBe('Longbow');
      expect(outcome.weaponResolution?.substituted).toBe(false);
      expect(await arrowQuantity()).toEqual([expected]);
    }
    const end = await app.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/end`, { method: 'POST' }),
    );
    expect(end.status).toBe(200);
    expect(await arrowQuantity()).toEqual([18]); // Three spent: recover half, rounded down.
  });

  it('two light-crossbow attacks through the real route spend two bolts (#1060)', async () => {
    const clientModule = (path: string) => import(`../../../../../src/${path}`);
    const { buildStarterCharacterSeed } = await clientModule(
      'services/character/starter-character-seeding',
    );
    const { prepareCharacterPayload } = await clientModule('services/user-data-payload-helpers');
    const [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('bolts-1060') })
      .returning({ id: campaigns.id });
    cleanup.push(async () => db.delete(campaigns).where(eq(campaigns.id, campaignId)));
    const seed = buildStarterCharacterSeed(
      {
        name: 'Bolt Probe',
        race: 'Human',
        class: 'Fighter',
        level: 1,
        background: 'Outlander',
        ability_scores: {
          strength: 10,
          dexterity: 16,
          constitution: 14,
          intelligence: 10,
          wisdom: 14,
          charisma: 8,
        },
        equipment: ['Leather Armor', 'Crossbow, light', 'case with 20 crossbow bolts'],
        skills: [],
        languages: [],
      },
      campaignId,
    );
    const id = await create({
      ...prepareCharacterPayload(seed as unknown as Record<string, unknown>),
      name: testId('bolts-1060'),
    });
    const bolts = async () =>
      (await equipmentRows(id)).find((row) => row.item_name === 'Crossbow Bolts (20)')?.quantity;
    expect(await bolts()).toBe(20);
    const { encounterId, heroId, foeId, sessionId } = await seat(id);
    for (const expected of [19, 18]) {
      await resetTurn(encounterId);
      const [{ version }] = await db
        .select({ version: combatEncounters.version })
        .from(combatEncounters)
        .where(eq(combatEncounters.id, encounterId));
      const response = await app.handle(
        new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intent: {
              type: 'attack',
              actorId: heroId,
              targetId: foeId,
              weaponId: 'Crossbow, light',
              expectedVersion: version,
              d20: 5,
            },
            source: 'player',
            origin: 'action_bar',
          }),
        }),
      );
      expect(response.status, await response.clone().text()).toBe(200);
      expect(await response.json()).toMatchObject({
        accepted: true,
        result: { weaponResolution: { resolved: 'Crossbow, light', substituted: false } },
      });
      expect(await bolts()).toBe(expected);
      if (expected === 19) {
        const save = await app.handle(
          new Request(`http://localhost/v1/sessions/${sessionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_state: {
                ammunition_spent: [
                  {
                    encounterId,
                    characterId: id,
                    itemId: 'forged',
                    source: 'equipment',
                    kind: 'bolts',
                  },
                ],
              },
            }),
          }),
        );
        expect(save.status).toBe(200);
      }
    }
    expect((await equipmentRows(id)).find((row) => /case/i.test(row.item_name))?.quantity).toBe(1);
    const owner = userId;
    try {
      userId = testId('other-user');
      const foreign = await app.handle(
        new Request(`http://localhost/v1/combat/${encounterId}/end`, { method: 'POST' }),
      );
      expect(foreign.status).toBe(404);
    } finally {
      userId = owner;
    }
    expect(await bolts()).toBe(18);
    const ending = await app.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/end`, { method: 'POST' }),
    );
    expect(ending.status, await ending.clone().text()).toBe(200);
    expect(await bolts()).toBe(19);
    const repeated = await app.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/end`, { method: 'POST' }),
    );
    expect(repeated.status).toBe(200);
    expect(await bolts()).toBe(19);
    const lines = await db
      .select({ message: dialogueHistory.message, context: dialogueHistory.context })
      .from(dialogueHistory)
      .where(eq(dialogueHistory.sessionId, sessionId));
    const recovery = lines.filter(
      (line) => (line.context as { intent?: string } | null)?.intent === 'ammunition_recovery',
    );
    expect(recovery).toHaveLength(1);
    expect(recovery[0].message).toBe('Recovered 1 bolt after combat.');

    // A killing shot is spent before the automatic terminal transition; one spent rounds down to zero recovered.
    const finalFight = await seat(id);
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 1 })
      .where(eq(combatParticipantStatus.participantId, finalFight.foeId));
    const finalShot = await app.handle(
      new Request(`http://localhost/v1/combat/${finalFight.encounterId}/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: {
            type: 'attack',
            actorId: finalFight.heroId,
            targetId: finalFight.foeId,
            weaponId: 'Crossbow, light',
            expectedVersion: 1,
            d20: 20,
          },
          source: 'player',
          origin: 'action_bar',
        }),
      }),
    );
    expect(finalShot.status, await finalShot.clone().text()).toBe(200);
    const [finished] = await db
      .select({ status: combatEncounters.status })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, finalFight.encounterId));
    expect(finished.status).toBe('completed');
    expect(await bolts()).toBe(18);

    // Four shots across two stacks recover two, without restoring more than was spent from either stack.
    const [firstStack] = await db
      .select({ id: characterEquipment.id })
      .from(characterEquipment)
      .where(
        and(
          eq(characterEquipment.characterId, id),
          eq(characterEquipment.itemName, 'Crossbow Bolts (20)'),
        ),
      );
    await db
      .update(characterEquipment)
      .set({ quantity: 1 })
      .where(eq(characterEquipment.id, firstStack.id));
    const [secondStack] = await db
      .insert(characterEquipment)
      .values({ characterId: id, itemName: 'Crossbow Bolts (20)', quantity: 17 })
      .returning({ id: characterEquipment.id });
    const splitFight = await seat(id);
    for (let shot = 0; shot < 4; shot++) {
      await resetTurn(splitFight.encounterId);
      const [{ version }] = await db
        .select({ version: combatEncounters.version })
        .from(combatEncounters)
        .where(eq(combatEncounters.id, splitFight.encounterId));
      const response = await app.handle(
        new Request(`http://localhost/v1/combat/${splitFight.encounterId}/intent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intent: {
              type: 'attack',
              actorId: splitFight.heroId,
              targetId: splitFight.foeId,
              weaponId: 'Crossbow, light',
              expectedVersion: version,
              d20: 5,
            },
            source: 'player',
            origin: 'action_bar',
          }),
        }),
      );
      expect(response.status).toBe(200);
    }
    const splitEnd = await app.handle(
      new Request(`http://localhost/v1/combat/${splitFight.encounterId}/end`, { method: 'POST' }),
    );
    expect(splitEnd.status).toBe(200);
    const quantities = await db
      .select({ id: characterEquipment.id, quantity: characterEquipment.quantity })
      .from(characterEquipment)
      .where(
        and(
          eq(characterEquipment.characterId, id),
          eq(characterEquipment.itemName, 'Crossbow Bolts (20)'),
        ),
      );
    expect(quantities.find((row) => row.id === firstStack.id)?.quantity).toBe(1);
    expect(quantities.find((row) => row.id === secondStack.id)?.quantity).toBe(15);
  });

  it('the legacy attack route cannot fire a crossbow without bolts (#1327)', async () => {
    const clientModule = (path: string) => import(`../../../../../src/${path}`);
    const { buildStarterCharacterSeed } = await clientModule(
      'services/character/starter-character-seeding',
    );
    const { prepareCharacterPayload } = await clientModule('services/user-data-payload-helpers');
    const [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('legacy-no-bolts') })
      .returning({ id: campaigns.id });
    cleanup.push(async () => db.delete(campaigns).where(eq(campaigns.id, campaignId)));
    const seed = buildStarterCharacterSeed(
      {
        name: 'Boltless',
        race: 'Human',
        class: 'Fighter',
        level: 1,
        background: 'Outlander',
        ability_scores: {
          strength: 10,
          dexterity: 16,
          constitution: 14,
          intelligence: 10,
          wisdom: 14,
          charisma: 8,
        },
        equipment: ['Leather Armor', 'Crossbow, light'],
        skills: [],
        languages: [],
      },
      campaignId,
    );
    const id = await create({
      ...prepareCharacterPayload(seed as unknown as Record<string, unknown>),
      name: testId('boltless'),
    });
    const { encounterId, heroId, foeId } = await seat(id);
    const [{ version }] = await db
      .select({ version: combatEncounters.version })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    const response = await app.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/attack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attackerId: heroId,
          targetId: foeId,
          weaponId: 'Crossbow, light',
          expectedVersion: version,
        }),
      }),
    );
    expect(response.status).toBe(404);
  });

  it('premade rogue without arrows: the equipped shortbow is refused for ammunition, never swapped to Unarmed (#1013)', async () => {
    const [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('premade-noammo-camp-1007') })
      .returning({ id: campaigns.id });
    cleanup.push(async () => db.delete(campaigns).where(eq(campaigns.id, campaignId)));
    // The premade payload minus its Arrows (20) row: an equipped ranged
    // weapon with no ammunition anywhere in the character's gear — the
    // exact state Grimnir was in on Hark's build.
    const noAmmoPayload = {
      ...premadeRoguePayload,
      equipment: (premadeRoguePayload.equipment as Array<{ item_name: string }>).filter(
        (row) => row.item_name !== 'Arrows (20)',
      ),
    };
    const id = await create({
      ...noAmmoPayload,
      name: testId('premade-noammo-1007'),
      campaign_id: campaignId,
    });

    const names = await equipmentRowNames(id);
    expect(names).toContain('Shortbow');
    expect(names).not.toContain('Arrows (20)');

    const { encounterId, heroId, foeId } = await seat(id);

    await resetTurn(encounterId);
    let refusal = '';
    try {
      await executeCombatIntent(
        encounterId,
        { type: 'attack', actorId: heroId, targetId: foeId, weaponId: 'Shortbow' },
        userId,
        'dm',
      );
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error);
    }
    // #1013's refusal names the missing ammunition; before it, this intent
    // resolved as an Unarmed Strike.
    expect(refusal).toContain('no arrows');
  });
});
