export const authLoginUrl = (apiUrl: string, returnTo: string): string =>
  `${apiUrl}/v1/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
