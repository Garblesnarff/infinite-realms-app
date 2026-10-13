/**
 * Real-request contract checks for the narrative fact boundary.
 * Dependencies are injected so this stays independent of DATABASE_URL without a process-wide
 * module mock while still proving auth, schema validation, JSON serialization, and propagation
 * of the authenticated owner.
 */
import { describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';

import type { NarrativeFactRouteOptions } from '../narrative-facts.js';

const calls: Array<{ method: string; sessionId: string; userId: string }> = [];

process.env.DATABASE_URL ??= 'postgres://localhost/test';
process.env.PORT ??= '3000';
process.env.CORS_ORIGIN ??= 'http://localhost:3000';
process.env.WORKOS_API_KEY ??= 'test-api-key';
process.env.WORKOS_CLIENT_ID ??= 'test-client-id';

const requireAuth = new Elysia({ name: 'test-narrative-auth' })
  .onBeforeHandle({ as: 'scoped' }, ({ request, set }) => {
    if (request.headers.get('x-test-user') !== 'member') {
      set.status = 401;
      return { error: 'Unauthorized' };
    }
  })
  .resolve({ as: 'scoped' }, () => ({
    user: { userId: 'member-1', email: 'member@example.test', plan: 'free' },
  }));

const ledger = {
  currentFacts: async (sessionId: string, userId: string) => {
    calls.push({ method: 'currentFacts', sessionId, userId });
    return [
      {
        id: 'fact-1',
        sessionId,
        campaignId: null,
        subjectType: 'npc',
        subjectName: 'the void-maw',
        predicate: 'status',
        value: { state: 'dead' },
        knownBy: ['dm'],
        isBelief: false,
        source: 'engine',
        turnIndex: null,
        messageId: null,
        needsReview: false,
        validFrom: new Date('2026-08-01T00:00:00Z'),
        invalidatedAt: null,
        invalidatedBy: null,
        createdAt: new Date('2026-08-01T00:00:00Z'),
      },
    ];
  },
  renderSceneState: async (sessionId: string, userId: string) => {
    calls.push({ method: 'renderSceneState', sessionId, userId });
    return '<scene_state>authoritative</scene_state>';
  },
  history: async () => [],
  assertFact: async () => ({ rejected: false, action: 'inserted', fact: {} }),
};

const { createNarrativeFactRoutes } = await import('../narrative-facts.js');
const app = new Elysia().use(
  createNarrativeFactRoutes({
    auth: requireAuth as unknown as NonNullable<NarrativeFactRouteOptions['auth']>,
    ledger: ledger as unknown as NonNullable<NarrativeFactRouteOptions['ledger']>,
  }),
);

describe('narrative fact HTTP boundary', () => {
  it('no bearer and no body currently returns 422 (desired 401)', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/narrative-facts/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
    );
    // Desired: 401. TypeBox body schema currently runs before requireAuth (#2120).
    expect(response.status).toBe(422);
  });

  it('rejects anonymous scene-state reads before the handler runs', async () => {
    calls.length = 0;
    const response = await app.handle(
      new Request('http://localhost/v1/narrative-facts/scene-state?session_id=session-1'),
    );

    expect(response.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('returns JSON scene state and passes the authenticated owner to the service', async () => {
    calls.length = 0;
    const response = await app.handle(
      new Request('http://localhost/v1/narrative-facts/scene-state?session_id=session-1', {
        headers: { 'x-test-user': 'member' },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({
      scene_state: '<scene_state>authoritative</scene_state>',
    });
    expect(calls).toEqual([
      { method: 'renderSceneState', sessionId: 'session-1', userId: 'member-1' },
    ]);
  });

  it('serializes current facts and validates the required session query', async () => {
    calls.length = 0;
    const factsResponse = await app.handle(
      new Request('http://localhost/v1/narrative-facts/?session_id=session-1', {
        headers: { 'x-test-user': 'member' },
      }),
    );
    const invalidResponse = await app.handle(
      new Request('http://localhost/v1/narrative-facts/', {
        headers: { 'x-test-user': 'member' },
      }),
    );

    expect(factsResponse.status).toBe(200);
    expect(await factsResponse.json()).toEqual([
      expect.objectContaining({
        session_id: 'session-1',
        subject_name: 'the void-maw',
        value: { state: 'dead' },
        source: 'engine',
      }),
    ]);
    expect(invalidResponse.status).toBe(422);
    expect(calls).toContainEqual({
      method: 'currentFacts',
      sessionId: 'session-1',
      userId: 'member-1',
    });
  });
});
