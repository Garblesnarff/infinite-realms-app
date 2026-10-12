import { describe, expect, it } from 'bun:test';

process.env.DATABASE_URL ??= 'postgres://boot-smoke:boot-smoke@127.0.0.1:1/boot_smoke';
process.env.WORKOS_API_KEY ??= 'test-dummy-key';
process.env.WORKOS_CLIENT_ID ??= 'test-dummy-client-id';
process.env.PORT ??= '3100';
process.env.CORS_ORIGIN ??= 'https://infiniterealms.app';
process.env.SUPABASE_URL ??= 'http://127.0.0.1:1';
process.env.SUPABASE_ANON_KEY ??= 'test-dummy-anon';
process.env.RESEND_API_KEY ??= 'test-dummy-resend';

const { createApp } = await import('../app.js');

const ORIGIN = 'https://infiniterealms.app';
const PATHS = [
  '/v1/memories',
  '/v1/memories/00000000-0000-4000-8000-000000000000',
  '/v1/memory-extraction/jobs',
  '/v1/sessions',
  '/v1/sessions/00000000-0000-4000-8000-000000000000/messages',
  '/v1/companions',
  '/v1/voice-mappings',
];

describe('CORS preflight (#422)', () => {
  const app = createApp();
  for (const path of PATHS) {
    it(`OPTIONS ${path} returns 204 with CORS headers`, async () => {
      const res = await app.handle(
        new Request(`http://localhost${path}`, {
          method: 'OPTIONS',
          headers: {
            origin: ORIGIN,
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'authorization,content-type',
          },
        }),
      );
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    });
  }
});
