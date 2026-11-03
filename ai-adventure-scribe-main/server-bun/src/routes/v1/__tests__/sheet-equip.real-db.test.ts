/**
 * #711: PUT /v1/characters/:id is the sheet Equip button's save.
 *
 * The body is sheetEquipWireBody — the same transcription the client test
 * pins for buildSheetUpdatePayload. Creation stores Chain Mail, Shield, and
 * Longsword with item_type "equipment" and equipped false, and armor_class
 * 12 (DEX 14). Equipping the shield must store equipped and AC 14
 * (10 + DEX 2 + shield 2). Equipping Chain Mail as well must store AC 18
 * (heavy 16 + shield 2, DEX ignored).
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';

import { characters, characterEquipment, characterStats } from '../../../../../db/schema/index';
import { sheetEquipWireBody } from '../../../../../shared/test-fixtures/sheet-equip-wire-body';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../services/__tests__/fixtures/real-db.ts';

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
) as Record<string, unknown>;

describeWithDb('sheet Equip PUT (#711)', () => {
  let app: { handle: (request: Request) => Promise<Response> };
  let db: ReturnType<typeof realDb>;
  const createdIds: string[] = [];

  beforeAll(async () => {
    userId = testId('user-711');
    db = realDb();
    const pipeline = await importWithRealDb(async () => {
      const { createRequestPipelineApp } = await import('../../../http-pipeline.ts');
      const { charactersRoutes } = await import('../characters.ts');
      const { issue1784DataRoutes } = await import('../issue-1784-data.ts');
      return { createRequestPipelineApp, charactersRoutes, issue1784DataRoutes };
    });
    app = pipeline
      .createRequestPipelineApp()
      .use(pipeline.charactersRoutes)
      .use(pipeline.issue1784DataRoutes);
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

  async function send(path: string, method: string, body?: unknown): Promise<Response> {
    return app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    );
  }

  type EquipmentRow = { item_name: string; quantity: number };

  async function equipmentRows(id: string): Promise<EquipmentRow[]> {
    const res = await app.handle(new Request(`http://localhost/v1/characters/${id}/equipment`));
    expect(res.status).toBe(200);
    return (await res.json()) as EquipmentRow[];
  }

  it('wears the shield at AC 14, then Chain Mail, shield and Defense at AC 19', async () => {
    const created = await send('/v1/characters', 'POST', {
      ...fighterPayload,
      name: `Equip sheet ${testId('711')}`,
      equipment: sheetEquipWireBody('00000000-0000-0000-0000-000000000000', []),
    });
    const createdText = await created.text();
    expect(created.status, createdText.slice(0, 400)).toBe(201);
    const { id } = JSON.parse(createdText) as { id: string };
    createdIds.push(id);

    const shieldOnly = await send(`/v1/characters/${id}`, 'PUT', {
      equipment: sheetEquipWireBody(id, ['Shield']),
    });
    const shieldText = await shieldOnly.text();
    expect(shieldOnly.status, shieldText.slice(0, 400)).toBe(200);

    const rowsAfterShield = await db
      .select()
      .from(characterEquipment)
      .where(eq(characterEquipment.characterId, id));
    const equipped = (name: string): boolean | null | undefined =>
      rowsAfterShield.find((row) => row.itemName === name)?.equipped;
    expect(equipped('Shield')).toBe(true);
    expect(equipped('Chain Mail')).toBe(false);
    expect(equipped('Longsword')).toBe(false);

    const [statsAfterShield] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    expect(statsAfterShield.armorClass).toBe(14);

    const armored = await send(`/v1/characters/${id}`, 'PUT', {
      equipment: sheetEquipWireBody(id, ['Shield', 'Chain Mail']),
    });
    const armoredText = await armored.text();
    expect(armored.status, armoredText.slice(0, 400)).toBe(200);

    const [statsAfterArmor] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    expect(statsAfterArmor.armorClass).toBe(19);

    const rowsAfterArmor = await db
      .select()
      .from(characterEquipment)
      .where(eq(characterEquipment.characterId, id));
    expect(rowsAfterArmor.find((row) => row.itemName === 'Chain Mail')?.equipped).toBe(true);
    expect(rowsAfterArmor.find((row) => row.itemName === 'Shield')?.equipped).toBe(true);
    expect(rowsAfterArmor.find((row) => row.itemName === 'Longsword')?.equipped).toBe(false);
  });

  it('keeps a spent-to-zero equipment row at 0 across save and reload (#1327 item 3)', async () => {
    // The spend leaves a quantity-0 row; the sheet PUT (save) must not
    // resurrect it to 1, and the equipment GET (reload) must not either.
    // The server update path preserves 0 (character-service.ts: only
    // null/undefined fall back to 1) and the read path does the same
    // (issue-1784-data-service.ts:295), so this pins the server half of
    // the round-trip; the client half is pinned by the unit tests.
    const created = await send('/v1/characters', 'POST', {
      ...fighterPayload,
      name: `Zero-row sheet ${testId('1327')}`,
      equipment: sheetEquipWireBody('00000000-0000-0000-0000-000000000000', []),
    });
    const createdText = await created.text();
    expect(created.status, createdText.slice(0, 400)).toBe(201);
    const { id } = JSON.parse(createdText) as { id: string };
    createdIds.push(id);

    const zeroRow = {
      character_id: id,
      item_name: 'Arrows',
      item_type: 'equipment',
      quantity: 0,
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
    };
    const save = async (): Promise<void> => {
      const res = await send(`/v1/characters/${id}`, 'PUT', {
        equipment: [...sheetEquipWireBody(id, []), zeroRow],
      });
      const text = await res.text();
      expect(res.status, text.slice(0, 400)).toBe(200);
    };
    const dbQuantityOf = async (name: string): Promise<number | null | undefined> => {
      const rows = await db
        .select()
        .from(characterEquipment)
        .where(eq(characterEquipment.characterId, id));
      return rows.find((row) => row.itemName === name)?.quantity;
    };

    // First save inserts the zero row; reload through the real GET route.
    await save();
    expect(await dbQuantityOf('Arrows')).toBe(0);
    const reloaded = await equipmentRows(id);
    expect(reloaded.find((row) => row.item_name === 'Arrows')?.quantity).toBe(0);
    // The untouched rows keep quantity 1.
    expect(reloaded.find((row) => row.item_name === 'Chain Mail')?.quantity).toBe(1);

    // A second save updates (rather than inserts) the row — still 0.
    await save();
    expect(await dbQuantityOf('Arrows')).toBe(0);
    const reloadedAgain = await equipmentRows(id);
    expect(reloadedAgain.find((row) => row.item_name === 'Arrows')?.quantity).toBe(0);
  });
});
