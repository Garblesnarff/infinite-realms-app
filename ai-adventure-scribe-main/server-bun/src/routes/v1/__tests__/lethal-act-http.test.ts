import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

import { LETHAL_ACT_WIRE_BODY } from '../../../../../shared/test-fixtures/lethal-act-body';
import { NotFoundError } from '../../../lib/errors.js';
import {
  computeVitalsAfterDamage,
  type CharacterVitals,
} from '../../../services/character-vitals-math.js';

/**
 * #468: the exact `{ text }` body the client posts, through the real
 * `POST /v1/sessions/:id/lethal-act` route and request pipeline.
 * Auth, ownership, the database, and the d20 are stubbed; the route,
 * detector, proposal, and resolution math are real.
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

let nextNatural = 15;
let rollCount = 0;
let activeFight = false;
let currentVitals: CharacterVitals;

const standing = (hp: number): CharacterVitals => ({
  characterId: CHARACTER_ID,
  currentHitPoints: hp,
  maxHitPoints: hp,
  temporaryHitPoints: 0,
  isConscious: true,
  deathSavesSuccesses: 0,
  deathSavesFailures: 0,
  vitalState: 'standing',
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
    if (sides !== 20) throw new Error(`expected a d20, got d${sides}`);
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
        // The fight check selects `{ id }`; the ability-score query selects the row.
        if (shape && Object.keys(shape).length === 1 && 'id' in shape) {
          return chain(activeFight ? [{ id: 'enc-1' }] : []);
        }
        return chain([
          {
            strength: 10,
            dexterity: 10,
            constitution: 10,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
        ]);
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
    applyDamage: async (_characterId: string, _userId: string, amount: number) => {
      const written = computeVitalsAfterDamage(currentVitals, amount);
      currentVitals = { ...currentVitals, ...written };
      return currentVitals;
    },
  },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { lethalActRoutes } = await import('../lethal-act.js');

// Same prefix as sessions.ts, which `.use`s this route file so app.ts stays untouched.
const app = createRequestPipelineApp().use(
  new Elysia({ prefix: '/v1/sessions' }).use(lethalActRoutes),
);

const post = (token: string, body: unknown = LETHAL_ACT_WIRE_BODY): Promise<Response> =>
  app.handle(
    new Request(`http://localhost/v1/sessions/${SESSION_ID}/lethal-act`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  );

describe('POST /v1/sessions/:id/lethal-act (#468)', () => {
  beforeEach(() => {
    nextNatural = 15;
    rollCount = 0;
    activeFight = false;
    currentVitals = standing(20);
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

  it('returns 409 and does not roll when the hero is already at 0 HP', async () => {
    currentVitals = {
      ...standing(20),
      currentHitPoints: 0,
      isConscious: false,
      vitalState: 'dying',
    };
    const response = await post('owner-token');
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Already at 0 HP' });
    expect(rollCount).toBe(0);
  });

  it('returns 409 and does not roll when the hero is already dead', async () => {
    currentVitals = {
      ...standing(20),
      currentHitPoints: 0,
      isConscious: false,
      vitalState: 'dead',
    };
    const response = await post('owner-token');
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Already dead' });
    expect(rollCount).toBe(0);
  });

  it('posts the client wire body and a success deals half current HP, hero stays up', async () => {
    nextNatural = 15;
    const response = await post('owner-token', LETHAL_ACT_WIRE_BODY);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.natural).toBe(15);
    expect(body.total).toBe(15);
    expect(body.dc).toBe(15);
    expect(body.damage).toBe(10);
    expect(body.currentHitPoints).toBe(10);
    expect(body.maxHitPoints).toBe(20);
    expect(body.vitalState).toBe('standing');
    expect(rollCount).toBe(1);
  });

  it('posts the client wire body and a failure drops the hero to 0 HP dying, not dead', async () => {
    nextNatural = 14;
    const response = await post('owner-token', LETHAL_ACT_WIRE_BODY);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.natural).toBe(14);
    expect(body.total).toBe(14);
    expect(body.damage).toBe(20);
    expect(body.currentHitPoints).toBe(0);
    expect(body.vitalState).toBe('dying');
    expect(rollCount).toBe(1);
  });
});
