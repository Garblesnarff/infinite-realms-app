import { describe, expect, it } from 'bun:test';

import {
  hasRouteAuthGuard,
  isParameterizedPostgresSqlLine,
  isServerRouteFile,
  isUnsafeSqlLine,
  looksLikeSqlExecution,
  shouldCheckRouteAuth,
  shouldCheckRouteRateLimit,
  hasRouteRateLimit,
} from './security-lint.js';

describe('security-lint heuristics', () => {
  it('only applies route auth checks to server route handlers', () => {
    expect(isServerRouteFile('server-bun/src/routes/v1/billing.ts')).toBe(true);
    expect(isServerRouteFile('src/routes/ProtectedAppRoutes.tsx')).toBe(false);
    expect(
      shouldCheckRouteAuth('server-bun/src/routes/v1/__tests__/billing.test.ts', '.post('),
    ).toBe(false);
    expect(
      shouldCheckRouteAuth(
        'server-bun/src/routes/v1/session-list-handler.ts',
        'export function x() {}',
      ),
    ).toBe(false);
    expect(
      shouldCheckRouteAuth('server-bun/src/routes/v1/public-campaign-templates.ts', '.get('),
    ).toBe(false);
    // #2293: GET /version is public by design; it must be skipped, not flagged MISSING_AUTH.
    expect(shouldCheckRouteAuth('server-bun/src/routes/version.ts', ".get('/version'")).toBe(false);
  });

  it('recognizes manual request guards used by the server routes', () => {
    expect(hasRouteAuthGuard('const { user } = await authenticateRequest(request);')).toBe(true);
    expect(hasRouteAuthGuard('const auth = await requireBlogAdminAuth(request);')).toBe(true);
    expect(hasRouteAuthGuard('.use(requireApiKey)')).toBe(true);
    expect(hasRouteAuthGuard('if (!headers.authorization) return unauthorized();')).toBe(true);
  });

  it('only applies rate-limit checks to executable server route handlers', () => {
    expect(
      shouldCheckRouteRateLimit(
        'server-bun/src/routes/v1/billing.ts',
        "new Elysia().post('/checkout', handler)",
      ),
    ).toBe(true);
    expect(
      shouldCheckRouteRateLimit(
        'server-bun/src/routes/v1/session-list-handler.ts',
        'export function list() {}',
      ),
    ).toBe(false);
    expect(
      shouldCheckRouteRateLimit(
        'server-bun/src/routes/v1/blog/helpers.ts',
        'await supabase.from("posts").delete().eq("id", postId)',
      ),
    ).toBe(false);
    expect(
      shouldCheckRouteRateLimit(
        'server-bun/src/routes/v1/__tests__/billing.test.ts',
        "new Elysia().post('/checkout', handler)",
      ),
    ).toBe(false);
    expect(
      shouldCheckRouteRateLimit(
        'src/routes/ProtectedAppRoutes.tsx',
        "new Elysia().get('/app', handler)",
      ),
    ).toBe(false);
    expect(
      shouldCheckRouteRateLimit(
        'server-bun/src/routes/v1/._billing.ts',
        "new Elysia().post('/checkout', handler)",
      ),
    ).toBe(false);
  });

  it('recognizes both plan-aware and simple rate-limit middleware calls', () => {
    expect(hasRouteRateLimit("app.use(planRateLimit('default'))")).toBe(true);
    expect(hasRouteRateLimit('app.use(createSimpleRateLimit({ max: 5 }))')).toBe(true);
    expect(hasRouteRateLimit('const limiter = createRateLimiter(options)')).toBe(true);
    expect(hasRouteRateLimit('import { planRateLimit } from "./rate-limit"')).toBe(false);
  });

  it('trusts parameterized postgres templates but keeps unsafe SQL actionable', () => {
    const safeLine = 'await sql`SELECT * FROM users WHERE id = ${userId}`;';
    const rawLine = 'await db.execute(`SELECT * FROM users WHERE id = ${userId}`);';
    const unsafeLine = 'await sql.unsafe(query);';

    expect(looksLikeSqlExecution(safeLine)).toBe(true);
    expect(isParameterizedPostgresSqlLine(safeLine)).toBe(true);
    expect(looksLikeSqlExecution(rawLine)).toBe(true);
    expect(isParameterizedPostgresSqlLine(rawLine)).toBe(false);
    expect(isUnsafeSqlLine(unsafeLine)).toBe(true);
  });
});
