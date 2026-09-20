import { fetchWithAuth } from '@/infrastructure/api/rest-client';

function apiBaseUrl(): string {
  return import.meta.env.VITE_API_URL || 'http://localhost:8888';
}

const AUTH_QUERY_PARAM = /(?:^|[?&])(?:access_token|token)=/i;

export function websocketUrlContainsAuthToken(url: string): boolean {
  return AUTH_QUERY_PARAM.test(url);
}

/**
 * Attach a one-time ticket to a WebSocket URL. Any leftover `token` /
 * `access_token` query params are stripped so a revived caller cannot put a
 * bearer in the URL.
 */
export function appendWsTicket(wsUrl: string, ticket: string, sessionId?: string): string {
  const url = new URL(wsUrl);
  url.searchParams.delete('token');
  url.searchParams.delete('access_token');
  url.searchParams.set('ticket', ticket);
  if (sessionId) url.searchParams.set('sessionId', sessionId);
  const result = url.toString();
  if (websocketUrlContainsAuthToken(result)) {
    throw new Error('WebSocket URL must not include an auth token query parameter');
  }
  return result;
}

export function buildSessionStoryWsUrl(ticket: string, sessionId?: string): string {
  const base = new URL(apiBaseUrl());
  const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  return appendWsTicket(`${protocol}//${base.host}/ws`, ticket, sessionId);
}

export async function mintWsTicket(options: { sessionId: string }): Promise<string> {
  const response = await fetchWithAuth('/v1/ws/ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: options.sessionId }),
  });

  if (!response.ok) {
    throw new Error('Failed to mint websocket ticket');
  }

  const payload = (await response.json()) as { ticket?: unknown };
  if (typeof payload.ticket !== 'string' || !payload.ticket) {
    throw new Error('Invalid websocket ticket');
  }
  return payload.ticket;
}
