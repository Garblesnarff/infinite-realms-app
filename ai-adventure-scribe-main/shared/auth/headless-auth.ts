export interface HeadlessAuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface PasswordLoginOptions {
  baseUrl: string;
  email: string;
  password: string;
  fetchImpl?: typeof fetch;
}

export interface TestAuthOptions {
  baseUrl: string;
  secret: string;
  fetchImpl?: typeof fetch;
}

/** True only for infiniterealms.app and its subdomains (e.g. api.infiniterealms.app). */
export function isProductionApiHost(baseUrl: string): boolean {
  const { hostname } = new URL(baseUrl);
  return hostname === 'infiniterealms.app' || hostname.endsWith('.infiniterealms.app');
}

/**
 * Test-auth credential exchange for non-browser automation. Refuses to run
 * against the production API host before issuing any request, and never puts
 * the secret in an error message.
 */
export async function loginWithTestAuth({
  baseUrl,
  secret,
  fetchImpl = fetch,
}: TestAuthOptions): Promise<HeadlessAuthTokens> {
  const base = baseUrl.replace(/\/$/, '');
  if (isProductionApiHost(base)) {
    throw new Error(
      `--test-auth refuses to run against the production API host (${new URL(base).hostname})`,
    );
  }
  const loginResponse = await fetchImpl(`${base}/v1/auth/test-login`, {
    method: 'GET',
    headers: { 'x-test-auth-secret': secret },
    redirect: 'manual',
  });
  const location = loginResponse.headers.get('location');
  const code = location ? new URL(location, base).searchParams.get('code') : null;
  if (loginResponse.status < 300 || loginResponse.status >= 400 || !code) {
    throw new Error(`Test login failed (${loginResponse.status})`);
  }
  const exchangeResponse = await fetchImpl(`${base}/v1/auth/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const payload = (await exchangeResponse
    .json()
    .catch(() => null)) as Partial<HeadlessAuthTokens> | null;
  if (!exchangeResponse.ok || !payload?.accessToken || !payload.refreshToken) {
    throw new Error(`Test auth token exchange failed (${exchangeResponse.status})`);
  }
  return { accessToken: payload.accessToken, refreshToken: payload.refreshToken };
}

/** Shared credential exchange for non-browser automation. */
export async function loginWithPassword({
  baseUrl,
  email,
  password,
  fetchImpl = fetch,
}: PasswordLoginOptions): Promise<HeadlessAuthTokens> {
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/v1/auth/password-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const payload = (await response.json().catch(() => null)) as Partial<HeadlessAuthTokens> | null;
  if (!response.ok || !payload?.accessToken || !payload.refreshToken) {
    throw new Error(`Password login failed (${response.status})`);
  }
  return { accessToken: payload.accessToken, refreshToken: payload.refreshToken };
}
