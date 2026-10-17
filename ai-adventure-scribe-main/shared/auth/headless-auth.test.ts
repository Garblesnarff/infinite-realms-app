import { describe, expect, it } from 'bun:test';

import { isProductionApiHost, loginWithPassword, loginWithTestAuth } from './headless-auth';

describe('loginWithPassword', () => {
  it('uses the password exchange and validates the token pair', async () => {
    const fetchImpl = (async (url, init) => {
      expect(String(url)).toBe('https://api.example.test/v1/auth/password-login');
      expect(init?.method).toBe('POST');
      return new Response(JSON.stringify({ accessToken: 'access', refreshToken: 'refresh' }), {
        status: 200,
      });
    }) as typeof fetch;
    await expect(
      loginWithPassword({
        baseUrl: 'https://api.example.test/',
        email: 'agent@example.test',
        password: 'secret',
        fetchImpl,
      }),
    ).resolves.toEqual({ accessToken: 'access', refreshToken: 'refresh' });
  });
});

describe('isProductionApiHost', () => {
  it('is false for localhost and production lookalike hosts', () => {
    expect(isProductionApiHost('http://localhost:8888')).toBe(false);
    expect(isProductionApiHost('https://api.infiniterealms.app.evil.test')).toBe(false);
    expect(isProductionApiHost('https://infiniterealms.app.evil.test')).toBe(false);
  });

  it('is true for the production host and its subdomains', () => {
    expect(isProductionApiHost('https://infiniterealms.app')).toBe(true);
    expect(isProductionApiHost('https://api.infiniterealms.app')).toBe(true);
    expect(isProductionApiHost('https://api.infiniterealms.app./')).toBe(true);
    expect(isProductionApiHost('https://INFINITEREALMS.APP/')).toBe(true);
  });
});

describe('loginWithTestAuth', () => {
  it('refuses the production API host without calling fetch', async () => {
    for (const baseUrl of [
      'https://api.infiniterealms.app',
      'https://infiniterealms.app',
      'https://api.infiniterealms.app./',
      'https://INFINITEREALMS.APP/',
    ]) {
      const calls: string[] = [];
      const fetchImpl = (async (url) => {
        calls.push(String(url));
        return new Response(null, { status: 500 });
      }) as typeof fetch;
      await expect(
        loginWithTestAuth({ baseUrl, secret: 'super-secret-value', fetchImpl }),
      ).rejects.toThrow(
        `--test-auth refuses to run against the production API host (${new URL(baseUrl).hostname})`,
      );
      expect(calls).toEqual([]);
    }
  });

  it('redirects off test-login and exchanges the code for a token pair', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url) === 'http://localhost:8888/v1/auth/test-login') {
        expect(init?.method).toBe('GET');
        expect((init?.headers as Record<string, string>)['x-test-auth-secret']).toBe(
          'super-secret-value',
        );
        expect(init?.redirect).toBe('manual');
        return new Response(null, {
          status: 302,
          headers: { location: 'http://localhost:8888/auth/callback?code=exchange-code-1' },
        });
      }
      expect(String(url)).toBe('http://localhost:8888/v1/auth/exchange');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ code: 'exchange-code-1' });
      return new Response(JSON.stringify({ accessToken: 'access', refreshToken: 'refresh' }), {
        status: 200,
      });
    }) as typeof fetch;
    await expect(
      loginWithTestAuth({
        baseUrl: 'http://localhost:8888',
        secret: 'super-secret-value',
        fetchImpl,
      }),
    ).resolves.toEqual({ accessToken: 'access', refreshToken: 'refresh' });
    expect(calls.map((call) => call.url)).toEqual([
      'http://localhost:8888/v1/auth/test-login',
      'http://localhost:8888/v1/auth/exchange',
    ]);
  });

  it('fails when the test-login redirect carries no code', async () => {
    const fetchImpl = (async (url) => {
      expect(String(url)).toBe('http://localhost:8888/v1/auth/test-login');
      return new Response(null, {
        status: 302,
        headers: { location: 'http://localhost:8888/auth/callback' },
      });
    }) as typeof fetch;
    await expect(
      loginWithTestAuth({
        baseUrl: 'http://localhost:8888',
        secret: 'super-secret-value',
        fetchImpl,
      }),
    ).rejects.toThrow('Test login failed (302)');
  });

  it('never puts the secret into a failed test-login error', async () => {
    const secret = 'super-secret-value';
    const fetchImpl = (async (url) => {
      expect(String(url)).toBe('http://localhost:8888/v1/auth/test-login');
      return new Response(JSON.stringify({ error: 'no' }), { status: 401 });
    }) as typeof fetch;
    const error = await loginWithTestAuth({
      baseUrl: 'http://localhost:8888',
      secret,
      fetchImpl,
    }).catch((caught) => caught);
    const message = error instanceof Error ? error.message : String(error);
    expect(message).toBe('Test login failed (401)');
    expect(message).not.toContain(secret);
  });

  it('never puts the secret into a failed exchange error', async () => {
    const secret = 'super-secret-value';
    const fetchImpl = (async (url) =>
      String(url).endsWith('/v1/auth/exchange')
        ? new Response(JSON.stringify({ error: 'no' }), { status: 500 })
        : new Response(null, {
            status: 302,
            headers: { location: 'http://localhost:8888/auth/callback?code=exchange-code-1' },
          })) as typeof fetch;
    const error = await loginWithTestAuth({
      baseUrl: 'http://localhost:8888',
      secret,
      fetchImpl,
    }).catch((caught) => caught);
    const message = error instanceof Error ? error.message : String(error);
    expect(message).toBe('Test auth token exchange failed (500)');
    expect(message).not.toContain(secret);
  });
});
