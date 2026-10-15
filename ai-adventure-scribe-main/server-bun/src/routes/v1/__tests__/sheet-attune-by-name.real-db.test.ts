/**
 * #619: the sheet attunes an item the wizard stored on character_equipment.
 *
 * The character sheet (`transformCharacterData`) sends the equipment row id.
 * The game loader (`equipmentRowsToInventory`) sends the item name. Both go to
 * POST /v1/characters/:id/attune/:itemId, which used to look up inventory_items.id.
 * A wizard item is not an inventory_items row, so the route answered "Item not found".
 *
 * Fixture: the pinned Hill Dwarf Fighter create body (the wizard producer,
 * shared/test-fixtures/hill-dwarf-fighter-create-payload.json) plus two rows
 * copied from that body's equipment objects with attunement turned on. That is
 * the field set transformEquipmentForStorage writes.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { Elysia } from 'elysia';

import { characters, characterEquipment, inventoryItems } from '../../../../../db/schema/index';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../services/__tests__/fixtures/real-db.js';

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
mock.module('../../../middleware/rate-limit.js', () => ({
  planRateLimit: () => new Elysia({ name: 'test-plan-rate-limit' }),
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
) as { equipment: Array<Record<string, unknown>> } & Record<string, unknown>;

/** Same object the wizard payload already sends, with the attunement flags a magic item carries. */
const magicEquipmentRow = (itemName: string): Record<string, unknown> => ({
  ...fighterPayload.equipment[0],
  item_name: itemName,
  equipped: true,
  is_magic: true,
  requires_attunement: true,
  is_attuned: false,
});

const CLOAK = 'Cloak of Protection';
const RING = 'Ring of Protection';

describeWithDb('sheet attune resolves the equipment row, not inventory_items.id (#619)', () => {
  let app: { handle: (request: Request) => Promise<Response> };
  let db: ReturnType<typeof realDb>;
  let characterId = '';

  const request = async (path: string, method: string, body?: unknown) =>
    app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    );

  beforeAll(async () => {
    userId = testId('user-619');
    db = realDb();
    const pipeline = await importWithRealDb(async () => {
      const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
      const { charactersRoutes } = await import('../characters.js');
      const { inventoryRoutes } = await import('../inventory.js');
      const { issue1784DataRoutes } = await import('../issue-1784-data.js');
      return createRequestPipelineApp()
        .use(charactersRoutes)
        .use(inventoryRoutes)
        .use(issue1784DataRoutes);
    });
    app = pipeline;

    const created = await request('/v1/characters', 'POST', {
      ...fighterPayload,
      name: `Attune Fighter ${userId}`,
      equipment: [...fighterPayload.equipment, magicEquipmentRow(CLOAK), magicEquipmentRow(RING)],
    });
    const createdText = await created.text();
    expect(created.status, createdText.slice(0, 400)).toBe(201);
    characterId = (JSON.parse(createdText) as { id: string }).id;
  });

  afterAll(async () => {
    if (characterId) {
      await db.delete(characters).where(eq(characters.id, characterId));
    }
    await closeRealDb();
  });

  it('attunes by item name and by the equipment row id the sheet sends', async () => {
    const stored = await db
      .select()
      .from(inventoryItems)
      .where(and(eq(inventoryItems.characterId, characterId), eq(inventoryItems.name, CLOAK)));
    expect(stored).toHaveLength(0);

    const equipmentResponse = await request(`/v1/characters/${characterId}/equipment`, 'GET');
    const equipmentText = await equipmentResponse.text();
    expect(equipmentResponse.status, equipmentText.slice(0, 400)).toBe(200);
    const rows = JSON.parse(equipmentText) as Array<{ id: string; item_name: string }>;
    const cloakId = rows.find((row) => row.item_name === CLOAK)?.id ?? '';
    const ringId = rows.find((row) => row.item_name === RING)?.id ?? '';
    expect(cloakId).not.toBe('');
    expect(ringId).not.toBe('');

    const byName = await request(
      `/v1/characters/${characterId}/attune/${encodeURIComponent(CLOAK)}`,
      'POST',
    );
    const byNameText = await byName.text();
    expect(byName.status, byNameText.slice(0, 400)).toBe(200);

    const byRowId = await request(
      `/v1/characters/${characterId}/attune/${encodeURIComponent(ringId)}`,
      'POST',
    );
    const byRowIdText = await byRowId.text();
    expect(byRowId.status, byRowIdText.slice(0, 400)).toBe(200);

    const attuned = await db
      .select({ itemName: characterEquipment.itemName, isAttuned: characterEquipment.isAttuned })
      .from(characterEquipment)
      .where(eq(characterEquipment.characterId, characterId));
    expect(attuned.find((row) => row.itemName === CLOAK)?.isAttuned).toBe(true);
    expect(attuned.find((row) => row.itemName === RING)?.isAttuned).toBe(true);

    const kit = await request(
      `/v1/characters/${characterId}/attune/${encodeURIComponent('Longsword')}`,
      'POST',
    );
    const kitText = await kit.text();
    expect(kit.status, kitText.slice(0, 400)).toBe(400);
    expect(kitText).toContain('does not require attunement');

    // Same display name on the story-grant table. The sheet breaks attunement
    // with the equipment row id, and that must clear this row too.
    await db.insert(inventoryItems).values({
      characterId,
      name: CLOAK,
      itemType: 'equipment',
      requiresAttunement: true,
      isAttuned: true,
    });

    const unattuneCloak = await request(
      `/v1/characters/${characterId}/attune/${encodeURIComponent(cloakId)}`,
      'DELETE',
    );
    expect(unattuneCloak.status, (await unattuneCloak.text()).slice(0, 400)).toBe(200);
    const [mirror] = await db
      .select({ isAttuned: inventoryItems.isAttuned })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.characterId, characterId), eq(inventoryItems.name, CLOAK)));
    expect(mirror?.isAttuned).toBe(false);
    const unattuneRing = await request(
      `/v1/characters/${characterId}/attune/${encodeURIComponent(ringId)}`,
      'DELETE',
    );
    expect(unattuneRing.status, (await unattuneRing.text()).slice(0, 400)).toBe(200);

    const cleared = await db
      .select({ itemName: characterEquipment.itemName, isAttuned: characterEquipment.isAttuned })
      .from(characterEquipment)
      .where(eq(characterEquipment.characterId, characterId));
    expect(cleared.find((row) => row.itemName === CLOAK)?.isAttuned).toBe(false);
    expect(cleared.find((row) => row.itemName === RING)?.isAttuned).toBe(false);
  });
});
