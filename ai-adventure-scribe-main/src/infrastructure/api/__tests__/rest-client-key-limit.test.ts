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
  TokenRefreshTransportError: class TokenRefreshTransportError extends Error {
    constructor(message = 'Token refresh endpoint unreachable') {
      super(message);
      this.name = 'TokenRefreshTransportError';
    }
  },
}));

import { DmProviderKeyLimitError, llmApiClient } from '../rest-client';

import { markAuthReady } from '@/lib/auth-gate';

const jsonResponse = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// #350: the server answers a key-limit degraded turn with HTTP 200 and the
// stable reason `llm_provider_key_limit` (routes/v1/llm.ts). The client must
// raise it as DmProviderKeyLimitError so the turn shows the outage message and
// the Retry control, instead of saving the server text as a DM reply.
const keyLimitEnvelope = {
  parsed: false,
  degraded: true,
  reason: 'llm_provider_key_limit',
  text: 'The Dungeon Master is unavailable right now. Your turn was not lost; try again in a few minutes.',
};

describe('LlmApiClient.generateText key-limit degraded turn (#350)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    markAuthReady();
  });

  it('throws DmProviderKeyLimitError for the key-limit reason', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, keyLimitEnvelope));

    const request = llmApiClient.generateText({ prompt: 'I look around the hall.' });
    await expect(request).rejects.toBeInstanceOf(DmProviderKeyLimitError);
  });

  it('still returns the ordinary degraded text for other degraded reasons', async () => {
    // Only the key-limit code changes behavior. The generic degraded envelope
    // keeps its existing path (returned as text) — pinned here so it stays so.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        parsed: false,
        degraded: true,
        reason: 'llm_generate_unavailable',
        text: 'The Dungeon Master pauses. The storyteller service did not answer; try your action again.',
      }),
    );

    await expect(llmApiClient.generateText({ prompt: 'I look around the hall.' })).resolves.toBe(
      'The Dungeon Master pauses. The storyteller service did not answer; try your action again.',
    );
  });
});
