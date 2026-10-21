import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { eq, inArray, sql } from 'drizzle-orm';

import {
  characters,
  characterSpells,
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

const fixture = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../../shared/test-fixtures/tiefling-thaumaturgy.json',
    ),
    'utf8',
  ),
) as { create: Record<string, unknown> };

const seedPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../db/migrations/20261021_seed_spell_catalog.sql',
);

// Client slugs -> catalog ids, as SPELL_ID_MAPPING sends them (src/utils/spell-id-mapping.ts).
const FIRE_BOLT = '56f52755-929a-4d73-be52-e3c7ca60c002';
const MAGIC_MISSILE = 'cdc94dd7-2c88-43b0-bf9f-6dbd8b928a9b';
const DETECT_MAGIC = 'fff789f3-def2-5805-b17b-bdf5f78bbfcd';

describeWithDb('spell catalog seed and the Wizard spell round trip (#957)', () => {
  let app: { handle: (request: Request) => Promise<Response> };
  let db: ReturnType<typeof realDb>;
  const createdIds: string[] = [];

  beforeAll(async () => {
    userId = testId('user-957');
    db = realDb();
    const seed = readFileSync(seedPath, 'utf8');
    await db.execute(sql.raw(seed));
    await db.execute(sql.raw(seed));
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
    // Put back anything the missing-class case removed, so later suites see the full catalog.
    await db.execute(sql.raw(readFileSync(seedPath, 'utf8')));
    await closeRealDb();
  });

  async function create(): Promise<string> {
    const res = await app.handle(
      new Request('http://localhost/v1/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...fixture.create,
          name: testId('wizard-957'),
          race: 'Human',
          class: 'Wizard',
          cantrips: '',
          known_spells: '',
          prepared_spells: '',
        }),
      }),
    );
    const text = await res.text();
    expect(res.status, text.slice(0, 400)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);
    return id;
  }

  function saveSpells(id: string, className: string, spellIds: string[], prepared?: string[]) {
    return app.handle(
      new Request(`http://localhost/v1/characters/${id}/spells`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spells: spellIds, className, prepared }),
      }),
    );
  }

  it('leaves the catalog unchanged when the seed is applied again', async () => {
    // Count only the SRD classes: other suites may leave their own class rows in the shared DB.
    const srdNames = [
      'Barbarian',
      'Bard',
      'Cleric',
      'Druid',
      'Fighter',
      'Monk',
      'Paladin',
      'Ranger',
      'Rogue',
      'Sorcerer',
      'Warlock',
      'Wizard',
    ];
    const counts = () =>
      Promise.all([
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(classes)
          .where(inArray(classes.name, srdNames)),
        db.select({ n: sql<number>`count(*)::int` }).from(spells),
        db.select({ n: sql<number>`count(*)::int` }).from(classSpells),
      ]);
    const before = await counts();
    await db.execute(sql.raw(readFileSync(seedPath, 'utf8')));
    expect(await counts()).toEqual(before);
    expect(before[0][0].n).toBe(12);
  });

  it("saves a Wizard's spells through the route and reads them back", async () => {
    const id = await create();
    const saved = await saveSpells(
      id,
      'Wizard',
      [FIRE_BOLT, MAGIC_MISSILE, DETECT_MAGIC],
      [MAGIC_MISSILE, DETECT_MAGIC],
    );
    expect(saved.status, await saved.clone().text()).toBe(200);

    const rows = await db
      .select({ spellId: characterSpells.spellId, isPrepared: characterSpells.isPrepared })
      .from(characterSpells)
      .where(eq(characterSpells.characterId, id));
    expect(rows.map((row) => row.spellId).sort()).toEqual(
      [FIRE_BOLT, MAGIC_MISSILE, DETECT_MAGIC].sort(),
    );

    const read = await app.handle(new Request(`http://localhost/v1/characters/${id}/spells`));
    expect(read.status).toBe(200);
    const body = (await read.json()) as {
      cantrips: Array<{ id: string; name: string; level: number }>;
      spells: Array<{ id: string; name: string; is_prepared: boolean }>;
    };
    expect(body.cantrips).toEqual([{ id: FIRE_BOLT, name: 'Fire Bolt', level: 0 }]);
    const byName = (name: string) => body.spells.find((spell) => spell.name === name);
    expect(byName('Magic Missile')).toMatchObject({ id: MAGIC_MISSILE, is_prepared: true });
    expect(byName('Detect Magic')).toMatchObject({ id: DETECT_MAGIC, is_prepared: true });
  });

  it('answers a known class with no catalog row with a 400 the sheet can show', async () => {
    const id = await create();
    await db.delete(classes).where(eq(classes.name, 'Ranger'));
    try {
      const response = await saveSpells(id, 'Ranger', []);
      expect(response.status).toBe(400);
      expect(await response.text()).toContain(
        'The spell catalog for Ranger is not loaded on this server yet',
      );
      expect(
        await db.select().from(characterSpells).where(eq(characterSpells.characterId, id)),
      ).toHaveLength(0);
    } finally {
      await db.execute(sql.raw(readFileSync(seedPath, 'utf8')));
    }
  });
});
