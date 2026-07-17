/**
 * Regression test: rate limiters must actually fire when .use()d by a parent.
 *
 * Elysia plugin hooks are LOCAL-scoped by default — a hook-only plugin
 * (no routes of its own) silently never applies to the parent's routes
 * unless the hook is registered with { as: 'scoped' }. This exact bug
 * shipped to production on 2026-07-14: waitlist/observability/llm/images
 * rate limits were wired via .use(limiter) but never blocked anything.
 *
 * These tests exercise the REAL usage pattern from the route files:
 *   new Elysia({ prefix }).use(limiter).post('/', handler)
 */

import { describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';

import { createSimpleRateLimit, planRateLimit } from '../rate-limit.js';

function req(path: string, ip: string) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({}),
  });
}

describe('rate limiter plugin scoping (regression)', () => {
  it('createSimpleRateLimit blocks parent routes past the limit', async () => {
    const app = new Elysia({ prefix: '/t1' })
      .use(createSimpleRateLimit({ windowMs: 60_000, max: 2, key: `test-simple-${Date.now()}` }))
      .post('/', () => ({ ok: true }));

    const s1 = (await app.handle(req('/t1/', '203.0.113.9'))).status;
    const s2 = (await app.handle(req('/t1/', '203.0.113.9'))).status;
    const r3 = await app.handle(req('/t1/', '203.0.113.9'));

    expect(s1).toBe(200);
    expect(s2).toBe(200);
    expect(r3.status).toBe(429);
    expect(r3.headers.get('Retry-After')).toBeTruthy();
  });

  it('planRateLimit blocks parent routes past the per-IP limit', async () => {
    const key = `test-plan-${Date.now()}`;
    const app = new Elysia({ prefix: '/t2' })
      .use(
        planRateLimit({
          key,
          perIp: { windowMs: 60_000, maxByPlan: { free: 2, pro: 2, enterprise: 2 } },
        }),
      )
      .post('/', () => ({ ok: true }));

    const s1 = (await app.handle(req('/t2/', '203.0.113.10'))).status;
    const s2 = (await app.handle(req('/t2/', '203.0.113.10'))).status;
    const r3 = await app.handle(req('/t2/', '203.0.113.10'));

    expect(s1).toBe(200);
    expect(s2).toBe(200);
    expect(r3.status).toBe(429);
  });

  it('limits are tracked per key, not shared across limiters', async () => {
    const app = new Elysia()
      .use(createSimpleRateLimit({ windowMs: 60_000, max: 1, key: `test-iso-a-${Date.now()}` }))
      .post('/a', () => ({ ok: true }));

    const other = new Elysia()
      .use(createSimpleRateLimit({ windowMs: 60_000, max: 1, key: `test-iso-b-${Date.now()}` }))
      .post('/b', () => ({ ok: true }));

    expect((await app.handle(req('/a', '203.0.113.11'))).status).toBe(200);
    expect((await app.handle(req('/a', '203.0.113.11'))).status).toBe(429);
    // Different limiter key + instance: unaffected
    expect((await other.handle(req('/b', '203.0.113.11'))).status).toBe(200);
  });
});
