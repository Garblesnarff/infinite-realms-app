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
