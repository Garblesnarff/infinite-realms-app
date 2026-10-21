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
      expect(rows.flatMap((row) => Array(row.quantity ?? 1).fill(row.itemName)).sort()).toEqual(
        [...fixture.equipmentNames].sort(),
      );
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
      ).toEqual([...fixture.equipmentNames].sort());
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
