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

import { characters, characterEquipment, characterStats } from '../../../../../db/schema/index';
import fighterChoices from '../../../../../shared/test-fixtures/fighter-package-choices.json';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../services/__tests__/fixtures/real-db.ts';

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
