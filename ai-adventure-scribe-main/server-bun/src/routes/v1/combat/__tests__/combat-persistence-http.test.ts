import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia, status } from 'elysia';

import { NotFoundError } from '../../../../lib/errors.js';

const saveCalls: unknown[][] = [];
const readCalls: unknown[][] = [];
const updateCalls: unknown[][] = [];

const savedResult = {
  encounterId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  participants: 0,
  statuses: 0,
  conditions: 0,
  skippedConditions: [],
};

let saveImplementation = async (...args: unknown[]): Promise<typeof savedResult> => {
  saveCalls.push(args);
  return savedResult;
};

let readImplementation = async (...args: unknown[]): Promise<Record<string, unknown>> => {
  readCalls.push(args);
  return {
    participant_id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
    encounter_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    current_hp: 8,
    max_hp: 12,
    temp_hp: 0,
    is_conscious: true,
    death_saves_successes: 0,
    death_saves_failures: 0,
    damage_resistances: [],
    damage_immunities: [],
    damage_vulnerabilities: [],
  };
};

let updateImplementation = async (...args: unknown[]): Promise<Record<string, unknown>> => {
  updateCalls.push(args);
  return readImplementation(args[0], args[2]);
};

const requireAuth = new Elysia({ name: 'test-combat-persistence-auth' }).resolve(
  { as: 'scoped' },
  ({ request }) => {
    if (request.headers.get('x-test-user') !== 'owner') {
      return status(401, { error: 'Unauthorized' });
    }

    return {
      user: { userId: 'owner-1', email: 'owner@example.test', plan: 'free' },
    };
  },
);

mock.module('../../../../middleware/auth.js', () => ({ requireAuth }));
mock.module('../../../../lib/logger.js', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));
mock.module('../../../../services/combat/combat-persistence-service.js', () => ({
  saveCombatPersistence: (...args: unknown[]) => saveImplementation(...args),
  getCombatParticipantStatus: (...args: unknown[]) => readImplementation(...args),
  updateCombatParticipantStatus: (...args: unknown[]) => updateImplementation(...args),
  getCharacterCombatStatus: (...args: unknown[]) => readImplementation(...args),
}));

const { persistenceRoutes } = await import('../persistence.js');
const app = new Elysia().use(persistenceRoutes);

const persistencePayload = {
  sessionId: '11111111-2222-4333-8444-555555555555',
  status: 'active',
  currentRound: 2,
  currentTurnOrder: 0,
  location: null,
  startedAt: '2026-08-12T00:00:00.000Z',
  participants: [],
  statuses: [],
  conditions: [],
};

beforeEach(() => {
  saveCalls.length = 0;
  readCalls.length = 0;
  updateCalls.length = 0;
  saveImplementation = async (...args: unknown[]): Promise<typeof savedResult> => {
    saveCalls.push(args);
    return savedResult;
  };
  readImplementation = async (...args: unknown[]): Promise<Record<string, unknown>> => {
    readCalls.push(args);
    return {
      participant_id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
      encounter_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      current_hp: 8,
      max_hp: 12,
      temp_hp: 0,
      is_conscious: true,
      death_saves_successes: 0,
      death_saves_failures: 0,
      damage_resistances: [],
      damage_immunities: [],
      damage_vulnerabilities: [],
    };
  };
  updateImplementation = async (...args: unknown[]): Promise<Record<string, unknown>> => {
    updateCalls.push(args);
    return readImplementation(args[0], args[2]);
  };
});

describe('combat persistence HTTP boundary', () => {
  it('rejects anonymous persistence before the service can run', async () => {
    const response = await app.handle(
      new Request('http://localhost/encounters/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/persistence', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(persistencePayload),
      }),
    );

    expect(response.status).toBe(401);
    expect(saveCalls).toEqual([]);
  });

  it('passes the authenticated owner to the encounter persistence service', async () => {
    const response = await app.handle(
      new Request('http://localhost/encounters/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/persistence', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-user': 'owner' },
        body: JSON.stringify(persistencePayload),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, ...savedResult });
    expect(saveCalls).toEqual([
      ['aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', persistencePayload, 'owner-1'],
    ]);
  });

  it('masks an ownership miss as not found', async () => {
    saveImplementation = async () => {
      throw new NotFoundError('Session');
    };

    const response = await app.handle(
      new Request('http://localhost/encounters/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/persistence', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-user': 'owner' },
        body: JSON.stringify(persistencePayload),
      }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });

  it('scopes status reads and writes to the authenticated user', async () => {
    const participantId = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
    const readResponse = await app.handle(
      new Request(`http://localhost/participants/${participantId}/status`, {
        headers: { 'x-test-user': 'owner' },
      }),
    );
    const updateResponse = await app.handle(
      new Request(`http://localhost/participants/${participantId}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-test-user': 'owner' },
        body: JSON.stringify({ currentHp: 4 }),
      }),
    );

    expect(readResponse.status).toBe(200);
    expect(updateResponse.status).toBe(200);
    expect(readCalls).toContainEqual([participantId, 'owner-1']);
    expect(updateCalls).toContainEqual([participantId, { currentHp: 4 }, 'owner-1']);
  });
});
