/**
 * #319: export a character as JSON and import it as a new character, against a real database,
 * through the real character routes. Auth is stubbed. CharacterService is not.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';

import {
  characterEquipment,
  characterPermissions,
  characterStats,
  characters,
  inventoryItems,
} from '../../../../../db/schema/index';
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
let otherUserId = '';

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer test-token'
      ? {
          user: {
            userId: request.headers.get('x-test-user') === 'other' ? otherUserId : userId,
            email: 'user@example.test',
            plan: 'free',
          },
          error: null,
        }
      : { user: null, error: 'Unauthorized' },
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

// #205: the pipeline below mounts issue1784DataRoutes, whose service executes
// a module-scope sql`` template; the db proxy validates the full server env
// on first use, and the real-DB CI job does not provide CORS_ORIGIN,
// WORKOS_API_KEY, WORKOS_CLIENT_ID, or PORT. Dummy values only — real values
// win via ??=, and nothing here is a secret.
if (hasRealDb) {
  process.env.CORS_ORIGIN ??= 'http://localhost:5173';
  process.env.WORKOS_API_KEY ??= 'test-workos-api-key';
  process.env.WORKOS_CLIENT_ID ??= 'test-workos-client-id';
  process.env.PORT ??= '8888';
}

const pipeline = await importWithRealDb(async () => {
  const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
  const { charactersRoutes } = await import('../characters.js');
  return createRequestPipelineApp().use(charactersRoutes);
});

if (!hasRealDb) {
  console.warn(
    '[character-json-export-import] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

const authHeaders = {
  authorization: 'Bearer test-token',
  'content-type': 'application/json',
};

describeWithDb('character JSON export and import (#319)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const createdIds: string[] = [];

  beforeAll(() => {
    userId = testId('export-owner');
    otherUserId = testId('export-other');
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    for (const id of createdIds) {
      try {
        await db.delete(characterPermissions).where(eq(characterPermissions.characterId, id));
        await db.delete(characters).where(eq(characters.id, id));
      } catch {
        /* fixture teardown is best-effort */
      }
    }
    await closeRealDb();
  });

  const request = (path: string, method: string, body?: unknown, as?: 'other'): Promise<Response> =>
    pipeline.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: as ? { ...authHeaders, 'x-test-user': as } : authHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );

  const wizardBody = {
    name: 'Export Roundtrip Rogue',
    race: 'Halfling',
    class: 'Rogue',
    level: 3,
    background: 'Criminal',
    cantrips: 'Mage Hand',
    stats: {
      strength: 8,
      dexterity: 17,
      constitution: 12,
      intelligence: 10,
      wisdom: 13,
      charisma: 14,
      max_hit_points: 21,
      current_hit_points: 15,
    },
    equipment: [{ item_name: 'Shortsword', item_type: 'weapon', quantity: 1, equipped: true }],
    inventory_items: [{ name: 'Rope', item_type: 'equipment', quantity: 2, weight: 5 }],
  };

  const makeCharacter = async (): Promise<string> => {
    const res = await request('/v1/characters', 'POST', wizardBody);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    createdIds.push(id);
    return id;
  };

  it('exports the sheet, inventory and spells with no ids, owner or campaign link', async () => {
    const id = await makeCharacter();
    const res = await request(`/v1/characters/${id}/export`, 'GET');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('attachment');
    const file = (await res.json()) as Record<string, any>;
    expect(file.format).toBe('infinite-realms.character');
    expect(file.version).toBe(1);
    expect(file.character.name).toBe('Export Roundtrip Rogue');
    expect(file.character.cantrips).toBe('Mage Hand');
    expect(file.character.stats.dexterity).toBe(17);
    expect(file.character.equipment[0].item_name).toBe('Shortsword');
    expect(file.character.inventory_items[0].name).toBe('Rope');
    const text = JSON.stringify(file);
    for (const forbidden of [
      '"id"',
      'user_id',
      'owner_id',
      'campaign_id',
      'folder_id',
      userId,
      id,
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('imports an export as a new character owned by the caller, with the same sheet', async () => {
    const id = await makeCharacter();
    const file = await (await request(`/v1/characters/${id}/export`, 'GET')).json();

    const imported = await request('/v1/characters/import', 'POST', file, 'other');
    expect(imported.status).toBe(201);
    const created = (await imported.json()) as { id: string; user_id: string };
    createdIds.push(created.id);
    expect(created.id).not.toBe(id);
    expect(created.user_id).toBe(otherUserId);

    const again = await (
      await request(`/v1/characters/${created.id}/export`, 'GET', undefined, 'other')
    ).json();
    expect(again.character).toEqual(file.character);

    const rows = await db
      .select()
      .from(characterEquipment)
      .where(eq(characterEquipment.characterId, created.id));
    expect(rows.map((r) => r.itemName)).toEqual(['Shortsword']);
    const inv = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.characterId, created.id));
    expect(inv.map((r) => r.name)).toEqual(['Rope']);
    const stats = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, created.id));
    expect(stats[0]?.dexterity).toBe(17);
  });

  it('writes default ability scores when an import omits stats', async () => {
    const imported = await request(
      '/v1/characters/import',
      'POST',
      {
        format: 'infinite-realms.character',
        version: 1,
        character: { name: `Imported without stats ${testId('1232')}`, class: 'Bard', level: 1 },
      },
      'other',
    );
    expect(imported.status).toBe(201);
    const created = (await imported.json()) as { id: string };
    createdIds.push(created.id);

    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, created.id));
    expect(stats).toEqual(
      expect.objectContaining({
        strength: 10,
        dexterity: 10,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      }),
    );
  });

  it("refuses to export another user's character and one shared with the caller", async () => {
    const id = await makeCharacter();
    expect((await request(`/v1/characters/${id}/export`, 'GET', undefined, 'other')).status).toBe(
      404,
    );

    await db
      .insert(characterPermissions)
      .values({ characterId: id, userId: otherUserId, grantedBy: userId });
    expect((await request(`/v1/characters/${id}/export`, 'GET', undefined, 'other')).status).toBe(
      404,
    );
  });

  it('ignores ids, owners, a campaign link and slot state carried in a file; rejects a wrong format', async () => {
    const campaignId = '00000000-0000-4000-8000-000000000319';
    const res = await request(
      '/v1/characters/import',
      'POST',
      {
        format: 'infinite-realms.character',
        version: 1,
        character: {
          name: 'Smuggler',
          id: '00000000-0000-4000-8000-0000000000aa',
          user_id: 'someone-else',
          owner_id: 'someone-else',
          campaign_id: campaignId,
          spell_slots: { 1: { total: 9, used: 0 } },
        },
      },
      'other',
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    createdIds.push(created.id as string);
    expect(created.id).not.toBe('00000000-0000-4000-8000-0000000000aa');
    expect(created.user_id).toBe(otherUserId);
    expect(created.owner_id).toBe(otherUserId);
    expect(created.campaign_id).toBeNull();
    expect(created.spell_slots).toBeNull();

    const file = { format: 'infinite-realms.character', version: 1, character: { name: 'Bad' } };
    expect(
      (await request('/v1/characters/import', 'POST', { ...file, format: 'other' })).status,
    ).toBe(422);
    expect((await request('/v1/characters/import', 'POST', { ...file, version: 2 })).status).toBe(
      422,
    );
    expect(
      (await request('/v1/characters/import', 'POST', { ...file, character: { level: 3 } })).status,
    ).toBe(422);
    expect(
      (
        await request('/v1/characters/import', 'POST', {
          ...file,
          character: { name: 'X', level: 99 },
        })
      ).status,
    ).toBe(422);
  });
});
