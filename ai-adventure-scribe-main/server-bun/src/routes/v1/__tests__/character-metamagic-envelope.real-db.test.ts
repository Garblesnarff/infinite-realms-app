/**
 * #1233: the Metamagic list travels in the personality envelope through the real create and update
 * routes. The bodies come from shared/test-fixtures/metamagic-envelope.ts (the same bytes the client
 * writes). A valid list is stored; an over-cap or unknown list is refused and stores nothing.
 */
import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Elysia } from 'elysia';

import { characters } from '../../../../../db/schema/index';
import {
  metamagicEnvelopeJson,
  metamagicOverCapBody,
  metamagicUnknownIdBody,
  metamagicValidBody,
} from '../../../../../shared/test-fixtures/metamagic-envelope';
import {
  closeRealDb,
  describeWithDb,
  grantLegendPlan,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../services/__tests__/fixtures/real-db.js';

const userId = `metamagic-envelope-${process.pid}`;

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === `Bearer ${userId}`
      ? { user: { userId, email: 'metamagic@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));

if (hasRealDb) {
  process.env.CORS_ORIGIN ??= 'http://localhost:5173';
  process.env.WORKOS_API_KEY ??= 'test-workos-api-key';
  process.env.WORKOS_CLIENT_ID ??= 'test-workos-client-id';
  process.env.PORT ??= '8888';
}

const { createRequestPipelineApp } = await importWithRealDb(
  () => import('../../../http-pipeline.js'),
);
const { charactersRoutes } = await importWithRealDb(() => import('../characters.ts'));

const app = hasRealDb ? createRequestPipelineApp().use(new Elysia().use(charactersRoutes)) : null;

describeWithDb('Metamagic envelope through the real characters routes (#1233)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  let characterId: string;

  const send = async (method: string, path: string, body: unknown) => {
    const response = await app!.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { authorization: `Bearer ${userId}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, text: await response.text() };
  };

  const storedEnvelope = async () => {
    const [row] = await db
      .select({ personalityNotes: characters.personalityNotes })
      .from(characters)
      .where(eq(characters.id, characterId));
    return row.personalityNotes;
  };

  beforeAll(async () => {
    if (!hasRealDb) return;
    await grantLegendPlan(userId);
    const created = await send('POST', '/v1/characters', {
      name: testId('1233-metamagic-sorcerer'),
      class: 'Sorcerer',
      level: 3,
      ...metamagicValidBody,
    });
    expect(created.status).toBe(201);
    characterId = (JSON.parse(created.text) as { id: string }).id;
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db.delete(characters).where(eq(characters.id, characterId));
    await closeRealDb();
  });

  test('create stores the valid list in the envelope', async () => {
    expect(await storedEnvelope()).toContain('"metamagicOptions":["quickened","careful"]');
  });

  test('update with the valid body is accepted and keeps the list', async () => {
    const response = await send('PUT', `/v1/characters/${characterId}`, metamagicValidBody);
    expect(response.status).toBe(200);
    expect(await storedEnvelope()).toContain('"metamagicOptions":["quickened","careful"]');
  });

  test('update with three options at level 3 is refused and stores nothing', async () => {
    const before = await storedEnvelope();
    const response = await send('PUT', `/v1/characters/${characterId}`, metamagicOverCapBody);
    expect(response.status).toBe(400);
    expect(await storedEnvelope()).toBe(before);
  });

  test('create with an unknown option is refused', async () => {
    const response = await send('POST', '/v1/characters', {
      name: testId('1233-metamagic-unknown'),
      class: 'Sorcerer',
      level: 3,
      ...metamagicUnknownIdBody,
    });
    expect(response.status).toBe(400);
  });

  // #1233 (strategist FIX): a stored list is fixed. The beforeAll character holds ['quickened',
  // 'careful'] at level 3; the tests below only read it or update their own characters.
  test('a swap of the stored list is refused with 422, and nothing is stored', async () => {
    const before = await storedEnvelope();
    const response = await send('PUT', `/v1/characters/${characterId}`, {
      personality_notes: metamagicEnvelopeJson(['quickened', 'subtle']),
    });
    expect(response.status).toBe(422);
    expect(await storedEnvelope()).toBe(before);
  });

  test('a removal of the stored list is refused with 422', async () => {
    const before = await storedEnvelope();
    const response = await send('PUT', `/v1/characters/${characterId}`, {
      personality_notes: JSON.stringify({ traits: [], inspiration: false }),
    });
    expect(response.status).toBe(422);
    expect(await storedEnvelope()).toBe(before);
  });

  test('a grow is accepted at 10th level, where the cap allows a third option', async () => {
    const created = await send('POST', '/v1/characters', {
      name: testId('1233-metamagic-level10'),
      class: 'Sorcerer',
      level: 10,
      ...metamagicValidBody,
    });
    expect(created.status).toBe(201);
    const id = (JSON.parse(created.text) as { id: string }).id;
    const response = await send('PUT', `/v1/characters/${id}`, {
      level: 10,
      personality_notes: metamagicEnvelopeJson(['quickened', 'careful', 'subtle']),
    });
    expect(response.status).toBe(200);
    const [row] = await db
      .select({ personalityNotes: characters.personalityNotes })
      .from(characters)
      .where(eq(characters.id, id));
    expect(row.personalityNotes).toContain('"subtle"');
    await db.delete(characters).where(eq(characters.id, id));
  });

  test('a first pick is accepted when the character holds no list yet', async () => {
    const created = await send('POST', '/v1/characters', {
      name: testId('1233-metamagic-first-pick'),
      class: 'Sorcerer',
      level: 3,
      personality_notes: JSON.stringify({ traits: [], inspiration: false }),
    });
    expect(created.status).toBe(201);
    const id = (JSON.parse(created.text) as { id: string }).id;
    const response = await send('PUT', `/v1/characters/${id}`, metamagicValidBody);
    expect(response.status).toBe(200);
    await db.delete(characters).where(eq(characters.id, id));
  });
});
