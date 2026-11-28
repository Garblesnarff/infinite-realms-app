/**
 * #254 round 1: a character saves both canonical spells against a real database.
 *
 * Round 0 made the SRD id canonical and the save converter writes those
 * UUIDs into `character_spells` — an insert that fails on the foreign key
 * if prod `spells` has no such rows. Hetzner confirmed on #254 (comment
 * 7209639615) that prod DOES hold both canonical rows (Hideous Laughter
 * `49679c17…`, Floating Disk `14bccb17…`), plus the two retired duplicates.
 *
 * This suite proves the save end-to-end through the real route, with the
 * spell rows seeded at exactly the prod canonical UUIDs: POST
 * /v1/characters creates the wizard, POST /v1/characters/:id/spells saves
 * both spells, the `character_spells` rows land with the canonical ids
 * (not the retired UUIDs), and the sheet read shows both spells back.
 * The spell ids are the ones the client save converter
 * (`convertSpellIdsToDatabase`, fed by `spell-id-mapping.ts`) sends.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

import {
  characters,
  characterSpells,
  characterStats,
  classes,
  classSpells,
  spells,
} from '../../../../../db/schema/index';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
  grantLegendPlan,
} from '../../../services/__tests__/fixtures/real-db.ts';

// Canonical prod spell ids (Hetzner check, #254 comment 7209639615).
const HIDEOUS_LAUGHTER_ID = '49679c17-4b59-5e1b-b9a2-8ed2f53f209e';
const FLOATING_DISK_ID = '14bccb17-1728-5095-ab6a-35b28812c6b7';
// Retired duplicate UUIDs — no character_spells row may hold these after a save.
const RETIRED_TASHAS_ID = '2f531b61-5626-5b7b-a9f9-bf935e580864';
const RETIRED_TENSERS_ID = 'ce62cea7-640b-5439-a175-10289409f59b';

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
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer test-token-254'
      ? {
          user: { userId, email: 'user@example.test', plan: 'free' },
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

if (hasRealDb) {
  process.env.CORS_ORIGIN ??= 'http://localhost:5173';
  process.env.WORKOS_API_KEY ??= 'test-workos-api-key';
  process.env.WORKOS_CLIENT_ID ??= 'test-workos-client-id';
  process.env.PORT ??= '8888';
}

const authHeaders = {
  authorization: 'Bearer test-token-254',
  'content-type': 'application/json',
};

describeWithDb('#254 round 1: a character saves both canonical spells', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const runUserId = testId('canonical-spells-user');
  let characterId = '';
  let wizardClassId = '';

  beforeAll(async () => {
    userId = runUserId;
    await grantLegendPlan(userId);

    // Seed the class row. The name is test-scoped (TestWizard254) so a
    // shared scratch DB never collides with another suite's 'Wizard' row;
    // the save looks the class up by the name it is handed, so the
    // spell-id behaviour under test is identical.
    await db
      .insert(classes)
      .values({
        name: 'TestWizard254',
        hitDie: 6,
        spellcastingAbility: 'INT',
        casterType: 'full',
      })
      .onConflictDoNothing();
    const [wizardClass] = await db
      .select({ id: classes.id })
      .from(classes)
      .where(eq(classes.name, 'TestWizard254'))
      .limit(1);
    wizardClassId = wizardClass.id;

    // Seed the two canonical spell rows at exactly the prod UUIDs (the
    // seed file holds them under these ids). onConflictDoNothing: the
    // spell-catalog-seed suite applies the same seed SQL to this shared
    // scratch DB, so the rows may already exist.
    await db
      .insert(spells)
      .values([
        {
          id: HIDEOUS_LAUGHTER_ID,
          name: 'Hideous Laughter',
          level: 1,
          school: 'Enchantment',
          castingTime: '1 action',
          rangeText: '30 feet',
          duration: 'Up to 1 minute',
          description: 'The target perceives everything as hilariously funny.',
        },
        {
          id: FLOATING_DISK_ID,
          name: 'Floating Disk',
          level: 1,
          school: 'Conjuration',
          castingTime: '1 action',
          rangeText: '30 feet',
          duration: '1 hour',
          description: 'A circular, horizontal plane of force floats above the ground.',
        },
      ])
      .onConflictDoNothing();

    // Fail loudly here (not as a cryptic FK error in the classSpells
    // insert below) if the canonical rows are not in the DB.
    const seeded = await db
      .select({ id: spells.id })
      .from(spells)
      .where(inArray(spells.id, [HIDEOUS_LAUGHTER_ID, FLOATING_DISK_ID]));
    expect(seeded).toHaveLength(2);

    // Link both spells to the class (spell_level is required). The save
    // route validates each id against class_spells for the class.
    for (const spellId of [HIDEOUS_LAUGHTER_ID, FLOATING_DISK_ID]) {
      await db
        .insert(classSpells)
        .values({ classId: wizardClassId, spellId, spellLevel: 1 })
        .onConflictDoNothing();
    }
  });

  afterAll(async () => {
    // Delete every row this suite created, in reverse dependency order.
    // The two canonical spell rows are NOT deleted: they are shared
    // catalog rows the spell-catalog-seed suite also writes, and deleting
    // them would race a concurrent seed run. They are identified by
    // well-known prod UUIDs, so a re-run reuses them via onConflictDoNothing.
    if (characterId) {
      await db.delete(characterSpells).where(eq(characterSpells.characterId, characterId));
      await db.delete(characterStats).where(eq(characterStats.characterId, characterId));
      await db.delete(characters).where(eq(characters.id, characterId));
    }
    if (wizardClassId) {
      await db.delete(classSpells).where(eq(classSpells.classId, wizardClassId));
      await db.delete(classes).where(eq(classes.id, wizardClassId));
    }
    await closeRealDb();
  });

  it('saves Hideous Laughter + Floating Disk under the canonical ids', async () => {
    const { createRequestPipelineApp, charactersRoutes } = await importWithRealDb(async () => ({
      ...(await import('../../../http-pipeline.ts')),
      ...(await import('../characters.ts')),
    }));
    const app = createRequestPipelineApp().use(charactersRoutes);

    // 1. Create the wizard through the real route (the real producer of
    // the character row).
    const createRes = await app.handle(
      new Request('http://localhost/v1/characters', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          name: 'Canonical Spells Wizard 254',
          class: 'Wizard',
          level: 1,
          race: 'Human',
          stats: {
            strength: 10,
            dexterity: 12,
            constitution: 14,
            intelligence: 15,
            wisdom: 15,
            charisma: 15,
          },
        }),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };
    characterId = created.id;

    // 2. Save both spells through the real route, with exactly the ids
    // the client save converter sends (the canonical UUIDs). Without the
    // prod spells rows this insert fails on the character_spells -> spells
    // foreign key; Hetzner confirmed prod holds both rows.
    const saveRes = await app.handle(
      new Request(`http://localhost/v1/characters/${characterId}/spells`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          spells: [HIDEOUS_LAUGHTER_ID, FLOATING_DISK_ID],
          className: 'TestWizard254',
        }),
      }),
    );
    expect(saveRes.status).toBe(200);
    expect(((await saveRes.json()) as { success: boolean }).success).toBe(true);

    // 3. The character_spells rows land with the canonical ids.
    const rows = await db
      .select({ spellId: characterSpells.spellId })
      .from(characterSpells)
      .where(eq(characterSpells.characterId, characterId));
    expect(rows.map((r) => r.spellId).sort()).toEqual(
      [FLOATING_DISK_ID, HIDEOUS_LAUGHTER_ID].sort(),
    );
    expect(rows.map((r) => r.spellId)).not.toContain(RETIRED_TASHAS_ID);
    expect(rows.map((r) => r.spellId)).not.toContain(RETIRED_TENSERS_ID);

    // 4. The sheet read shows both spells back.
    const getRes = await app.handle(
      new Request(`http://localhost/v1/characters/${characterId}/spells`, {
        headers: authHeaders,
      }),
    );
    expect(getRes.status).toBe(200);
    const sheet = (await getRes.json()) as {
      spells: Array<{ id: string; name: string }>;
    };
    expect(sheet.spells.map((s) => s.name).sort()).toEqual(['Floating Disk', 'Hideous Laughter']);
  });
});
