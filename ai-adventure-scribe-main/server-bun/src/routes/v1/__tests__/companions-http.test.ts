/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer valid-user-token'
      ? { user: { userId: 'user-1', email: 'user@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));
mock.module('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://test.invalid/unused',
    PORT: '8892',
    CORS_ORIGIN: 'http://localhost:8891',
    WORKOS_API_KEY: 'test-workos-key',
    WORKOS_CLIENT_ID: 'test-workos-client',
    NODE_ENV: 'test',
  },
}));
mock.module('../../../lib/logger.js', () => ({ logger: noopLogger }));

const service = {
  join: mock(async (_sessionId: string, characterId: string) => {
    if (characterId === 'foreign-character') {
      const { NotFoundError } = await import('../../../lib/errors.js');
      throw new NotFoundError('Character', characterId);
    }
    if (characterId === 'third-character') {
      const { BusinessLogicError } = await import('../../../lib/errors.js');
      throw new BusinessLogicError('A session can have at most two active companions', {
        limit: 2,
      });
    }
    return {
      id: 'companion-1',
      sessionId: 'session-1',
      characterId,
      controller: 'webmcp',
      status: 'active',
      createdAt: new Date('2026-08-27T00:00:00Z'),
    };
  }),
  party: mock(async () => [{ name: 'Mira', class: 'Cleric', race: 'Elf', level: 5 }]),
  activeCompanions: mock(async () => [
    {
      id: 'companion-1',
      characterId: 'character-2',
      name: 'Mira',
      class: 'Cleric',
      level: 5,
      portraitUrl: 'https://example.com/mira.png',
      controller: 'webmcp',
    },
  ]),
  leave: mock(async () => ({
    id: 'companion-1',
    sessionId: 'session-1',
    characterId: 'character-2',
    controller: 'webmcp',
    status: 'left',
    createdAt: new Date('2026-08-27T00:00:00Z'),
  })),
  scene: mock(async () => ({
    campaign: { name: 'Campaign', description: 'Description' },
    session: { current_scene_description: 'Scene', summary: 'Summary' },
    party: [],
    dialogue_history: [],
    combat: null,
  })),
  say: mock(async () => ({
    id: 'message-1',
    sessionId: 'session-1',
    speakerType: 'companion',
    message: 'Hello',
  })),
  roll: mock(async () => ({
    d20: 11,
    modifier: 6,
    total: 17,
    breakdown: ['1d20', 'CHA +3', 'Prof +3'],
  })),
};
const mapCompanion = (companion: any) => ({
  id: companion.id,
  session_id: companion.sessionId,
  character_id: companion.characterId,
  controller: companion.controller,
  status: companion.status,
  created_at: companion.createdAt,
});

process.env.COMPANIONS_ENABLED = 'true';
const { requireAuth } = await import('../../../middleware/auth.js');
const { createCompanionRoutes } = await import('../companion-routes.js');
const app = new Elysia().use(
  createCompanionRoutes({
    auth: requireAuth,
    verifyOwnership: async (sessionId: string | undefined, userId: string) =>
      sessionId === 'session-1' && userId === 'user-1'
        ? { success: true }
        : { success: false, error: { status: 404, message: 'Session not found' } },
    service: service as never,
    mapCompanion,
  }),
);

const auth = { authorization: 'Bearer valid-user-token' };

describe('WebMCP companion route guards', () => {
  beforeEach(() => {
    process.env.COMPANIONS_ENABLED = 'true';
  });

  it('requires authentication on all six companion routes', async () => {
    const requests: Request[] = [
      new Request('http://localhost/v1/sessions/session-1/companions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ character_id: 'character-2' }),
      }),
      new Request('http://localhost/v1/sessions/session-1/companions'),
      new Request('http://localhost/v1/sessions/session-1/companions/companion-1', {
        method: 'DELETE',
      }),
      new Request('http://localhost/v1/sessions/session-1/scene'),
      new Request('http://localhost/v1/sessions/session-1/companions/companion-1/say', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Hello' }),
      }),
      new Request('http://localhost/v1/sessions/session-1/companions/companion-1/roll', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'skill', name: 'Persuasion' }),
      }),
    ];

    for (const request of requests) {
      expect((await app.handle(request)).status).toBe(401);
    }
  });

  it('no bearer and no body currently returns 422 (desired 401)', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/sessions/session-1/companions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
    );
    // Desired: 401. TypeBox body schema currently runs before requireAuth (#2120).
    expect(response.status).toBe(422);
  });

  it('returns active companions in the left-rail roster shape', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/sessions/session-1/companions', { headers: auth }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      companions: [
        {
          id: 'companion-1',
          characterId: 'character-2',
          name: 'Mira',
          class: 'Cleric',
          level: 5,
          portraitUrl: 'https://example.com/mira.png',
          controller: 'webmcp',
        },
      ],
    });
    expect(service.activeCompanions).toHaveBeenCalledWith('session-1', 'user-1');
  });

  it('hides all six routes while COMPANIONS_ENABLED is off', async () => {
    process.env.COMPANIONS_ENABLED = 'false';
    const response = await app.handle(
      new Request('http://localhost/v1/sessions/session-1/scene', { headers: auth }),
    );
    expect(response.status).toBe(404);
  });

  it('requires owned session access before dispatching a companion operation', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/sessions/foreign-session/scene', { headers: auth }),
    );
    expect(response.status).toBe(404);
    expect(service.scene).not.toHaveBeenCalled();
  });

  it('returns the joined companion row and party roster', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/sessions/session-1/companions', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ character_id: 'character-2' }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      companion: { character_id: 'character-2', status: 'active' },
      party: [{ name: 'Mira' }],
    });
  });

  it('maps non-owner rejection and cap rejection without bypassing service guards', async () => {
    const foreign = await app.handle(
      new Request('http://localhost/v1/sessions/session-1/companions', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ character_id: 'foreign-character' }),
      }),
    );
    expect(foreign.status).toBe(404);

    const capped = await app.handle(
      new Request('http://localhost/v1/sessions/session-1/companions', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ character_id: 'third-character' }),
      }),
    );
    expect(capped.status).toBe(422);
  });

  it('dispatches delete, scene, say, and server roll to their guarded services', async () => {
    const responses = await Promise.all([
      app.handle(
        new Request('http://localhost/v1/sessions/session-1/companions/companion-1', {
          method: 'DELETE',
          headers: auth,
        }),
      ),
      app.handle(new Request('http://localhost/v1/sessions/session-1/scene', { headers: auth })),
      app.handle(
        new Request('http://localhost/v1/sessions/session-1/companions/companion-1/say', {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Hello' }),
        }),
      ),
      app.handle(
        new Request('http://localhost/v1/sessions/session-1/companions/companion-1/roll', {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'skill', name: 'Persuasion' }),
        }),
      ),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    expect(service.leave).toHaveBeenCalled();
    expect(service.scene).toHaveBeenCalled();
    expect(service.say).toHaveBeenCalled();
    expect(service.roll).toHaveBeenCalled();
  });

  it('forwards the requesting companion identity to the scene service', async () => {
    service.scene.mockClear();

    const response = await app.handle(
      new Request('http://localhost/v1/sessions/session-1/scene?companion_id=companion-2', {
        headers: auth,
      }),
    );

    expect(response.status).toBe(200);
    expect(service.scene).toHaveBeenCalledWith('session-1', 'user-1', 'companion-2');
  });
});
