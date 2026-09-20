import { afterEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

mock.module('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://localhost/test',
    PORT: '3000',
    CORS_ORIGIN: 'http://localhost:3000',
    WORKOS_CLIENT_ID: 'client_test',
  },
}));

mock.module('../../../lib/logger.js', () => ({ logger: noopLogger }));

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const authHeader = request.headers.get('authorization');
    if (authHeader === 'Bearer valid-user-token') {
      return { user: { userId: 'user-1', email: 'user@example.test', plan: 'free' }, error: null };
    }
    return { user: null, error: 'Unauthorized' };
  },
}));

const { wsTicketRoutes } = await import('../ws-ticket.js');
const { resetWsTicketsForTests } = await import('../../../services/ws-ticket.js');

const app = new Elysia().use(wsTicketRoutes);

afterEach(() => {
  resetWsTicketsForTests();
});

describe('POST /v1/ws/ticket', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/ws/ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'sess-1' }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it('mints a short-lived ticket for an authenticated caller', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/ws/ticket', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: 'Bearer valid-user-token',
        },
        body: JSON.stringify({ sessionId: 'sess-1' }),
      }),
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as { ticket?: string; expiresInMs?: number };
    expect(typeof json.ticket).toBe('string');
    expect(json.ticket!.length).toBeGreaterThan(20);
    expect(json.expiresInMs).toBeGreaterThan(0);
  });
});
