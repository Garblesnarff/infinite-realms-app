import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { eq, sql } from 'drizzle-orm';

import { characters, characterSpells, classes, spells } from '../../../../../db/schema/index';
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
      '../../../../../shared/test-fixtures/tiefling-thaumaturgy.json',
    ),
    'utf8',
  ),
) as {
  create: Record<string, unknown>;
  spells: { spells: string[]; className: string; prepared: string[] };
};

describeWithDb('racial Thaumaturgy route round trip (#933)', () => {
  let app: { handle: (request: Request) => Promise<Response> };
  let db: ReturnType<typeof realDb>;
  const createdIds: string[] = [];

  beforeAll(async () => {
    userId = testId('user-710');
    db = realDb();
    await db
      .insert(classes)
      .values([
        { name: 'Wizard', hitDie: 6 },
        { name: 'Fighter', hitDie: 10 },
        { name: 'Cleric', hitDie: 8 },
      ])
      .onConflictDoNothing();
    const seed = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../../../../db/migrations/20261021_seed_thaumaturgy.sql',
      ),
      'utf8',
    );
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

  for (const className of ['Wizard', 'Fighter']) {
    it(`saves and reloads a level-one Tiefling ${className}'s racial cantrip`, async () => {
      const id = await create({ ...fighterPayload.create, class: className });
      const response = await app.handle(
        new Request(`http://localhost/v1/characters/${id}/spells`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...fighterPayload.spells, className }),
        }),
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const rows = await db
        .select()
        .from(characterSpells)
        .where(eq(characterSpells.characterId, id));
      expect(rows).toHaveLength(1);
      expect(rows[0].spellId).toBe(fighterPayload.spells.spells[0]);
      expect(rows[0].sourceFeature).toBe('racial');
      const read = await app.handle(new Request(`http://localhost/v1/characters/${id}/spells`));
      expect(read.status).toBe(200);
      const result = await read.json();
      expect(result.cantrips[0].id).toBe('thaumaturgy');
      const [stored] = await db.select().from(characters).where(eq(characters.id, id));
      expect(stored.cantrips).toBe('thaumaturgy');
      await db.update(characters).set({ cantrips: '' }).where(eq(characters.id, id));
      const again = await app.handle(
        new Request(`http://localhost/v1/characters/${id}/spells`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...fighterPayload.spells, className }),
        }),
      );
      expect(again.status).toBe(200);
      const [synced] = await db.select().from(characters).where(eq(characters.id, id));
      expect(synced.cantrips).toBe('Thaumaturgy');
    });
  }
  it('rejects a human wizard claiming the racial spell and a different owner', async () => {
    const id = await create({ ...fighterPayload.create, race: 'Human' });
    const send = () =>
      app.handle(
        new Request(`http://localhost/v1/characters/${id}/spells`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fighterPayload.spells),
        }),
      );
    expect((await send()).status).toBe(400);
    const owner = userId;
    userId = testId('other-933');
    expect((await send()).status).toBe(404);
    userId = owner;
    expect(
      await db.select().from(characterSpells).where(eq(characterSpells.characterId, id)),
    ).toHaveLength(0);
    const seeded = await db
      .select()
      .from(spells)
      .where(eq(spells.id, fighterPayload.spells.spells[0]));
    expect(seeded).toHaveLength(1);
  });
});
