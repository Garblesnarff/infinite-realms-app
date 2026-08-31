/**
 * Real-request boundary checks for routes that have historically only had
 * unit-level coverage. All infrastructure dependencies are mocked so this
 * suite remains independent of DATABASE_URL and external services.
 */
import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

import type { AuthTokenPayload } from '../../../middleware/auth.js';

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

class MockRowList<T> extends Array<T> {
  static get [Symbol.species](): ArrayConstructor {
    return Array;
  }
}

mock.module('../../../lib/db.js', () => ({ sql: async () => new MockRowList() }));
mock.module('../../../lib/env.js', () => ({ env: { WORKOS_CLIENT_ID: 'test-client' } }));
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const authHeader = request.headers.get('x-test-user');
    if (authHeader === 'member') {
      return {
        user: { userId: 'member-1', email: 'member@example.test', plan: 'free' },
        error: null,
      };
    }
    if (authHeader === 'admin') {
      return { user: { userId: 'admin-1', email: 'admin@example.test', plan: 'pro' }, error: null };
    }
    return { user: null, error: 'Unauthorized' };
  },
}));
mock.module('../../../lib/logger.js', () => ({ logger: noopLogger }));
mock.module('../../../lib/supabase.js', () => ({
  supabaseService: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              id: 'key_1',
              name: 'test key',
              permissions: ['create_release_post'],
              expires_at: null,
              disabled: false,
            },
            error: null,
          }),
        }),
      }),
    }),
  },
}));
mock.module('../../../middleware/admin.js', () => ({
  isAdmin: (user: AuthTokenPayload | null) => user && user.userId === 'admin-1',
  requireAdmin: new Elysia({ name: 'test-require-admin' }).onBeforeHandle((context) => {
    const { set } = context;
    const user = (context as typeof context & { user?: AuthTokenPayload | null }).user;
    if (!user || user.userId !== 'admin-1') {
      set.status = 403;
      return { error: 'Admin access required' };
    }
  }),
}));
mock.module('../../../middleware/rate-limit.js', () => ({
  createSimpleRateLimit: () => new Elysia({ name: 'test-simple-rate-limit' }),
  planRateLimit: () => new Elysia({ name: 'test-plan-rate-limit' }),
}));
mock.module('../../../../../db/client', () => ({
  db: { query: { waitlist: { findFirst: async () => null } } },
}));
mock.module('../../../services/email-service.js', () => ({
  sendWaitlistConfirmation: async () => {},
}));
mock.module('../combat/helpers.js', () => ({
  verifySessionOwnership: async (sessionId: string, _userId: string) => {
    if (sessionId === 'owned-session-id') {
      return { success: true };
    }
    return { success: false, error: { status: 404, message: 'Session not found' } };
  },
}));

const { waitlistRoutes } = await import('../waitlist.js');
const { observabilityRoutes } = await import('../observability.js');
const { adminRoutes } = await import('../admin.js');
const { internalRoutes } = await import('../internal.js');
const { encountersRoutes } = await import('../encounters.js');

const app = new Elysia()
  .use(waitlistRoutes)
  .use(observabilityRoutes)
  .use(adminRoutes)
  .use(internalRoutes)
  .use(encountersRoutes);

describe('v1 route API boundaries', () => {
  it('denies unauthenticated waitlist stats instead of falling through to 200', async () => {
    const response = await app.handle(new Request('http://localhost/v1/waitlist/stats'));

    expect(response.status).toBe(401);
  });

  it('denies unauthenticated admin requests and non-admin users', async () => {
    const anonymous = await app.handle(new Request('http://localhost/v1/admin/archive-statistics'));
    const member = await app.handle(
      new Request('http://localhost/v1/admin/archive-statistics', {
        headers: { 'x-test-user': 'member' },
      }),
    );
    const admin = await app.handle(
      new Request('http://localhost/v1/admin/archive-statistics', {
        headers: { 'x-test-user': 'admin' },
      }),
    );

    expect(anonymous.status).toBe(401);
    expect(member.status).toBe(403);
    // Since we mock supabaseService which has no real statistics from table, it might throw/fail in the service call.
    // However, the route-level role authentication checks have passed if it goes past 403.
    expect(admin.status).not.toBe(401);
    expect(admin.status).not.toBe(403);
  });

  it('denies unauthenticated encounter requests', async () => {
    const telemetryResponse = await app.handle(
      new Request('http://localhost/v1/encounters/telemetry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'owned-session-id',
          difficulty: 'hard',
          resourcesUsedEst: 0.3,
        }),
      }),
    );
    const adjustmentResponse = await app.handle(
      new Request(
        'http://localhost/v1/encounters/adjustment?sessionId=owned-session-id&difficulty=hard',
      ),
    );

    expect(telemetryResponse.status).toBe(401);
    expect(adjustmentResponse.status).toBe(401);
  });

  it('enforces session ownership for encounter telemetry and adjustment', async () => {
    // 1) Telemetry owned session
    const telemetryOwned = await app.handle(
      new Request('http://localhost/v1/encounters/telemetry', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-user': 'member',
        },
        body: JSON.stringify({
          sessionId: 'owned-session-id',
          difficulty: 'hard',
          resourcesUsedEst: 0.3,
        }),
      }),
    );
    expect(telemetryOwned.status).toBe(200);

    // 2) Telemetry unowned session
    const telemetryUnowned = await app.handle(
      new Request('http://localhost/v1/encounters/telemetry', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-user': 'member',
        },
        body: JSON.stringify({
          sessionId: 'unowned-session-id',
          difficulty: 'hard',
          resourcesUsedEst: 0.3,
        }),
      }),
    );
    expect(telemetryUnowned.status).toBe(404);

    // 3) Adjustment owned session
    const adjustmentOwned = await app.handle(
      new Request(
        'http://localhost/v1/encounters/adjustment?sessionId=owned-session-id&difficulty=hard',
        {
          headers: { 'x-test-user': 'member' },
        },
      ),
    );
    expect(adjustmentOwned.status).toBe(200);

    // 4) Adjustment unowned session
    const adjustmentUnowned = await app.handle(
      new Request(
        'http://localhost/v1/encounters/adjustment?sessionId=unowned-session-id&difficulty=hard',
        {
          headers: { 'x-test-user': 'member' },
        },
      ),
    );
    expect(adjustmentUnowned.status).toBe(404);
  });

  // Regression for bead -4ru: requireApiKey must be { as: 'scoped' } or it is
  // silently inert and this request reaches the handler.
  it('denies unauthenticated internal automation requests instead of creating a post', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/internal/release-post', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: '1.0.0', changelog: 'Notes' }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it('returns 422 for schema-invalid public observability and authorized internal bodies', async () => {
    const invalidMetric = await app.handle(
      new Request('http://localhost/v1/observability/metric', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      }),
    );
    const invalidRelease = await app.handle(
      new Request('http://localhost/v1/internal/release-post', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
        body: JSON.stringify({ version: 'not a version', changelog: '' }),
      }),
    );

    expect(invalidMetric.status).toBe(422);
    expect(invalidRelease.status).toBe(422);
  });
});
