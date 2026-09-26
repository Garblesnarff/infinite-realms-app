/**
 * Successful image generations write OpenRouter token usage (#2160).
 * Failures do not.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

import { resetCircuitBreakersForTests } from '../../../utils/circuit-breaker.js';

const envKeys = ['DATABASE_URL', 'OPENROUTER_API_KEY', 'OPENROUTER_IMAGE_MODEL', 'NODE_ENV'];
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

Object.assign(process.env, {
  DATABASE_URL: 'postgres://test:test@localhost:5432/test',
  NODE_ENV: 'test',
  OPENROUTER_API_KEY: 'test-image-key',
  OPENROUTER_IMAGE_MODEL: 'google/gemini-3.1-flash-image',
});

const recorded: Array<{
  type: string;
  provider: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  userId: string;
  plan: string;
  sessionId?: string;
}> = [];

mock.module('../../../lib/db.js', () => ({ sql: async () => [] }));
mock.module('../../../lib/logger.js', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    if (request.headers.get('authorization') !== 'Bearer image-user') {
      return { user: null, error: 'Unauthorized' };
    }
    return {
      user: { userId: 'image-user', email: 'image-user@example.test', plan: 'pro' },
      error: null,
    };
  },
}));
mock.module('../../../services/ai-usage-service.js', () => ({
  AIUsageService: {
    checkQuotaAndConsume: async () => ({
      allowed: true,
      remaining: 10,
      resetAt: new Date(Date.now() + 3_600_000).toISOString(),
    }),
    getQuotaStatus: async () => ({ plan: 'pro', usage: 0, remaining: 10 }),
    recordProviderUsage: async (opts: (typeof recorded)[number]) => {
      recorded.push(opts);
    },
  },
}));

const { imageRoutes } = await import('../images.js');

const app = new Elysia().use(imageRoutes);

let providerStatus = 200;
let providerBody: unknown = {};

beforeEach(() => {
  recorded.length = 0;
  providerStatus = 200;
  resetCircuitBreakersForTests();
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(providerBody), {
      status: providerStatus,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
});

function generateRequest(sessionId?: string): Request {
  return new Request('http://localhost/v1/images/generate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer image-user',
    },
    body: JSON.stringify({
      prompt: 'A lantern in the woods',
      ...(sessionId ? { sessionId } : {}),
    }),
  });
}

describe('POST /v1/images/generate usage', () => {
  it('records prompt and completion tokens after a successful image', async () => {
    providerBody = {
      choices: [
        {
          message: {
            images: [{ image_url: { url: 'data:image/png;base64,aGVsbG8=' } }],
          },
        },
      ],
      usage: { prompt_tokens: 11, completion_tokens: 1290 },
    };

    const response = await app.handle(generateRequest());
    const body = (await response.json()) as { image?: string };

    expect(response.status).toBe(200);
    expect(body.image).toBe('aGVsbG8=');
    expect(recorded).toEqual([
      expect.objectContaining({
        userId: 'image-user',
        plan: 'pro',
        type: 'image',
        provider: 'openrouter',
        model: 'google/gemini-3.1-flash-image',
        inputTokens: 11,
        outputTokens: 1290,
      }),
    ]);
    expect(recorded[0]?.sessionId).toBeUndefined();
  });

  it('writes session_id when the request includes a session', async () => {
    providerBody = {
      choices: [
        {
          message: {
            images: [{ image_url: { url: 'data:image/png;base64,aGVsbG8=' } }],
          },
        },
      ],
      usage: { prompt_tokens: 4, completion_tokens: 8 },
    };

    const response = await app.handle(generateRequest('session-2242'));

    expect(response.status).toBe(200);
    expect(recorded[0]?.sessionId).toBe('session-2242');
  });

  it('does not record usage when the provider returns no image', async () => {
    providerStatus = 502;
    providerBody = { error: 'nope' };

    const response = await app.handle(generateRequest());

    expect(response.status).toBe(502);
    expect(recorded).toEqual([]);
  });
});

afterAll(() => {
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
