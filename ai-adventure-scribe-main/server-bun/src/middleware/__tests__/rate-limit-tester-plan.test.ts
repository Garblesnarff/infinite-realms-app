import { describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';

import { planRateLimit } from '../rate-limit.js';

const post = (path: string, ip: string) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, 'x-plan': 'enterprise' },
    body: JSON.stringify({}),
  });

const statuses = async (plan: string, ip: string, calls: number): Promise<number[]> => {
  const app = new Elysia({ prefix: '/t' })
    .resolve(() => ({ user: { userId: `user-${plan}`, plan } }))
    .use(
      planRateLimit({
        key: `test-tester-plan-${plan}-${Date.now()}`,
        perIp: { windowMs: 60_000, maxByPlan: { free: 1, pro: 3, enterprise: 5 } },
      }),
    )
    .post('/', () => ({ ok: true }));
  const out: number[] = [];
  for (let i = 0; i < calls; i += 1) out.push((await app.handle(post('/t/', ip))).status);
  return out;
};

describe('plan rate limit buckets (#2474)', () => {
  it('lets a tester through up to the pro limit', async () => {
    expect(await statuses('tester', '203.0.113.31', 4)).toEqual([200, 200, 200, 429]);
  });

  it('still limits free at the free bucket', async () => {
    expect(await statuses('free', '203.0.113.32', 2)).toEqual([200, 429]);
  });

  it('still limits an unknown plan at the free bucket', async () => {
    expect(await statuses('platinum', '203.0.113.33', 2)).toEqual([200, 429]);
  });
});
