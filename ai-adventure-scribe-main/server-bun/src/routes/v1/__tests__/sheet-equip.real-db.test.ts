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

  async function send(path: string, method: string, body?: unknown): Promise<Response> {
    return app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    );
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
});
