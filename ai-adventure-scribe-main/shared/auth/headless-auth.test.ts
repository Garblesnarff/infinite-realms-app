import { describe, expect, it } from 'bun:test';

import { loginWithPassword } from './headless-auth';

describe('loginWithPassword', () => {
  it('uses the password exchange and validates the token pair', async () => {
    const fetchImpl = (async (url, init) => {
      expect(String(url)).toBe('https://api.example.test/v1/auth/password-login');
      expect(init?.method).toBe('POST');
      return new Response(JSON.stringify({ accessToken: 'access', refreshToken: 'refresh' }), { status: 200 });
    }) as typeof fetch;
    await expect(loginWithPassword({ baseUrl: 'https://api.example.test/', email: 'agent@example.test', password: 'secret', fetchImpl })).resolves.toEqual({ accessToken: 'access', refreshToken: 'refresh' });
  });
});
