import { describe, expect, it } from 'bun:test';

// Same placeholder-env boot as create-app-boot-smoke.test.ts: createApp()'s
// import graph constructs the DB and WorkOS clients, but /health never queries
// or calls them.
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

  async function getHeaders(path: string): Promise<Headers> {
    const res = await app.handle(new Request(`http://localhost${path}`));
    expect(res.status).toBe(200);
    return res.headers;
  }

  it.each(['/health', '/version'])(
    'sends the CSP report-only (not enforcing) on %s',
    async (path) => {
      // /version is a mounted route (.use(versionRoutes)); probing it proves
      // the onBeforeHandle hook registered in createApp() propagates to
      // mounted routers, not just inline routes.
      const headers = await getHeaders(path);
      // Enforcing CSP must be gone: a violation must not break the app or SEO pages.
      expect(headers.get('content-security-policy')).toBeNull();
      const reportOnly = headers.get('content-security-policy-report-only');
      expect(reportOnly).not.toBeNull();
      expect(reportOnly).toContain("default-src 'self'");
      expect(reportOnly).toContain("frame-ancestors 'none'");
    },
  );

  it.each(['/health', '/version'])(
    'sends X-Content-Type-Options and Referrer-Policy on %s',
    async (path) => {
      const headers = await getHeaders(path);
      expect(headers.get('x-content-type-options')).toBe('nosniff');
      expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    },
  );
});
