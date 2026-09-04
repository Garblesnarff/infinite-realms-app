/* eslint-disable max-lines -- one cohesive HTTP contract and its local dependency seams. */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia, status } from 'elysia';

import { NotFoundError } from '../../../../lib/errors.js';

const damageLogCalls: unknown[][] = [];
const readCalls: unknown[][] = [];
const updateCalls: unknown[][] = [];

let damageLogImplementation = async (...args: unknown[]): Promise<{ id: string }> => {
  damageLogCalls.push(args);
  return { id: 'cccccccc-dddd-4eee-8fff-000000000000' };
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
  recordCombatDamageLog: (...args: unknown[]) => damageLogImplementation(...args),
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
  damageLogCalls.length = 0;
  readCalls.length = 0;
  updateCalls.length = 0;
  damageLogImplementation = async (...args: unknown[]): Promise<{ id: string }> => {
    damageLogCalls.push(args);
    return { id: 'cccccccc-dddd-4eee-8fff-000000000000' };
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
  });

  it('returns 410 for authenticated persistence callers before any client state is accepted', async () => {
    const response = await app.handle(
      new Request('http://localhost/encounters/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/persistence', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-user': 'owner' },
        body: JSON.stringify(persistencePayload),
      }),
    );

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      error: 'Combat persistence endpoint retired; combat state is server-authoritative',
    });
  });

  it('returns 410 even when the retired route receives no JSON body', async () => {
    const response = await app.handle(
      new Request('http://localhost/encounters/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/persistence', {
        method: 'POST',
        headers: { 'x-test-user': 'owner' },
      }),
    );

    expect(response.status).toBe(410);
  });

  it('rejects anonymous damage-log writes before the service can run', async () => {
    const response = await app.handle(
      new Request('http://localhost/encounters/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/damage-log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          participantId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
          damageAmount: 5,
          damageType: 'piercing',
          sourceParticipantId: null,
          sourceDescription: 'test hit',
          roundNumber: 1,
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(damageLogCalls).toEqual([]);
  });

  it('passes an owned damage log to the authenticated persistence service', async () => {
    const payload = {
      participantId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
      damageAmount: 5,
      damageType: 'piercing',
      sourceParticipantId: null,
      sourceDescription: 'test hit',
      roundNumber: 1,
    };
    const response = await app.handle(
      new Request('http://localhost/encounters/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/damage-log', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-user': 'owner' },
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      id: 'cccccccc-dddd-4eee-8fff-000000000000',
    });
    expect(damageLogCalls).toEqual([['aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', payload, 'owner-1']]);
  });

  it('masks a damage-log ownership miss as not found', async () => {
    damageLogImplementation = async () => {
      throw new NotFoundError('Encounter');
    };

    const response = await app.handle(
      new Request('http://localhost/encounters/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/damage-log', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-user': 'owner' },
        body: JSON.stringify({
          participantId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
          damageAmount: 5,
          damageType: 'piercing',
          sourceParticipantId: null,
          sourceDescription: null,
          roundNumber: 1,
        }),
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
