import { describe, expect, it } from 'bun:test';

// createApp()'s import graph constructs the DB client and the WorkOS client.
// The isolated server suite sets none of these. /health and /metrics do not
// query or call WorkOS, so placeholders are enough.
process.env.DATABASE_URL ??= 'postgres://boot-smoke:boot-smoke@127.0.0.1:1/boot_smoke';
process.env.WORKOS_API_KEY ??= 'test-dummy-key';
process.env.WORKOS_CLIENT_ID ??= 'test-dummy-client-id';
process.env.PORT ??= '3100';
process.env.CORS_ORIGIN ??= 'http://localhost:3100';
process.env.SUPABASE_URL ??= 'http://127.0.0.1:1';
process.env.SUPABASE_ANON_KEY ??= 'test-dummy-anon';
process.env.RESEND_API_KEY ??= 'test-dummy-resend';

const { createApp } = await import('../app.js');
const { buildHealthPayload } = await import('../lib/health-payload.js');
const { register } = await import('../lib/metrics.js');

describe('createApp boot smoke (#2674 step 1)', () => {
  const app = createApp();

  it('GET /health returns the buildHealthPayload shape', async () => {
    const response = await app.handle(new Request('http://localhost/health'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as ReturnType<typeof buildHealthPayload>;
    const produced = buildHealthPayload();
    expect(Object.keys(body).sort()).toEqual(Object.keys(produced).sort());
    expect(body.imageModel).toBe(produced.imageModel);
    expect(body.status).toBe(produced.status);
    expect(body.modelHealth).toEqual(produced.modelHealth);
  });

  it('GET /metrics returns the live registry', async () => {
    const response = await app.handle(new Request('http://localhost/metrics'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(register.contentType);
    const text = await response.text();
    expect(text).toContain('# TYPE http_requests_total counter');
    expect(text).toContain('# TYPE http_request_duration_seconds histogram');
  });
});
