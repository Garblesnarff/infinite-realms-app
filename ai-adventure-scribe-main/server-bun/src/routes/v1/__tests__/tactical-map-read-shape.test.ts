import { describe, expect, it } from 'bun:test';

import {
  TACTICAL_MAP_SESSION_ID,
  activeTacticalMapRead,
} from '../../../../../shared/test-fixtures/tactical-map-read';

import type { TacticalMap } from '../../../tactical/types.js';
import type { Elysia } from 'elysia';

Object.assign(process.env, {
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test',
  PORT: process.env.PORT ?? '3000',
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  WORKOS_API_KEY: process.env.WORKOS_API_KEY ?? 'test-workos-key',
  WORKOS_CLIENT_ID: process.env.WORKOS_CLIENT_ID ?? 'test-workos-client',
});

/**
 * #1185: the client's movement read (`actorMovementRemaining`) settles a player's turn after
 * a cast or an attack. It must read the body this route really returns. This pins that body,
 * through the real route and request pipeline, to the shared fixture the client test reads.
 */
const auth = (app: Elysia) =>
  app.derive(() => ({
    user: { userId: 'user_owner', email: 'owner@example.test', plan: 'free' },
  }));

const sessionOwnership = async (sessionId: string, _userId: string) =>
  sessionId === TACTICAL_MAP_SESSION_ID
    ? { success: true as const, session: { id: TACTICAL_MAP_SESSION_ID } }
    : { success: false as const, error: { status: 404, message: 'Session not found' } };

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { createTacticalMapRoutes } = await import('../tactical-maps.js');

const appWith = (map: TacticalMap | null) =>
  createRequestPipelineApp().use(
    createTacticalMapRoutes({
      auth: auth as never,
      sessionOwnership: sessionOwnership as never,
      activeMapLoader: async () => map,
    }),
  );

const read = (app: ReturnType<typeof appWith>) =>
  app.handle(
    new Request(`http://localhost/v1/sessions/${TACTICAL_MAP_SESSION_ID}/tactical-map`, {
      headers: { authorization: 'Bearer valid-token' },
    }),
  );

describe('GET /v1/sessions/:id/tactical-map body shape (#1185)', () => {
  it('returns the active map itself, not wrapped in { map }', async () => {
    const response = await read(appWith(activeTacticalMapRead() as TacticalMap));

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual(activeTacticalMapRead());
    expect('map' in body).toBe(false);
  });

  it('wraps only the no-map read as { map: null }', async () => {
    const response = await read(appWith(null));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ map: null });
  });
});
