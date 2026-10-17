/**
 * P0 #783 task A: replay the exact SSE wire sequence the server sends for a
 * roll-request DM turn that needed retries/failover (Haiku ajv-reject → retry
 * → Gemini failover): `reset` → `delta` → `reset` → `delta` → `done` whose
 * payload carries a reply with `roll_requests`.
 *
 * Asserts `generateText` still resolves the complete `done` payload text
 * (which `processDMResponse` parses for `roll_requests`), the reset callback
 * fires once per attempt, and the reply metadata survives.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, loadCachedSessionMock, persistSessionMock, refreshMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  loadCachedSessionMock: vi.fn(),
  persistSessionMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/auth-gate', () => ({
  waitForAuth: vi.fn(() => Promise.resolve()),
  markAuthReady: vi.fn(),
  resetAuthGate: vi.fn(),
  isAuthVerified: vi.fn(() => true),
}));

vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer <redacted>' })),
  loadCachedSession: loadCachedSessionMock,
  persistSession: persistSessionMock,
  refreshAccessTokenOnce: refreshMock,
  TokenRefreshTransportError: class TokenRefreshTransportError extends Error {
    constructor(message = 'Token refresh endpoint unreachable') {
      super(message);
      this.name = 'TokenRefreshTransportError';
    }
  },
}));

import { llmApiClient } from '../rest-client';

const sseResponse = (events: Array<Record<string, unknown>>): Response =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });

// The `done` payload shape the route sends: the same object as the JSON
// response, with `text` carrying the re-serialized DM envelope.
const donePayloadWithRollRequests = (): Record<string, unknown> => ({
  parsed: true,
  text: JSON.stringify({
    text: 'Dust coats every surface. Something glints under the desk.',
    roll_requests: [
      {
        type: 'check',
        formula: '1d20',
        purpose: 'Investigation check to search the room',
        dc: 15,
      },
    ],
    combat_transition: 'none',
    options: [],
  }),
  provider: 'openrouter',
  model: 'google/gemini-3.1-flash-lite',
  dmReplyPersisted: false,
  dmReplyMessageId: 'dm-1',
});

describe('generateText streaming with reset events on a roll-request turn (#783)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    loadCachedSessionMock.mockReturnValue({
      access_token: 'test-access',
      refresh_token: 'test-refresh',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([0, 1, 2])(
    'resolves the done payload with roll_requests intact after %i reset events',
    async (resets: number) => {
      const events: Array<Record<string, unknown>> = [];
      for (let i = 0; i < resets; i += 1) {
        events.push({ type: 'reset' });
        events.push({ type: 'delta', text: 'discarded prose ' });
      }
      events.push({ type: 'delta', text: 'Dust coats every surface. ' });
      events.push({ type: 'done', payload: donePayloadWithRollRequests() });
      fetchMock.mockResolvedValueOnce(sseResponse(events));

      const chunks: string[] = [];
      let resetCount = 0;
      const metadata: unknown[] = [];

      const text = await llmApiClient.generateText({
        prompt: 'I search the room',
        onStream: (chunk) => chunks.push(chunk),
        onStreamReset: () => {
          resetCount += 1;
        },
        onResponseMetadata: (meta) => metadata.push(meta),
      });

      expect(resetCount).toBe(resets);
      // The transport forwards every delta in order; the client's reset
      // handler (not the transport) clears the preview between attempts.
      expect(chunks).toEqual([
        ...Array<string>(resets).fill('discarded prose '),
        'Dust coats every surface. ',
      ]);
      // The full envelope text survives: the parser downstream still sees the
      // roll requests.
      const envelope = JSON.parse(text) as {
        roll_requests?: Array<{ purpose: string }>;
      };
      expect(envelope.roll_requests).toHaveLength(1);
      expect(envelope.roll_requests?.[0].purpose).toBe(
        'Investigation check to search the room',
      );
      expect(metadata).toEqual([
        {
          provider: 'openrouter',
          model: 'google/gemini-3.1-flash-lite',
          dmReplyMessageId: 'dm-1',
        },
      ]);
    },
  );
});
