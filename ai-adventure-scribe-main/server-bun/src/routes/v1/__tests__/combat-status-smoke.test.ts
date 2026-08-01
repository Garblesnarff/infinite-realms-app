/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Real-request boundary checks for combat status and conditions routes.
 * Independent of DATABASE_URL and external services.
 */
import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

class MockRowList<T> extends Array<T> {
  static get [Symbol.species]() {
    return Array;
  }
}

// Mock database and env modules before other imports load them
mock.module('../../../lib/db.js', () => ({ sql: async () => new MockRowList() }));
mock.module('../../../lib/env.js', () => ({ env: { WORKOS_CLIENT_ID: 'test-client' } }));

// Mock auth module
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const authHeader = request.headers.get('authorization');
    if (authHeader === 'Bearer valid-user-token') {
      return { user: { userId: 'user-1', email: 'user@example.test', plan: 'free' }, error: null };
    }
    return { user: null, error: 'Unauthorized' };
  },
}));

// Mock logger module
mock.module('../../../lib/logger.js', () => ({ logger: noopLogger }));

// Mock helpers for verification using absolute resolved path
const mockEncounterVerificationResult: any = { success: true, encounter: { currentRound: 1 } };
const helpersPath = import.meta.resolve('../combat/helpers.js');
mock.module(helpersPath, () => ({
  verifyEncounterOwnership: async (encounterId: string, _userId: string) => {
    if (encounterId === 'valid-encounter-id') {
      return mockEncounterVerificationResult;
    }
    return { success: false, error: { status: 404, message: 'Encounter not found' } };
  },
  verifySessionOwnership: async (_sessionId: string, _userId: string) => {
    return { success: true };
  },
}));

// Mock conditions service
let lastAppliedCondition: any = null;
mock.module('../../../services/conditions-service.js', () => ({
  ConditionsService: {
    applyCondition: async (...args: any[]) => {
      lastAppliedCondition = args;
      return { condition: { id: 'cond-1' }, warnings: [] };
    },
    removeCondition: async () => true,
    attemptSave: async () => ({ saved: true, conditionRemoved: true, message: 'Saved' }),
  },
}));

// Mock query service and db
mock.module('../../../services/conditions/condition-query-service.js', () => ({
  ConditionQueryService: {
    getActiveConditions: async () => [],
    getConditionsLibrary: async () => [],
  },
}));

mock.module('../../../../../db/client', () => ({
  db: {
    query: {
      combatEncounters: {
        findFirst: async () => ({
          id: 'valid-encounter-id',
          currentRound: 1,
          participants: [],
        }),
      },
    },
  },
}));

const { statusRoutes } = await import('../combat/status.js');

const app = new Elysia().use(statusRoutes);

describe('v1 combat status routes API boundaries', () => {
  it('denies unauthenticated requests on apply condition', async () => {
    const response = await app.handle(
      new Request('http://localhost/valid-encounter-id/conditions/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          participantId: 'part-1',
          conditionName: 'blinded',
          durationType: 'round',
        }),
      })
    );

    expect(response.status).toBe(401);
  });

  it('denies unauthorized encounter access on apply condition', async () => {
    const response = await app.handle(
      new Request('http://localhost/invalid-encounter-id/conditions/apply', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer valid-user-token',
        },
        body: JSON.stringify({
          participantId: 'part-1',
          conditionName: 'blinded',
          durationType: 'round',
        }),
      })
    );

    expect(response.status).toBe(404);
  });

  it('successfully applies condition for authenticated and authorized requests', async () => {
    const response = await app.handle(
      new Request('http://localhost/valid-encounter-id/conditions/apply', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer valid-user-token',
        },
        body: JSON.stringify({
          participantId: 'part-1',
          conditionName: 'blinded',
          durationType: 'round',
          durationValue: 1,
          saveDc: 15,
          saveAbility: 'constitution',
          source: 'spell',
        }),
      })
    );

    expect(response.status).toBe(201);
    const json: any = await response.json();
    expect(json.success).toBe(true);
    expect(json.condition.id).toBe('cond-1');
    expect(lastAppliedCondition).toBeDefined();
    expect(lastAppliedCondition[0]).toBe('part-1');
  });
});
