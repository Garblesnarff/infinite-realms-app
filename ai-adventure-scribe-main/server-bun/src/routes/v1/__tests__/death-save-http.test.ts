import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

import { DEATH_SAVE_WIRE_BODY } from '../../../../../shared/test-fixtures/death-save-body';
import { NotFoundError } from '../../../lib/errors.js';
import { resolveDeathSave } from '../../../services/session/death-save-resolution.js';

import type { CharacterVitals } from '../../../services/character-vitals-math.js';

/**
 * #1811: the exact `{}` body the client posts, through the real
 * `POST /v1/sessions/:id/death-save` route and request pipeline.
 * Auth, ownership, the database, and the dice are stubbed; the route
 * and resolution math are real.
 */

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

const OWNER = 'user-1';
const OTHER = 'user-2';
const SESSION_ID = 'session-1';
const CHARACTER_ID = 'char-1';

let nextNatural = 12;
let nextD4 = 3;
let rollCount = 0;
let activeFight = false;
let currentVitals: CharacterVitals;

const dying = (): CharacterVitals => ({
  characterId: CHARACTER_ID,
  currentHitPoints: 0,
  maxHitPoints: 12,
  temporaryHitPoints: 0,
  isConscious: false,
  deathSavesSuccesses: 0,
  deathSavesFailures: 0,
  vitalState: 'dying',
  diedAt: null,
});

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const header = request.headers.get('authorization');
    if (header === 'Bearer owner-token') {
      return { user: { userId: OWNER, email: 'owner@example.test', plan: 'free' }, error: null };
    }
    if (header === 'Bearer other-token') {
      return { user: { userId: OTHER, email: 'other@example.test', plan: 'free' }, error: null };
    }
    return { user: null, error: 'Unauthorized' };
  },
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

mock.module('../../../lib/logger.js', () => ({
  logger: noopLogger,
  combatLogger: noopLogger,
  spellLogger: noopLogger,
  progressionLogger: noopLogger,
  errorLogSerializers: {},
  default: noopLogger,
}));

mock.module('../../../lib/rng.js', () => ({
  rollDie: (sides: number) => {
    rollCount += 1;
    if (sides === 4) return nextD4;
    if (sides !== 20) throw new Error(`expected a d20 or d4, got d${sides}`);
    return nextNatural;
  },
}));

mock.module('../../../../../db/client', () => {
  const chain = (rows: unknown[]) => {
    const handle: Record<string, unknown> = {};
    handle.from = () => handle;
    handle.where = () => handle;
    handle.limit = async () => rows;
    return handle;
  };
  return {
    db: {
      select: (shape?: Record<string, unknown>) => {
        if (shape && Object.keys(shape).length === 1 && 'id' in shape) {
          return chain(activeFight ? [{ id: 'enc-1' }] : []);
        }
        return chain([]);
      },
    },
  };
});

mock.module('../../../services/session-service.js', () => ({
  SessionService: {
    getSessionById: async (sessionId: string, userId: string) => {
      if (sessionId !== SESSION_ID || userId !== OWNER) {
        throw new NotFoundError('Session', sessionId);
      }
      return { id: SESSION_ID, characterId: CHARACTER_ID };
    },
  },
}));

mock.module('../../../services/character-vitals-service.js', () => ({
  CharacterVitalsService: {
    getVitals: async () => currentVitals,
    applyDeathSave: async (
      _characterId: string,
      _userId: string,
      options: { rollDie: (sides: number) => number },
    ) => {
      const natural = options.rollDie(20);
      let resolution = resolveDeathSave({
        vitals: currentVitals,
        name: 'Mira',
        natural,
      });
      if (resolution.isStabilized) {
        const d4 = options.rollDie(4);
        resolution = resolveDeathSave({
          vitals: currentVitals,
          name: 'Mira',
          natural,
          d4,
        });
      }
      currentVitals = {
        ...currentVitals,
        ...resolution.vitals,
        diedAt: resolution.diedAt ?? currentVitals.diedAt,
      };
      return { ...currentVitals, resolution };
    },
  },
}));

mock.module('../../../services/dm/story-broadcast.js', () => ({
  publishStoryCharacterUpdate: () => {},
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { deathSaveRoutes } = await import('../death-save.js');

const app = createRequestPipelineApp().use(
  new Elysia({ prefix: '/v1/sessions' }).use(deathSaveRoutes),
);

const post = (token: string, body: unknown = DEATH_SAVE_WIRE_BODY): Promise<Response> =>
  app.handle(
    new Request(`http://localhost/v1/sessions/${SESSION_ID}/death-save`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  );

describe('POST /v1/sessions/:id/death-save (#1811)', () => {
  beforeEach(() => {
    nextNatural = 12;
    nextD4 = 3;
    rollCount = 0;
    activeFight = false;
    currentVitals = dying();
  });

  it('returns 404 when the session belongs to another user', async () => {
    const response = await post('other-token');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
    expect(rollCount).toBe(0);
  });

  it('returns 409 when a fight is already active', async () => {
    activeFight = true;
    const response = await post('owner-token');
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Already in a fight' });
    expect(rollCount).toBe(0);
  });

  it('returns 409 and does not roll when the hero is not dying', async () => {
    currentVitals = { ...dying(), currentHitPoints: 8, vitalState: 'standing', isConscious: true };
    const response = await post('owner-token');
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Not dying' });
    expect(rollCount).toBe(0);
  });

  it('posts the client wire body and records a success', async () => {
    nextNatural = 12;
    const response = await post('owner-token', DEATH_SAVE_WIRE_BODY);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.roll).toBe(12);
    expect(body.successes).toBe(1);
    expect(body.failures).toBe(0);
    expect(body.vitalState).toBe('dying');
    expect(body.currentHitPoints).toBe(0);
    expect(body.terminal).toBe(false);
    expect(body.engineLines).toEqual(['Death saving throw: 12 — success (1/3)']);
    expect(rollCount).toBe(1);
  });

  it('three successes wake the hero at 1 HP after the rolled hours', async () => {
    currentVitals = { ...dying(), deathSavesSuccesses: 2 };
    nextNatural = 11;
    nextD4 = 2;
    const response = await post('owner-token');
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.vitalState).toBe('standing');
    expect(body.currentHitPoints).toBe(1);
    expect(body.hours).toBe(2);
    expect(body.terminal).toBe(false);
    expect(body.engineLines).toEqual([
      'Mira rolled 11 on their death saving throw — the third success. Mira is stable.',
      'Mira is stable. After 2 hours Mira wakes with 1 HP.',
    ]);
    expect(rollCount).toBe(2);
  });

  it('three failures set the hero dead', async () => {
    currentVitals = { ...dying(), deathSavesFailures: 2 };
    nextNatural = 4;
    const response = await post('owner-token');
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.vitalState).toBe('dead');
    expect(body.currentHitPoints).toBe(0);
    expect(body.terminal).toBe(true);
    expect((body.engineLines as string[])[0]).toContain('the third failure');
    expect(rollCount).toBe(1);
  });
});
