import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

describeWithDb('#989 Tough Fighter real create/read/recompute', () => {
  let app: any;
  const ids: string[] = [];
  beforeAll(async () => {
    userId = testId('user-989');
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
  it('posts the exact client-produced Tough body and keeps14HP across reload, then recomputes CON', async () => {
    const body = JSON.parse(
      readFileSync(
        resolve(
          import.meta.dir,
          '../../../../../shared/test-fixtures/tough-fighter-989-create.json',
        ),
        'utf8',
      ),
    );
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
    const read = await app.handle(new Request(`http://localhost/v1/characters/${id}`));
    const saved = await read.json();
    expect(saved.stats.max_hit_points).toBe(14);
    expect(saved.class_features['feat:tough'].name).toBe('Tough');
    const update = await app.handle(
      new Request(`http://localhost/v1/characters/${id}/stats`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body.stats, constitution: 16 }),
      }),
    );
    expect(update.status).toBe(200);
    const reloaded = await app.handle(new Request(`http://localhost/v1/characters/${id}`));
    expect((await reloaded.json()).stats.max_hit_points).toBe(15);
  });
});
