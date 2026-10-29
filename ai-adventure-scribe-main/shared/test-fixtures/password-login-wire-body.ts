/**
 * The wire contract for POST /v1/auth/password-login (#1256/#1257), as both
 * the client (TesterLoginPage) and the real route see it. Shared so the
 * client test can assert it sends exactly this body and the server test can
 * post exactly it: the server side is the real-route test in
 * server-bun/src/routes/v1/__tests__/auth-password-login-allowlist.test.ts
 * (#1257), which posts this request shape through
 * createRequestPipelineApp().use(<routes>) and expects this 200 shape; the
 * request shape is also what loginWithPassword in shared/auth/headless-auth.ts
 * posts. The values are placeholders, not real credentials.
 */
export const PASSWORD_LOGIN_REQUEST_BODY = {
  email: 'tester@example.com',
  password: 'tester-password',
} as const;

export const PASSWORD_LOGIN_200_BODY = {
  accessToken: 'test-access-token',
  refreshToken: 'test-refresh-token',
} as const;
