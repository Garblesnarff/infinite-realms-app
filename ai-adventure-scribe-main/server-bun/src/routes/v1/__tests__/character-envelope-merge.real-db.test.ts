/**
 * #1508: the character envelope in `personality_notes` is merged on the server.
 *
 * Engine-owned keys (`inspiration`) are never taken from a PUT body; the stored value is kept.
 * A PUT that omits the envelope, or sends null, empty, or non-JSON notes, keeps every stored key.
 * A character with no `inspiration` key reads as not held (false) from the character API.
 *
 * The bodies are sent through the real route (PUT and GET /v1/characters/:id). Requires
 * TEST_DATABASE_URL or DATABASE_URL — see services/__tests__/fixtures/real-db.ts.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  grantLegendPlan,
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

describeWithDb('character envelope merge on the server (#1508)', () => {
  let app: { handle: (request: Request) => Promise<Response> };
  let db: ReturnType<typeof realDb>;
  const createdIds: string[] = [];

  beforeAll(async () => {
    userId = testId('user-1508');
    await grantLegendPlan(userId);
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

  /** Creates a character through the real route and returns its id. */
  async function createCharacter(label: string): Promise<string> {
    const created = await send('/v1/characters', 'POST', {
      ...fighterPayload,
      name: `Envelope ${label} ${testId('1508')}`,
    });
    const text = await created.text();
    expect(created.status, text.slice(0, 400)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);
    return id;
  }

  /** Writes the stored column directly, the way the engine leaves it after a DM grant. */
  async function storeEnvelope(id: string, envelope: Record<string, unknown> | string | null) {
    const value =
      envelope === null || typeof envelope === 'string' ? envelope : JSON.stringify(envelope);
    await db.update(characters).set({ personalityNotes: value }).where(eq(characters.id, id));
  }

  async function storedNotes(id: string): Promise<Record<string, unknown> | null> {
    const res = await send(`/v1/characters/${id}`, 'GET');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { personality_notes: string | null };
    return body.personality_notes
      ? (JSON.parse(body.personality_notes) as Record<string, unknown>)
      : null;
  }

  it('a PUT that sets inspiration true does not grant it', async () => {
    const id = await createCharacter('grant');
    await storeEnvelope(id, { traits: ['Brave'], inspiration: false });

    const res = await send(`/v1/characters/${id}`, 'PUT', {
      personality_notes: JSON.stringify({ traits: ['Brave'], inspiration: true }),
    });
    expect(res.status, await res.clone().text()).toBe(200);

    const notes = await storedNotes(id);
    expect(notes?.inspiration).toBe(false);
    expect(notes?.traits).toEqual(['Brave']);
  });

  it('a PUT that drops a DM-granted inspiration keeps the stored flag', async () => {
    const id = await createCharacter('drop');
    await storeEnvelope(id, { traits: ['Brave'], inspiration: true });

    const res = await send(`/v1/characters/${id}`, 'PUT', {
      personality_notes: JSON.stringify({ traits: ['Brave'] }),
    });
    expect(res.status).toBe(200);

    expect((await storedNotes(id))?.inspiration).toBe(true);
  });

  it('a PUT with no envelope keeps every stored key', async () => {
    const id = await createCharacter('no-envelope');
    const stored = { traits: ['Brave'], ideals: ['Honor'], inspiration: true, custom: 'kept' };
    await storeEnvelope(id, stored);

    const res = await send(`/v1/characters/${id}`, 'PUT', { name: `Renamed ${testId('1508')}` });
    expect(res.status).toBe(200);

    expect(await storedNotes(id)).toEqual(stored);
  });

  it('null and empty personality_notes keep every stored key', async () => {
    const id = await createCharacter('null-empty');
    const stored = { traits: ['Brave'], inspiration: true, custom: 'kept' };
    await storeEnvelope(id, stored);

    const nullRes = await send(`/v1/characters/${id}`, 'PUT', { personality_notes: null });
    expect(nullRes.status).toBe(200);
    expect(await storedNotes(id)).toEqual(stored);

    const emptyRes = await send(`/v1/characters/${id}`, 'PUT', { personality_notes: '' });
    expect(emptyRes.status).toBe(200);
    expect(await storedNotes(id)).toEqual(stored);
  });

  it('non-JSON personality_notes is refused and stores nothing', async () => {
    const id = await createCharacter('non-json');
    const stored = { traits: ['Brave'], inspiration: true };
    await storeEnvelope(id, stored);

    const res = await send(`/v1/characters/${id}`, 'PUT', { personality_notes: 'plain notes' });
    expect(res.status).toBe(400);

    expect(await storedNotes(id)).toEqual(stored);
  });

  it('a PUT with no envelope keeps the stored Metamagic list; an envelope that drops or swaps it is refused (422)', async () => {
    const id = await createCharacter('sorcerer');
    // The character is a Sorcerer at level 3 with a stored two-option list (#1233).
    await db.update(characters).set({ class: 'Sorcerer', level: 3 }).where(eq(characters.id, id));
    const stored = { traits: ['Brave'], metamagicOptions: ['quickened', 'careful'] };
    await storeEnvelope(id, stored);

    const noEnvelopeRes = await send(`/v1/characters/${id}`, 'PUT', {
      name: `Sorcerer ${testId('1508')}`,
    });
    expect(noEnvelopeRes.status, await noEnvelopeRes.clone().text()).toBe(200);
    expect(await storedNotes(id)).toEqual(stored);

    // Leaving the list out of an envelope is a removal, which #1233 refuses.
    const dropRes = await send(`/v1/characters/${id}`, 'PUT', {
      personality_notes: JSON.stringify({ traits: ['Bold'] }),
    });
    expect(dropRes.status).toBe(422);
    expect(await storedNotes(id)).toEqual(stored);

    const swapRes = await send(`/v1/characters/${id}`, 'PUT', {
      personality_notes: JSON.stringify({
        traits: ['Bold'],
        metamagicOptions: ['quickened', 'subtle'],
      }),
    });
    expect(swapRes.status).toBe(422);
    expect(await storedNotes(id)).toEqual(stored);
  });

  it('a premade with no inspiration key reads as not held (false) from the character API', async () => {
    const id = await createCharacter('premade');
    await storeEnvelope(id, null);

    const res = await send(`/v1/characters/${id}`, 'GET');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { inspiration?: boolean };
    expect(body.inspiration).toBe(false);
  });
});
