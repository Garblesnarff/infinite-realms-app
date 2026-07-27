import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

import type { TacticalMap } from '../../../../tactical/types.js';

/**
 * The DM map-action dispatch had never been exercised end to end: the CM-2 pipeline could
 * apply and broadcast a move in theory, but the 30-turn playtest produced zero of them. This
 * drives the real route with only the store, transport, and turn service faked, so a monster
 * turn has to actually land on the board — and the next turn has to give its movement back.
 */
const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const ENCOUNTER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const buildMap = (): TacticalMap => ({
  id: 'map-1',
  sessionId: SESSION_ID,
  width: 10,
  height: 10,
  round: 1,
  sceneDescription: 'cave',
  cells: Array.from({ length: 10 }, () =>
    Array.from({ length: 10 }, () => ({
      terrain: 'floor' as const,
      blocksMovement: false,
      blocksSight: false,
      cover: 0 as const,
      elevation: 0,
    })),
  ),
  entities: [
    {
      id: 'seeker',
      name: 'The Seeker',
      x: 1,
      y: 1,
      size: 'medium',
      type: 'pc',
      speedFeet: 30,
      movementRemaining: 30,
    },
    {
      id: 'void-maw',
      name: 'Void-Maw',
      x: 7,
      y: 7,
      size: 'medium',
      type: 'monster',
      speedFeet: 30,
      movementRemaining: 30,
    },
  ],
});

let activeMap: TacticalMap = buildMap();
const savedMaps: TacticalMap[] = [];
const broadcasts: Array<Record<string, unknown>> = [];
const advancedTurns: string[] = [];

// No route under test touches SQL: the store and the turn service are both faked, so the
// real client is stubbed purely to keep `DATABASE_URL` out of the test environment.
mock.module('../../../../../../db/client', () => ({ db: {} }));
mock.module('../../../../lib/env.js', () => ({
  env: { WORKOS_CLIENT_ID: 'test-client', NODE_ENV: 'test' },
}));
mock.module('../../../../lib/logger.js', () => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
  },
  combatLogger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));
mock.module('../../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer valid-token'
      ? { user: { userId: 'user_owner', email: 'owner@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));
mock.module('../../../../middleware/auth.js', () => ({
  requireAuth: (app: { derive: (fn: unknown) => unknown }) =>
    (app as never as { derive: (fn: () => unknown) => unknown }).derive(() => ({
      user: { userId: 'user_owner', email: 'owner@example.test', plan: 'free' },
    })),
}));
mock.module('../helpers.js', () => ({
  verifySessionOwnership: async (sessionId: string) =>
    sessionId === SESSION_ID
      ? { success: true, session: { id: SESSION_ID } }
      : { success: false, error: { status: 404, message: 'Session not found' } },
  verifyEncounterOwnership: async () => ({ success: true, session: { id: SESSION_ID } }),
}));
mock.module('../../../../services/combat/tactical-map-store.js', () => ({
  loadActiveTacticalMap: async () => activeMap,
  // Facts and corrections are written to the session's latest map row, active or not, so a
  // fight's last event survives the teardown. Modelled here for the same reason.
  loadLatestTacticalMapRow: async () =>
    activeMap ? { rowId: 'row', state: activeMap, active: true } : null,
  saveTacticalMap: async (map: TacticalMap) => {
    activeMap = map;
    savedMaps.push(map);
  },
  saveTacticalMapRow: async (_rowId: string, state: TacticalMap) => {
    activeMap = state;
    savedMaps.push(state);
  },
  deactivateTacticalMap: async () => {},
}));
mock.module('../../../../services/collaboration/room-manager.js', () => ({
  broadcastToRoom: (_sessionId: string, _sender: unknown, payload: Record<string, unknown>) => {
    broadcasts.push(payload);
  },
}));
mock.module('../../../../services/combat/combat-sync-service.js', () => ({
  publishCombatState: async () => {},
}));
mock.module('../../../../services/combat/combat-events.js', () => ({ trackCombatEvent: () => {} }));
mock.module('../../../../services/combat-initiative-service.js', () => ({
  CombatInitiativeService: {
    advanceTurn: async (encounterId: string) => {
      advancedTurns.push(encounterId);
      return {
        currentParticipant: { id: 'void-maw', name: 'Void-Maw' },
        currentRound: 1,
        turnOrder: [],
      };
    },
  },
}));

const { createRequestPipelineApp } = await import('../../../../http-pipeline.js');
const { tacticalMapRoutes } = await import('../../tactical-maps.js');
const { initiativeRoutes } = await import('../initiative.js');

// initiativeRoutes carries no prefix of its own; production mounts it under /v1/combat.
const app = createRequestPipelineApp()
  .use(tacticalMapRoutes)
  .use(new Elysia({ prefix: '/v1/combat' }).use(initiativeRoutes));

const authorized = { 'content-type': 'application/json', authorization: 'Bearer valid-token' };

const postDmActions = (actions: unknown[]) =>
  app.handle(
    new Request(`http://localhost/v1/sessions/${SESSION_ID}/tactical-map/dm-actions`, {
      method: 'POST',
      headers: authorized,
      body: JSON.stringify({ actions }),
    }),
  );

const move = (entityId: string, x: number, y: number) => ({
  action: 'move',
  entityId,
  x,
  y,
  changes: null,
});

beforeEach(() => {
  activeMap = buildMap();
  savedMaps.length = 0;
  broadcasts.length = 0;
  advancedTurns.length = 0;
});

describe('DM map actions over HTTP', () => {
  it('applies a monster turn move to the map state and broadcasts the delta', async () => {
    const response = await postDmActions([move('void-maw', 3, 3)]);
    const body = (await response.json()) as {
      appliedDeltas: Array<Record<string, unknown>>;
      degraded: unknown[];
    };

    expect(response.status).toBe(200);
    expect(body.degraded).toHaveLength(0);
    expect(body.appliedDeltas[0]).toMatchObject({ type: 'entity_moved', entityId: 'void-maw' });

    const monster = activeMap.entities.find((entity) => entity.id === 'void-maw')!;
    expect({ x: monster.x, y: monster.y }).toEqual({ x: 3, y: 3 });
    expect(monster.movementRemaining).toBeLessThan(30);
    expect(savedMaps.length).toBeGreaterThan(0);
    expect(
      broadcasts.some(
        (payload) =>
          payload.type === 'tactical_action_queue' &&
          JSON.stringify(payload).includes('"entityId":"void-maw"'),
      ),
    ).toBe(true);
  });

  it('refuses a move beyond remaining movement without mutating the board', async () => {
    const response = await postDmActions([move('void-maw', 7, 0)]);
    const body = (await response.json()) as { degraded: Array<Record<string, unknown>> };

    expect(body.degraded[0]).toMatchObject({ reason: 'insufficient_movement' });
    const monster = activeMap.entities.find((entity) => entity.id === 'void-maw')!;
    expect({ x: monster.x, y: monster.y }).toEqual({ x: 7, y: 7 });
  });

  it('restores movement on turn advance so the next round can move again', async () => {
    await postDmActions([move('void-maw', 4, 4)]);
    const spent = activeMap.entities.find((entity) => entity.id === 'void-maw')!.movementRemaining;
    expect(spent).toBeLessThan(30);

    const response = await app.handle(
      new Request(`http://localhost/v1/combat/${ENCOUNTER_ID}/next-turn`, {
        method: 'POST',
        headers: authorized,
      }),
    );

    expect(response.status).toBe(200);
    expect(advancedTurns).toEqual([ENCOUNTER_ID]);
    expect(activeMap.entities.find((entity) => entity.id === 'void-maw')!.movementRemaining).toBe(
      30,
    );
    expect(broadcasts.some((payload) => payload.movementReset === true)).toBe(true);
  });
});
