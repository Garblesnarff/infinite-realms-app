import { describe, expect, it } from 'bun:test';

// Same placeholder-env boot as create-app-boot-smoke.test.ts: createApp()'s
// import graph constructs the DB and WorkOS clients, but the probed routes
// never query or call them.
process.env.DATABASE_URL ??= 'postgres://sec-headers:sec-headers@127.0.0.1:1/sec_headers';
process.env.WORKOS_API_KEY ??= 'test-dummy-key';
process.env.WORKOS_CLIENT_ID ??= 'test-dummy-client-id';
process.env.PORT ??= '3101';
process.env.CORS_ORIGIN ??= 'http://localhost:3101';
process.env.SUPABASE_URL ??= 'http://127.0.0.1:1';
process.env.SUPABASE_ANON_KEY ??= 'test-dummy-anon';
process.env.RESEND_API_KEY ??= 'test-dummy-resend';

const { createApp } = await import('../app.js');

describe('security headers (#225)', () => {
  const app = createApp();

  async function get(path: string): Promise<{ status: number; headers: Headers }> {
    const res = await app.handle(new Request(`http://localhost${path}`));
    return { status: res.status, headers: res.headers };
  }

  function expectSecurityHeaders(headers: Headers): void {
    // Enforcing CSP must be gone: a violation must not break the app or SEO pages.
    expect(headers.get('content-security-policy')).toBeNull();
    const reportOnly = headers.get('content-security-policy-report-only');
    expect(reportOnly).not.toBeNull();
    expect(reportOnly).toContain("default-src 'self'");
    expect(reportOnly).toContain("frame-ancestors 'none'");
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('x-frame-options')).toBe('DENY');
  }

  it.each(['/health', '/version'])('sends security headers on %s', async (path) => {
    // /version is a mounted route (.use(versionRoutes)); probing it proves the
    // onBeforeHandle hook propagates to mounted routers, not just inline routes.
    const { status, headers } = await get(path);
    expect(status).toBe(200);
    expectSecurityHeaders(headers);
  });

  it('sends security headers on the SEO landing route /ai-game-master', async () => {
    const { status, headers } = await get('/ai-game-master');
    expect(status).toBe(200);
    expectSecurityHeaders(headers);
  });

  it('sends security headers on a static-asset miss', async () => {
    // No dist/ in the test env, so this 404s through the static plugin.
    // The onError hook must cover it: onBeforeHandle never runs here.
    const { status, headers } = await get('/assets/app-abc123.js');
    expect(status).toBe(404);
    expectSecurityHeaders(headers);
  });

  it('sends security headers on a 404', async () => {
    const { status, headers } = await get('/v1/nonexistent');
    expect(status).toBe(404);
    expectSecurityHeaders(headers);
  });
});
