import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
} from '../../../../shared/embedding-limits.js';
import {
  EmbeddingError,
  generateEmbedding,
  generateEmbeddingDetailed,
} from '../embedding-service.js';

/**
 * Contract test against the real embedding-service (#22): a provider 429 surfaces as an
 * EmbeddingError carrying the raw provider status and the parsed RetryInfo delay, while the
 * synchronous recall path still fails fast with a single attempt. fetch is stubbed through
 * a typed signature — no `any` casts, no eslint suppressions, and no assertion of the stub to `typeof fetch`.
 */

/** The JSON body the real producer (generateEmbeddingDetailed) sends. */
interface EmbedContentRequest {
  content: { parts: Array<{ text: string }> };
  taskType: string;
  outputDimensionality: number;
}

const isEmbedContentRequest = (value: unknown): value is EmbedContentRequest => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const content = record.content as { parts?: unknown } | null | undefined;
  return (
    typeof record.taskType === 'string' &&
    typeof record.outputDimensionality === 'number' &&
    typeof content === 'object' &&
    content !== null &&
    Array.isArray(content.parts)
  );
};

type FetchResponder = (url: string, init: RequestInit | undefined) => Response;

let responder: FetchResponder = () => new Response('{}', { status: 200 });

/**
 * Typed fetch stub. Accepts exactly the input union the real fetch accepts
 * (`string | URL | Request`), and carries Bun's `fetch.preconnect` member, so
 * the assignment below needs no assertion at all.
 */
const fetchStub: typeof fetch = Object.assign(
  async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return responder(url, init);
  },
  { preconnect: (_url: string | URL): void => {} },
);

const realFetch = globalThis.fetch;
const realKey = process.env.GOOGLE_GEMINI_API_KEY;

beforeEach(() => {
  process.env.GOOGLE_GEMINI_API_KEY = 'test-gemini-key';
  responder = () => new Response('{}', { status: 200 });
  globalThis.fetch = fetchStub;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.GOOGLE_GEMINI_API_KEY;
  else process.env.GOOGLE_GEMINI_API_KEY = realKey;
});

const jsonResponse = (status: number, payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * Run a call that must throw, and narrow the thrown value to EmbeddingError honestly:
 * the instanceof check is the narrowing, not a cast.
 */
const catchEmbeddingError = async (run: () => Promise<unknown>): Promise<EmbeddingError> => {
  try {
    await run();
  } catch (err) {
    expect(err).toBeInstanceOf(EmbeddingError);
    if (err instanceof EmbeddingError) return err;
    throw new Error('unreachable: instanceof EmbeddingError passed but did not narrow');
  }
  throw new Error('expected the embedding call to throw');
};

describe('embedding-service Provider 429 mapping & recall contract (#22)', () => {
  test('maps provider 429 to EmbeddingError with status 502, providerStatus 429, and parses retryDelay', async () => {
    responder = () =>
      jsonResponse(429, {
        error: {
          code: 429,
          message: 'Resource has been exhausted',
          status: 'RESOURCE_EXHAUSTED',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.RetryInfo',
              retryDelay: '16.644s',
            },
          ],
        },
      });

    const err = await catchEmbeddingError(() =>
      generateEmbeddingDetailed('test text', 'RETRIEVAL_DOCUMENT'),
    );
    expect(err.status).toBe(502);
    expect(err.providerStatus).toBe(429);
    expect(err.retryDelayMs).toBe(16_644);
  });

  test('verifies model, dimensions, task type and normalization are unchanged', async () => {
    const seen: Array<{ url: string; body: EmbedContentRequest }> = [];
    responder = (url, init) => {
      const rawBody = init?.body;
      if (typeof rawBody !== 'string') throw new Error('expected a JSON string request body');
      const parsed: unknown = JSON.parse(rawBody);
      if (!isEmbedContentRequest(parsed)) throw new Error('unexpected embedContent request shape');
      seen.push({ url, body: parsed });
      // Non-unit vector [3, 4] -> magnitude 5 -> normalized [0.6, 0.8]
      const values = [3, 4, ...new Array(766).fill(0)];
      return jsonResponse(200, {
        embedding: { values },
        usageMetadata: { promptTokenCount: 5 },
      });
    };

    const res = await generateEmbeddingDetailed('hello world', 'RETRIEVAL_QUERY');

    expect(seen).toHaveLength(1);
    const request = seen[0];
    if (!request) throw new Error('expected exactly one fetch call');
    expect(request.url).toContain(EMBEDDING_MODEL);
    expect(request.body.taskType).toBe('RETRIEVAL_QUERY');
    expect(request.body.outputDimensionality).toBe(EMBEDDING_DIMENSIONS);
    expect(res.values.length).toBe(EMBEDDING_DIMENSIONS);

    // Verify L2 normalization
    const norm = Math.sqrt(res.values.reduce((sum, v) => sum + v * v, 0));
    expect(Math.abs(norm - 1.0)).toBeLessThan(1e-5);
    expect(res.values[0]).toBeCloseTo(0.6);
    expect(res.values[1]).toBeCloseTo(0.8);
    expect(res.inputTokens).toBe(5);
  });

  test('verifies generateEmbedding passes signal down and throws on provider 429 without retrying', async () => {
    let fetchCalls = 0;
    let sawSignal: AbortSignal | null | undefined;
    responder = (_url, init) => {
      fetchCalls++;
      sawSignal = init?.signal;
      return jsonResponse(429, { error: { code: 429, message: 'Resource exhausted' } });
    };

    const controller = new AbortController();
    const err = await catchEmbeddingError(() =>
      generateEmbedding('test recall query', 'RETRIEVAL_QUERY', controller.signal),
    );

    expect(err.status).toBe(502);
    expect(err.providerStatus).toBe(429);
    // Synchronous call path (like recall) must fail on the 1st attempt with 0 retries
    expect(fetchCalls).toBe(1);
    expect(sawSignal).toBe(controller.signal);
  });
});