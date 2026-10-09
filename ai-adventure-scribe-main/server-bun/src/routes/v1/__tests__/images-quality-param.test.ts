/**
 * The image `quality` parameter was never read by the server (#2676 step 4). Clients built before
 * its removal still send it, so the generate route must keep answering 200 when it is present.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { resetCircuitBreakersForTests } from '../../../utils/circuit-breaker.js';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://localhost:5432/test',
  NODE_ENV: 'test',
  OPENROUTER_API_KEY: 'test-image-key',
  OPENROUTER_IMAGE_MODEL: 'google/gemini-3.1-flash-image',
});

const testLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => testLogger,
};
mock.module('../../../lib/db.js', () => ({ sql: async () => [] }));
mock.module('../../../lib/logger.js', () => ({
  logger: testLogger,
  combatLogger: testLogger,
  spellLogger: testLogger,
  progressionLogger: testLogger,
  errorLogSerializers: {},
  default: testLogger,
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
    assertUsageStoreAvailable: async () => {},
    getQuotaStatus: async () => ({ plan: 'pro', usage: 0, remaining: 10 }),
    recordProviderUsage: async () => {},
  },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { imageRoutes } = await import('../images.js');

const app = createRequestPipelineApp().use(imageRoutes);

const providerImage = {
  choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,aGVsbG8=' } }] } }],
  usage: { prompt_tokens: 4, completion_tokens: 8 },
};

let providerCalls: Array<{ url: string; body: unknown }> = [];

beforeEach(() => {
  providerCalls = [];
  resetCircuitBreakersForTests();
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    providerCalls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? 'null')),
    });
    return new Response(JSON.stringify(providerImage), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
});

function generateRequest(extra: Record<string, unknown>): Request {
  return new Request('http://localhost/v1/images/generate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer image-user',
    },
    body: JSON.stringify({ prompt: 'A lantern in the woods', ...extra }),
  });
}

describe('POST /v1/images/generate with a retired quality field (#2676 step 4)', () => {
  it('still returns 200 and the image when an old client sends quality', async () => {
    const response = await app.handle(generateRequest({ quality: 'low' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ image: 'aGVsbG8=' });
    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0]?.body).not.toHaveProperty('quality');
  });
});
