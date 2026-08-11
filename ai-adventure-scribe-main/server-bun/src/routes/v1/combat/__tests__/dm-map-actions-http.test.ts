/* eslint-disable max-lines -- one cohesive HTTP contract and its local dependency seams. */
import { beforeEach, describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';

import { dispatchMapAction } from '../../../../tactical/dispatch.js';

import type { MapAction } from '../../../../tactical/dispatch.js';
import type { MapEntity, TacticalMap } from '../../../../tactical/types.js';

Object.assign(process.env, {
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test',
  PORT: process.env.PORT ?? '3000',
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  WORKOS_API_KEY: process.env.WORKOS_API_KEY ?? 'test-workos-key',
  WORKOS_CLIENT_ID: process.env.WORKOS_CLIENT_ID ?? 'test-workos-client',
});

/**
 * HTTP contract for the DM map-action pipeline.
 *
 * The old version mocked the tactical-action service and map store at module scope. The
 * preceding DM attack suite therefore left a partial module replacement in Bun's process
 * cache, and these three tests got the wrong implementation in a full run. The route factory
 * keeps the test doubles local and leaves the shared module graph untouched.
 */
const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const ENCOUNTER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee';

const entity = (
  id: string,
  name: string,
  x: number,
  y: number,
  type: 'pc' | 'monster',
): MapEntity => ({
  id,
  name,
  x,
  y,
  size: 'medium',
  type,
  speedFeet: 30,
  movementRemaining: 30,
});

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
    entity('seeker', 'The Seeker', 1, 1, 'pc'),
    entity('void-maw', 'Void-Maw', 7, 7, 'monster'),
  ],
});

let activeMap: TacticalMap = buildMap();
const savedMaps: TacticalMap[] = [];
const broadcasts: Array<Record<string, unknown>> = [];
const advancedTurns: string[] = [];

const auth = (app: Elysia) =>
  app.derive(() => ({
    user: { userId: 'user_owner', email: 'owner@example.test', plan: 'free' },
  }));

const sessionOwnership = async (sessionId: string, _userId: string) =>
  sessionId === SESSION_ID
    ? { success: true as const, session: { id: SESSION_ID } }
    : { success: false as const, error: { status: 404, message: 'Session not found' } };

const mapDelta = (action: MapAction, result: { path?: { x: number; y: number }[] }) => {
  if (action.action === 'move') {
    return {
      type: 'entity_moved',
      entityId: action.entityId,
      path: result.path ?? [],
      movementRemaining: activeMap.entities.find((item) => item.id === action.entityId)
        ?.movementRemaining,
    };
  }
  return { type: 'tactical_action', action };
};

const dmTacticalActions = async (
  _sessionId: string,
  actions: MapAction[],
  _correctiveReprompt?: (refusal: Record<string, unknown>) => Promise<MapAction | null>,
) => {
  const results = actions.map((action) => dispatchMapAction(activeMap, action));
  const appliedDeltas: Array<Record<string, unknown>> = [];
  const degraded: Record<string, unknown>[] = [];
  for (const result of results) {
    if (result.applied) {
      savedMaps.push(activeMap);
      appliedDeltas.push(mapDelta(result.action, result));
    } else {
      degraded.push(result.refusal);
    }
  }
  if (appliedDeltas.length) {
    broadcasts.push({ type: 'tactical_action_queue', actions: appliedDeltas });
  }
  if (degraded.length) {
    broadcasts.push({ type: 'tactical_degraded', reasons: degraded });
  }
  return { results, appliedDeltas, degraded };
};

const authenticateRequest = async () => ({
  user: { userId: 'user_owner', email: 'owner@example.test', plan: 'free' },
  error: null,
});

const combatInitiativeService = {
  advanceTurn: async (encounterId: string) => {
    advancedTurns.push(encounterId);
    return {
      currentParticipant: { id: 'void-maw', name: 'Void-Maw' },
      currentRound: 1,
      turnOrder: [],
    };
  },
};

const resetTacticalMovementForTurn = async (_sessionId: string, participantId: string) => {
  const current = activeMap.entities.find((item) => item.id === participantId);
  if (current) current.movementRemaining = current.speedFeet;
  broadcasts.push({ type: 'movement_reset', movementReset: true, participantId });
  return activeMap;
};

const { createRequestPipelineApp } = await import('../../../../http-pipeline.js');
const { createTacticalMapRoutes } = await import('../../tactical-maps.js');
const { createInitiativeRoutes } = await import('../initiative.js');

// `initiativeRoutes` carries no prefix of its own; production mounts it under /v1/combat.
const app = createRequestPipelineApp()
  .use(
    createTacticalMapRoutes({
      auth: auth as never,
      sessionOwnership: sessionOwnership as never,
      activeMapLoader: async () => activeMap,
      dmTacticalActions: dmTacticalActions as never,
    }),
  )
  .use(
    new Elysia({ prefix: '/v1/combat' }).use(
      createInitiativeRoutes({
        authenticateRequest,
        verifyEncounterOwnership: (async (_encounterId: string | undefined, _userId: string) => ({
          success: true as const,
          session: { id: SESSION_ID },
        })) as never,
        combatInitiativeService: combatInitiativeService as never,
        resetTacticalMovementForTurn: resetTacticalMovementForTurn as never,
        publishCombatState: async () => {},
        logger: { error: () => {}, info: () => {}, warn: () => {}, debug: () => {} } as never,
      }),
    ),
  );

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
  action: 'move' as const,
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

    const monster = activeMap.entities.find((item) => item.id === 'void-maw')!;
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
    const monster = activeMap.entities.find((item) => item.id === 'void-maw')!;
    expect({ x: monster.x, y: monster.y }).toEqual({ x: 7, y: 7 });
  });

  it('restores movement on turn advance so the next round can move again', async () => {
    await postDmActions([move('void-maw', 4, 4)]);
    const spent = activeMap.entities.find((item) => item.id === 'void-maw')!.movementRemaining;
    expect(spent).toBeLessThan(30);

    const response = await app.handle(
      new Request(`http://localhost/v1/combat/${ENCOUNTER_ID}/next-turn`, {
        method: 'POST',
        headers: authorized,
      }),
    );

    expect(response.status).toBe(200);
    expect(advancedTurns).toEqual([ENCOUNTER_ID]);
    expect(activeMap.entities.find((item) => item.id === 'void-maw')!.movementRemaining).toBe(30);
    expect(broadcasts.some((payload) => payload.movementReset === true)).toBe(true);
  });
});
