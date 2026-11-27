/**
 * Real-DB test for #1803: saving a character with the two RETIRED spell ids
 * stores the CANONICAL spell ids instead.
 *
 * Retired Tasha's Hideous Laughter (2f531b61…) -> canonical Hideous Laughter
 * (49679c17…); retired Tenser's Floating Disk (ce62cea7…) -> canonical Floating
 * Disk (14bccb17…). The mapping lives in CharacterSpellService.saveCharacterSpells
 * (server-bun/src/services/character/character-spell-service.ts) and runs before
 * validation, so the save keeps the spell under the canonical id — and, once
 * migration 0042 removes the retired rows, instead of failing on the
 * character_spells -> spells foreign key.
 *
 * Mirrors server-bun/src/routes/v1/__tests__/character-save-canonical-spells.real-db.test.ts
 * (#1784), which posts the canonical ids; this test posts the retired ids and
 * asserts the same stored result. The retired rows need not exist for this test
 * (mapping happens before validation) — it already proves the post-migration
 * world. The migration itself is covered by
 * spell-duplicate-rows-migration-0042.real-db.test.ts.
 */
import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';

import {
  characterSpells,
  characterStats,
  characters,
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

describeWithDb('#1803: a character saves the retired spell ids', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const runUserId = testId('retired-spell-ids-user');
  let characterId = '';
  let wizardClassId = '';

  beforeAll(async () => {
    userId = runUserId;
    await grantLegendPlan(userId);

    // Test class the wizard links to (mirrors the #1784 TestWizard254 class).
    await db
      .insert(classes)
      .values({
        name: 'TestWizard1803',
        hitDie: 6,
        spellcastingAbility: 'INT',
        casterType: 'full',
      })
      .onConflictDoNothing();
    const [wizardClass] = await db
      .select({ id: classes.id })
      .from(classes)
      .where(eq(classes.name, 'TestWizard1803'))
      .limit(1);
    // Fail loudly here (not as a cryptic TypeError below) if the class
    // insert did not land.
    expect(wizardClass).toBeDefined();
    wizardClassId = wizardClass.id;

    // Seed the canonical spell rows + class links (idempotent; the
    // spell-catalog-seed suite applies the same seed SQL to this shared
    // scratch DB, so the rows may already exist).
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
    // catalog rows the spell-catalog-seed suite also writes.
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

  it('stores the canonical ids when the retired ids are posted', async () => {
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
          name: 'Retired Spell Ids Wizard 1803',
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

    // 2. Save through the real route with exactly the body a direct API
    // caller would send: the raw retired ids in `spells`, the retired
    // Tasha's id in `prepared`.
    const saveRes = await app.handle(
      new Request(`http://localhost/v1/characters/${characterId}/spells`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          spells: [RETIRED_TASHAS_ID, RETIRED_TENSERS_ID],
          prepared: [RETIRED_TASHAS_ID],
          className: 'TestWizard1803',
        }),
      }),
    );
    expect(saveRes.status).toBe(200);
    expect(((await saveRes.json()) as { success: boolean }).success).toBe(true);

    // 3. The character_spells rows land with the canonical ids only — no
    // retired id was ever written.
    const rows = await db
      .select({ spellId: characterSpells.spellId, isPrepared: characterSpells.isPrepared })
      .from(characterSpells)
      .where(eq(characterSpells.characterId, characterId));
    expect(rows.map((r) => r.spellId).sort()).toEqual(
      [FLOATING_DISK_ID, HIDEOUS_LAUGHTER_ID].sort(),
    );
    expect(rows.map((r) => r.spellId)).not.toContain(RETIRED_TASHAS_ID);
    expect(rows.map((r) => r.spellId)).not.toContain(RETIRED_TENSERS_ID);

    // Prepared follows the canonical id: Hideous Laughter prepared, Floating
    // Disk not (only the retired Tasha's id was in `prepared`).
    const byId = new Map(rows.map((r) => [r.spellId, r.isPrepared]));
    expect(byId.get(HIDEOUS_LAUGHTER_ID)).toBe(true);
    expect(byId.get(FLOATING_DISK_ID)).toBe(false);

    // 4. The sheet read shows both canonical spell names.
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
