import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const log = { debug() {}, info() {}, warn() {}, error() {} };
let row: { plan: string } | null = null;
mock.module('../lib/db.js', () => ({ sql: async () => (row ? [row] : []) }));
mock.module('../lib/logger.js', () => ({ logger: log }));
mock.module('../services/workos.js', () => ({
  verifyWorkOSToken: async (t: string) => (t === 'ok' ? { userId: 'u1', email: 'a@b.c' } : null),
}));
mock.module('../../../db/client', () => ({ db: {} }));
const { requireAuth } = await import('../middleware/auth.js');
const { createContext } = await import('../trpc/context.js');
const { protectedProcedure, router } = await import('../trpc/trpc.js');
const { UserPlanCache } = await import('../lib/user-plan-cache.js');
const rest = new Elysia().use(requireAuth).get('/me', ({ user }) => ({ plan: user.plan }));
const api = router({ plan: protectedProcedure.query(({ ctx }) => ctx.user.plan) });
async function both(xPlan: string) {
  const headers = { authorization: 'Bearer ok', 'x-plan': xPlan };
  const req = new Request('http://localhost/trpc', { headers });
  const ctx = await createContext({ req, resHeaders: new Headers() } as never);
  const trpcPlan = await api.createCaller(ctx).plan();
  const body = await (await rest.handle(new Request('http://localhost/me', { headers }))).json();
  return { restPlan: body.plan, trpcPlan };
}
describe('one resolveUserPlan', () => {
  it('agrees for non-prod X-Plan and a user with no row', async () => {
    process.env.NODE_ENV = 'test';
    for (const stored of ['Pro', null] as const) {
      UserPlanCache.clear();
      row = stored ? { plan: stored } : null;
      const plan = stored ? 'pro' : 'free';
      expect(await both('Enterprise')).toEqual({ restPlan: plan, trpcPlan: plan });
    }
  });
});
