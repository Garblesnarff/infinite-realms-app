import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
  loadCachedSession: vi.fn(() => ({ access_token: 'test-token', refresh_token: 'test-refresh' })),
  persistSession: vi.fn(),
  refreshAccessTokenOnce: vi.fn(),
}));

import { llmApiClient, PartyDefeatedError } from '../rest-client';

import { markAuthReady } from '@/lib/auth-gate';

const jsonResponse = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// #2456: the client must detect the server's handled terminal state and raise
// it as a PartyDefeatedError — not return it as DM text, and not wrap it in
// the generic "AI service unavailable" error.

describe('LlmApiClient.generateText party_defeated terminal state (#2456)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    markAuthReady();
  });

  it('throws PartyDefeatedError when the server returns terminalState party_defeated', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        terminalState: 'party_defeated',
        encounterId: 'encounter-defeated-1',
        text: '',
      }),
    );

    const request = llmApiClient.generateText({ prompt: 'I lie still in the dark.' });
    await expect(request).rejects.toBeInstanceOf(PartyDefeatedError);
    await expect(request).rejects.toMatchObject({ encounterId: 'encounter-defeated-1' });
  });

  it('returns ordinary text when there is no terminal state', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { text: 'The darkness stirs.', provider: 'openrouter' }),
    );

    await expect(
      llmApiClient.generateText({ prompt: 'I lie still in the dark.' }),
    ).resolves.toBe('The darkness stirs.');
  });
});
