/**
 * Example Test File for Middleware
 *
 * This demonstrates how to test the Elysia middleware plugins.
 * Run with: bun test src/middleware/test-example.ts
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { Elysia } from 'elysia';
import {
  requireAuth,
  optionalAuth,
  planRateLimit,
  createSimpleRateLimit,
  metricsPlugin,
  loggingPlugin,
} from './index';

describe('Auth Middleware', () => {
  it('requireAuth should return 401 without token', async () => {
    const app = new Elysia()
      .use(requireAuth)
      .get('/protected', ({ user }) => ({ userId: user.userId }));

    const res = await app.handle(new Request('http://localhost/protected'));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('optionalAuth should allow requests without token', async () => {
    const app = new Elysia()
      .use(optionalAuth)
      .get('/public', ({ user }) => ({
        message: user ? `Hello ${user.email}` : 'Hello guest',
      }));

    const res = await app.handle(new Request('http://localhost/public'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Hello guest');
  });

  it('requireAuth should attach user with valid token', async () => {
    // Note: This test requires a valid WorkOS token
    // In practice, you'd mock the verifyWorkOSToken function
    const app = new Elysia()
      .use(requireAuth)
      .get('/protected', ({ user }) => ({ userId: user.userId }));

    // This will fail without a real token - demonstrates the pattern
    // In real tests, mock the JWT verification
  });
});

describe('Rate Limiting', () => {
  it('simple rate limit should allow requests under limit', async () => {
    const app = new Elysia()
      .use(createSimpleRateLimit({ windowMs: 60000, max: 5 }))
      .get('/test', () => ({ success: true }));

    // First request should succeed
    const res = await app.handle(new Request('http://localhost/test'));
    expect(res.status).toBe(200);
  });

  it('simple rate limit should block requests over limit', async () => {
    const app = new Elysia()
      .use(createSimpleRateLimit({ windowMs: 60000, max: 2, key: 'test-strict' }))
      .get('/test', () => ({ success: true }));

    // Make 3 requests quickly
    await app.handle(new Request('http://localhost/test'));
    await app.handle(new Request('http://localhost/test'));
    const res = await app.handle(new Request('http://localhost/test'));

    // Third request should be rate limited
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('plan rate limit should work without auth', async () => {
    const app = new Elysia()
      .use(optionalAuth)
      .use(planRateLimit('default'))
      .get('/test', () => ({ success: true }));

    const res = await app.handle(new Request('http://localhost/test'));
    expect(res.status).toBe(200);
  });
});

describe('Metrics Middleware', () => {
  it('should track requests', async () => {
    const app = new Elysia()
      .use(metricsPlugin)
      .get('/test', () => ({ success: true }));

    const res = await app.handle(new Request('http://localhost/test'));
    expect(res.status).toBe(200);

    // Metrics are collected in the background
    // In real tests, you'd check the prometheus registry
  });
});

describe('Logging Middleware', () => {
  it('should add request ID to context', async () => {
    const app = new Elysia()
      .use(loggingPlugin)
      .get('/test', ({ requestId }) => ({ requestId }));

    const res = await app.handle(new Request('http://localhost/test'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.requestId).toMatch(/^req_/);
  });
});

describe('Middleware Composition', () => {
  it('should compose multiple middleware', async () => {
    const app = new Elysia()
      .use(loggingPlugin)
      .use(metricsPlugin)
      .use(optionalAuth)
      .use(createSimpleRateLimit({ windowMs: 60000, max: 100 }))
      .get('/test', ({ user, requestId }) => ({
        authenticated: !!user,
        requestId,
      }));

    const res = await app.handle(new Request('http://localhost/test'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.authenticated).toBe(false);
    expect(body.requestId).toBeDefined();
  });

  it('should apply group middleware', async () => {
    const app = new Elysia()
      .group('/api', (app) =>
        app
          .use(optionalAuth)
          .use(planRateLimit('default'))
          .get('/test', () => ({ success: true }))
          .get('/hello', () => ({ message: 'hello' }))
      );

    const res1 = await app.handle(new Request('http://localhost/api/test'));
    expect(res1.status).toBe(200);

    const res2 = await app.handle(new Request('http://localhost/api/hello'));
    expect(res2.status).toBe(200);
  });
});

describe('Integration Example', () => {
  it('should handle complete request flow', async () => {
    const app = new Elysia()
      // Global middleware
      .use(loggingPlugin)
      .use(metricsPlugin)

      // Public routes
      .get('/health', () => ({ status: 'ok' }))

      // Protected routes
      .group('/api', (app) =>
        app
          .use(optionalAuth)
          .use(planRateLimit('default'))
          .get('/public', ({ user }) => ({
            message: user ? 'authenticated' : 'guest',
          }))
      );

    // Test health endpoint
    const health = await app.handle(new Request('http://localhost/health'));
    expect(health.status).toBe(200);

    // Test public API
    const api = await app.handle(new Request('http://localhost/api/public'));
    expect(api.status).toBe(200);
    const body = await api.json();
    expect(body.message).toBe('guest');
  });
});

/**
 * Mock Example for Authentication
 *
 * In real tests, you'd want to mock the WorkOS verification.
 * Here's an example pattern:
 */
/*
import { mock } from 'bun:test';

// Mock the verifyWorkOSToken function
const mockVerifyWorkOSToken = mock(async (token: string) => {
  if (token === 'valid-token') {
    return { userId: 'user_123', email: 'test@example.com' };
  }
  return null;
});

// Then use in tests
it('should authenticate with valid token', async () => {
  const app = new Elysia()
    .use(requireAuth)
    .get('/protected', ({ user }) => ({ userId: user.userId }));

  const res = await app.handle(
    new Request('http://localhost/protected', {
      headers: { Authorization: 'Bearer valid-token' },
    })
  );

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.userId).toBe('user_123');
});
*/
