/**
 * Exact requests the client sends for chronicle sharing (#1430), shared
 * so the client test asserts it sends these and the server test posts
 * them through the real route.
 */
export const CHRONICLE_SHARE_REQUEST = {
  method: 'POST',
  path: (id: string) => `/v1/chronicles/${id}/share`,
};

export const CHRONICLE_UNSHARE_REQUEST = {
  method: 'DELETE',
  path: (id: string) => `/v1/chronicles/${id}/share`,
};

export const PUBLIC_CHRONICLE_PATH = (token: string): string => `/v1/public/chronicles/${token}`;
