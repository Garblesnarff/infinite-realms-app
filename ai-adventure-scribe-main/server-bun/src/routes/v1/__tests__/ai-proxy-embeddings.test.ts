import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from '../../../../../shared/embedding-limits.js';

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'embedding-user', email: 'embedding@example.test', plan: 'free' },
    error: null,
  }),
}));

mock.module('../../../middleware/rate-limit.js', () => ({
  planRateLimit: () => new Elysia({ name: 'test-plan-rate-limit' }),
}));

mock.module('../../../services/ai-usage-service.js', () => ({
  AIUsageService: {
    checkQuotaAndConsume: async () => ({ allowed: true }),
  },
}));

const { aiProxyRoutes } = await import('../ai-proxy.js');
const app = new Elysia().use(aiProxyRoutes);

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.GOOGLE_GEMINI_API_KEY;
let upstreamBody: unknown;
let upstreamStatus = 200;
let requestUrl = '';
let requestInit: RequestInit | undefined;

beforeEach(() => {
  process.env.GOOGLE_GEMINI_API_KEY = 'test-key';
  upstreamStatus = 200;
  upstreamBody = {
    embedding: { values: new Array(EMBEDDING_DIMENSIONS).fill(0.5) },
  };
  requestUrl = '';
  requestInit = undefined;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify(upstreamBody), { status: upstreamStatus });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.GOOGLE_GEMINI_API_KEY;
  else process.env.GOOGLE_GEMINI_API_KEY = originalApiKey;
});

function embeddingRequest(): Promise<Response> {
  return app.handle(
    new Request('http://localhost/v1/ai-proxy/embeddings', {
      method: 'POST',
      headers: {
        authorization: 'Bearer embedding-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text: 'query text' }),
    }),
  );
}

describe('POST /v1/ai-proxy/embeddings', () => {
  it('uses the shared model and width, preserves query retrieval, and normalizes vectors', async () => {
    const response = await embeddingRequest();
    const body = (await response.json()) as { embedding: number[] };
    const requestBody = JSON.parse(String(requestInit?.body)) as {
      taskType: string;
      outputDimensionality: number;
    };
    const magnitude = Math.sqrt(body.embedding.reduce((sum, value) => sum + value * value, 0));

    expect(response.status).toBe(200);
    expect(requestUrl).toContain(`models/${EMBEDDING_MODEL}:embedContent`);
    expect(requestBody.taskType).toBe('RETRIEVAL_QUERY');
    expect(requestBody.outputDimensionality).toBe(EMBEDDING_DIMENSIONS);
    expect(body.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(magnitude).toBeCloseTo(1, 10);
  });

  it('rejects a wrong-width response instead of returning an empty or invalid vector', async () => {
    upstreamBody = {
      embedding: { values: new Array(EMBEDDING_DIMENSIONS - 1).fill(0.5) },
    };

    const response = await embeddingRequest();
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(body.error).toContain(`expected ${EMBEDDING_DIMENSIONS} values`);
  });

  it('rejects an unexpected upstream shape with a real error status', async () => {
    upstreamBody = {};

    const response = await embeddingRequest();
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(body.error).toContain('Invalid embedding response');
  });
});
