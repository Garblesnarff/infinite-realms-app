import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { fetchWithAuth } from '@/infrastructure/api/rest-client';

vi.mock('@/infrastructure/api/rest-client', () => ({
  fetchWithAuth: vi.fn(),
}));

describe('ws ticket client URL builder', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('never puts access_token or token= on the WebSocket URL', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', 'https://api.infiniterealms.app');
    const { appendWsTicket, buildSessionStoryWsUrl, websocketUrlContainsAuthToken } =
      await import('../ws-ticket-client');

    const built = buildSessionStoryWsUrl('ticket-value', 'session-1');
    expect(built).toContain('ticket=ticket-value');
    expect(built).toContain('sessionId=session-1');
    expect(built.startsWith('wss://') || built.startsWith('ws://')).toBe(true);
    expect(websocketUrlContainsAuthToken(built)).toBe(false);
    expect(built).not.toMatch(/access_token/i);
    expect(built).not.toMatch(/[?&]token=/i);

    const stripped = appendWsTicket(
      'ws://localhost:8888/ws?token=leaked-access-token&access_token=also-leaked',
      'ticket-value',
    );
    expect(stripped).toBe('ws://localhost:8888/ws?ticket=ticket-value');
    expect(stripped).not.toContain('leaked-access-token');
    expect(stripped).not.toMatch(/access_token/i);
    expect(stripped).not.toMatch(/[?&]token=/i);
  });

  it('mints a ticket over the authenticated POST, not a query string', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: true,
      json: async () => ({ ticket: 'minted-ticket', expiresInMs: 30_000 }),
    } as Response);

    const { mintWsTicket } = await import('../ws-ticket-client');
    const ticket = await mintWsTicket({ sessionId: 'sess-1' });
    expect(ticket).toBe('minted-ticket');
    expect(fetchWithAuth).toHaveBeenCalledWith(
      '/v1/ws/ticket',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ sessionId: 'sess-1' }),
      }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
