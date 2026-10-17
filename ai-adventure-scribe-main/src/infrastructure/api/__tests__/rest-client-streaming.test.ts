/**
 * #633 PR2: tests for the opt-in SSE streaming path in `LlmApiClient.generateText`.
 *
 * The SSE wire format follows the server's contract in
 * `server-bun/src/routes/v1/llm-streaming.ts`: `delta` events carry narration
 * chunks in order, one `done` event carries the final payload (the same shape
 * as the POST /v1/llm/generate JSON response), and `error` events carry a
 * thrown AppError as `{ message, statusCode }`.
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
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
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

import {
  ApiClientError,
  llmApiClient,
  PartyDefeatedError,
  QuotaExceededError,
} from '../rest-client';

const sseResponse = (events: Array<Record<string, unknown>>) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });

const jsonResponse = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const requestBody = (): Record<string, unknown> => {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
};

const DONE_PAYLOAD = {
  text: 'The tavern door swings open.',
  provider: 'openrouter',
  model: 'x-ai/grok-4.1-fast',
  dmReplyMessageId: 'dm-1',
};

describe('generateText streaming (#633 PR2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    loadCachedSessionMock.mockReturnValue({
      access_token: 'test-token',
      refresh_token: 'refresh-token',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends stream: true and delivers deltas in order, resolving the done payload text', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        { type: 'delta', text: 'The tavern ' },
        { type: 'delta', text: 'door swings ' },
        { type: 'delta', text: 'open.' },
        { type: 'done', payload: DONE_PAYLOAD },
      ]),
    );
    const chunks: string[] = [];
    const metadata: unknown[] = [];

    const text = await llmApiClient.generateText({
      prompt: 'hello',
      onStream: (chunk) => chunks.push(chunk),
      onResponseMetadata: (meta) => metadata.push(meta),
    });

    expect(text).toBe('The tavern door swings open.');
    expect(chunks).toEqual(['The tavern ', 'door swings ', 'open.']);
    expect(requestBody().stream).toBe(true);
    expect(metadata).toEqual([
      { provider: 'openrouter', model: 'x-ai/grok-4.1-fast', dmReplyMessageId: 'dm-1' },
    ]);
  });

  it('calls onStreamReset when the server discards a streamed attempt, before the next deltas', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        { type: 'delta', text: 'rejected prose ' },
        { type: 'reset' },
        { type: 'delta', text: 'The tavern door swings open.' },
        { type: 'done', payload: DONE_PAYLOAD },
      ]),
    );
    const events: string[] = [];

    await llmApiClient.generateText({
      prompt: 'hello',
      onStream: (chunk) => events.push(`delta:${chunk}`),
      onStreamReset: () => events.push('reset'),
    });

    expect(events).toEqual([
      'delta:rejected prose ',
      'reset',
      'delta:The tavern door swings open.',
    ]);
  });

  it('omits the stream flag when the caller does not opt in', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ text: 'hi' }));
    const text = await llmApiClient.generateText({ prompt: 'hello' });
    expect(text).toBe('hi');
    expect(requestBody().stream).toBeUndefined();
  });

  it('falls back to the JSON path when the server answers non-SSE', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ text: 'plain reply' }));
    const chunks: string[] = [];
    const text = await llmApiClient.generateText({
      prompt: 'hello',
      onStream: (chunk) => chunks.push(chunk),
    });
    expect(text).toBe('plain reply');
    expect(chunks).toEqual([]);
    // The opt-in flag is still sent; the server decides the transport.
    expect(requestBody().stream).toBe(true);
  });

  it('maps error events to ApiClientError with the event status', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([{ type: 'error', message: 'turn already running', statusCode: 409 }]),
    );
    await expect(
      llmApiClient.generateText({ prompt: 'hello', onStream: () => {} }),
    ).rejects.toMatchObject({ name: 'ApiClientError', status: 409 });
  });

  it('throws PartyDefeatedError on a party_defeated terminal payload', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        { type: 'done', payload: { terminalState: 'party_defeated', encounterId: 'enc-9' } },
      ]),
    );
    const chunks: string[] = [];
    await expect(
      llmApiClient.generateText({ prompt: 'hello', onStream: (c) => chunks.push(c) }),
    ).rejects.toBeInstanceOf(PartyDefeatedError);
    expect(chunks).toEqual([]);
  });

  it('throws QuotaExceededError on an error payload that carries resetAt', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        { type: 'done', payload: { error: 'quota exhausted', resetAt: '2026-10-15T00:00:00Z' } },
      ]),
    );
    await expect(
      llmApiClient.generateText({ prompt: 'hello', onStream: () => {} }),
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('throws when the stream ends without a done payload', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([{ type: 'delta', text: 'partial' }]));
    const chunks: string[] = [];
    await expect(
      llmApiClient.generateText({ prompt: 'hello', onStream: (c) => chunks.push(c) }),
    ).rejects.toBeInstanceOf(ApiClientError);
    // Deltas already delivered stay delivered; the failure surfaces, not a guess.
    expect(chunks).toEqual(['partial']);
  });

  it('ignores malformed events and keeps consuming the stream', async () => {
    const raw =
      'data: not-json\n\n' +
      'data: {"type":"delta","text":"a"}\n\n' +
      ': keepalive\n\n' +
      'data: {"type":"delta","text":"b"}\n\n' +
      `data: ${JSON.stringify({ type: 'done', payload: DONE_PAYLOAD })}\n\n`;
    fetchMock.mockResolvedValueOnce(
      new Response(raw, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    );
    const chunks: string[] = [];
    const text = await llmApiClient.generateText({
      prompt: 'hello',
      onStream: (chunk) => chunks.push(chunk),
    });
    expect(chunks).toEqual(['a', 'b']);
    expect(text).toBe('The tavern door swings open.');
  });
});
