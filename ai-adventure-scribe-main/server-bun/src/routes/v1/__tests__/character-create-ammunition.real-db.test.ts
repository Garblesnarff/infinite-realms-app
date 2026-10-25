import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';

import { characters } from '../../../../../db/schema/index';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../services/__tests__/fixtures/real-db.ts';

import type * as CombatData from '../../../services/combat/data-access';

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

mock.module('../../../../../src/integrations/supabase/client.ts', () => ({ supabase: {} }));
const clientModule = (path: string) => import(`../../../../../src/${path}`);
const { getStartingEquipment } = await clientModule('data/equipment/api');
const { mapWizardEquipmentToInventory } = await clientModule('hooks/use-character-save');
const { transformEquipmentForStorage } = await clientModule('utils/characterTransformations');
const { prepareCharacterPayload } = await clientModule('services/user-data-payload-helpers');
const { characterEquipment } = await import('../../../../../db/schema/index');
let listCarriedWeaponProfiles: typeof CombatData.listCarriedWeaponProfiles;

describeWithDb('#260 creation package ammunition', () => {
  let app: any;
  const ids: string[] = [];
  beforeAll(async () => {
    userId = testId('ammo-260');
    ({ listCarriedWeaponProfiles } = await importWithRealDb(
      () => import('../../../services/combat/data-access'),
    ));
    const modules = await importWithRealDb(async () => ({
      ...(await import('../../../http-pipeline.ts')),
      ...(await import('../characters.ts')),
    }));
    app = modules.createRequestPipelineApp().use(modules.charactersRoutes);
  });
  afterAll(async () => {
    for (const id of ids) await realDb().delete(characters).where(eq(characters.id, id));
    await closeRealDb();
  });
  for (const [className, bundle, weapon, kind] of [
    ['Fighter', 'Crossbow Bolts (20)', 'crossbow', 'bolts'],
    ['Rogue', 'Arrows (20)', 'shortbow', 'arrows'],
    ['Ranger', 'Arrows (20)', 'longbow', 'arrows'],
    ['Cleric', 'Crossbow Bolts (20)', 'crossbow', 'bolts'],
    ['Sorcerer', 'Crossbow Bolts (20)', 'crossbow', 'bolts'],
    ['Warlock', 'Crossbow Bolts (20)', 'crossbow', 'bolts'],
  ] as const) {
    it(`${className} package POST stores 20 rounds of ammunition, and zero quantity makes its ranged profile unavailable`, async () => {
      const names = getStartingEquipment(className).map((item: { name: string }) => item.name);
      const character = { equipment: names } as any;
      const equipment = transformEquipmentForStorage(
        { ...character, inventory: mapWizardEquipmentToInventory(character) },
        '00000000-0000-0000-0000-000000000000',
      );
      const body = prepareCharacterPayload({
        name: testId(className),
        class: className,
        race: 'Human',
        level: 1,
        stats: {
          strength: 14,
          dexterity: 14,
          constitution: 14,
          intelligence: 10,
          wisdom: 10,
          charisma: 10,
        },
        equipment,
      });
      const response = await app.handle(
        new Request('http://localhost/v1/characters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
      expect(response.status).toBe(201);
      const { id } = await response.json();
      ids.push(id);
      const rows = await realDb()
        .select()
        .from(characterEquipment)
        .where(eq(characterEquipment.characterId, id));
      const ammo = rows.find((row) => row.itemName === bundle);
      expect(ammo?.quantity).toBe(1);
      const profile = (await listCarriedWeaponProfiles({ characterId: id })).find((p) =>
        p.name.toLowerCase().includes(weapon),
      );
      expect(profile).toBeDefined();
      expect(profile?.missingAmmunition).toBeUndefined();
      await realDb()
        .update(characterEquipment)
        .set({ quantity: 0 })
        .where(eq(characterEquipment.id, ammo!.id));
      const empty = (await listCarriedWeaponProfiles({ characterId: id })).find((p) =>
        p.name.toLowerCase().includes(weapon),
      );
      expect(empty?.missingAmmunition).toBe(kind);
    });
  }
});
