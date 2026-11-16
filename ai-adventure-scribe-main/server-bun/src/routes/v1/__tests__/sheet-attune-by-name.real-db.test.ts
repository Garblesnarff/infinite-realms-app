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
import { and, eq, isNull } from 'drizzle-orm';
import { Elysia } from 'elysia';

import {
  characters,
  characterEquipment,
  inventoryItems,
  restEvents,
} from '../../../../../db/schema/index';
import { sheetAttunePath } from '../../../../../shared/test-fixtures/sheet-attune-wire';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
  grantLegendPlan,
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

  const grantShortRest = async () => {
    await db.insert(restEvents).values({
      characterId,
      restType: 'short',
      startedAt: new Date(),
      completedAt: new Date(),
      interrupted: false,
      hpRestored: 0,
      hitDiceSpent: 0,
      notes: null,
    });
  };

  beforeAll(async () => {
    userId = testId('user-619');
    await grantLegendPlan(userId);
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

    await grantShortRest();
    await grantShortRest();

    const byName = await request(sheetAttunePath(characterId, CLOAK), 'POST');
    const byNameText = await byName.text();
    expect(byName.status, byNameText.slice(0, 400)).toBe(200);

    const byRowId = await request(sheetAttunePath(characterId, ringId), 'POST');
    const byRowIdText = await byRowId.text();
    expect(byRowId.status, byRowIdText.slice(0, 400)).toBe(200);

    const attuned = await db
      .select({ itemName: characterEquipment.itemName, isAttuned: characterEquipment.isAttuned })
      .from(characterEquipment)
      .where(eq(characterEquipment.characterId, characterId));
    expect(attuned.find((row) => row.itemName === CLOAK)?.isAttuned).toBe(true);
    expect(attuned.find((row) => row.itemName === RING)?.isAttuned).toBe(true);

    const kit = await request(sheetAttunePath(characterId, 'Longsword'), 'POST');
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

    const unattuneCloak = await request(sheetAttunePath(characterId, cloakId), 'DELETE');
    expect(unattuneCloak.status, (await unattuneCloak.text()).slice(0, 400)).toBe(200);
    const [mirror] = await db
      .select({ isAttuned: inventoryItems.isAttuned })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.characterId, characterId), eq(inventoryItems.name, CLOAK)));
    expect(mirror?.isAttuned).toBe(false);
    const unattuneRing = await request(sheetAttunePath(characterId, ringId), 'DELETE');
    expect(unattuneRing.status, (await unattuneRing.text()).slice(0, 400)).toBe(200);

    const cleared = await db
      .select({ itemName: characterEquipment.itemName, isAttuned: characterEquipment.isAttuned })
      .from(characterEquipment)
      .where(eq(characterEquipment.characterId, characterId));
    expect(cleared.find((row) => row.itemName === CLOAK)?.isAttuned).toBe(false);
    expect(cleared.find((row) => row.itemName === RING)?.isAttuned).toBe(false);
  });

  it('refuses attune when no short rest is recorded and does not take one', async () => {
    await db
      .delete(restEvents)
      .where(and(eq(restEvents.characterId, characterId), isNull(restEvents.notes)));
    const [helm] = await db
      .insert(characterEquipment)
      .values({
        characterId,
        itemName: 'Helm of Telepathy',
        itemType: 'equipment',
        quantity: 1,
        equipped: true,
        isMagic: true,
        requiresAttunement: true,
        isAttuned: false,
      })
      .returning({ id: characterEquipment.id });
    const before = await db
      .select({ id: restEvents.id })
      .from(restEvents)
      .where(eq(restEvents.characterId, characterId));

    const response = await request(sheetAttunePath(characterId, helm.id), 'POST');
    const text = await response.text();
    expect(response.status, text.slice(0, 400)).toBe(400);
    expect(text).toContain('Attunement needs a short rest spent on this item');

    const [row] = await db
      .select({ isAttuned: characterEquipment.isAttuned })
      .from(characterEquipment)
      .where(eq(characterEquipment.id, helm.id));
    expect(row?.isAttuned).toBe(false);
    const after = await db
      .select({ id: restEvents.id })
      .from(restEvents)
      .where(eq(restEvents.characterId, characterId));
    expect(after).toHaveLength(before.length);
  });

  it('attunes an inventory_items row by its id and holds the 3-item cap across both tables', async () => {
    const [wand] = await db
      .insert(inventoryItems)
      .values({
        characterId,
        name: 'Wand of Magic Missiles',
        itemType: 'equipment',
        requiresAttunement: true,
        isAttuned: false,
      })
      .returning({ id: inventoryItems.id });
    const [staff] = await db
      .insert(inventoryItems)
      .values({
        characterId,
        name: 'Staff of Power',
        itemType: 'equipment',
        requiresAttunement: true,
        isAttuned: false,
      })
      .returning({ id: inventoryItems.id });

    await grantShortRest();
    await grantShortRest();
    await grantShortRest();
    await grantShortRest();

    const equipment = await db
      .select({ id: characterEquipment.id, itemName: characterEquipment.itemName })
      .from(characterEquipment)
      .where(eq(characterEquipment.characterId, characterId));
    const cloakId = equipment.find((row) => row.itemName === CLOAK)?.id ?? '';
    const ringId = equipment.find((row) => row.itemName === RING)?.id ?? '';

    const wandResponse = await request(sheetAttunePath(characterId, wand.id), 'POST');
    expect(wandResponse.status, (await wandResponse.text()).slice(0, 400)).toBe(200);
    const cloakResponse = await request(sheetAttunePath(characterId, cloakId), 'POST');
    expect(cloakResponse.status, (await cloakResponse.text()).slice(0, 400)).toBe(200);
    const ringResponse = await request(sheetAttunePath(characterId, ringId), 'POST');
    expect(ringResponse.status, (await ringResponse.text()).slice(0, 400)).toBe(200);

    const fourth = await request(sheetAttunePath(characterId, staff.id), 'POST');
    const fourthText = await fourth.text();
    expect(fourth.status, fourthText.slice(0, 400)).toBe(400);
    expect(fourthText).toContain('Cannot attune to more than 3');

    const [staffRow] = await db
      .select({ isAttuned: inventoryItems.isAttuned })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, staff.id));
    expect(staffRow?.isAttuned).toBe(false);
    const openRests = await db
      .select({ id: restEvents.id })
      .from(restEvents)
      .where(and(eq(restEvents.characterId, characterId), isNull(restEvents.notes)));
    expect(openRests.length).toBeGreaterThan(0);

    const [spent] = await db
      .select({ notes: restEvents.notes })
      .from(restEvents)
      .where(eq(restEvents.notes, `attunement:${wand.id}`));
    expect(spent?.notes).toBe(`attunement:${wand.id}`);
  });

  it('does not attune an item owned by someone else', async () => {
    const otherUserId = testId('other-619');
    await db
      .update(characters)
      .set({ userId: otherUserId, ownerId: otherUserId })
      .where(eq(characters.id, characterId));
    try {
      const [cloak] = await db
        .select({ id: characterEquipment.id })
        .from(characterEquipment)
        .where(
          and(
            eq(characterEquipment.characterId, characterId),
            eq(characterEquipment.itemName, CLOAK),
          ),
        );
      const response = await request(sheetAttunePath(characterId, cloak.id), 'POST');
      const text = await response.text();
      expect(response.status, text.slice(0, 400)).toBe(400);
      expect(text).toContain('Item not found');
    } finally {
      await db
        .update(characters)
        .set({ userId, ownerId: userId })
        .where(eq(characters.id, characterId));
    }
  });
});
