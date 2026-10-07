import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from '../../../../shared/embedding-limits.js';
import {
  EmbeddingError,
  generateEmbedding,
  generateEmbeddingDetailed,
} from '../embedding-service.js';

// Ported from the deleted POST /v1/ai-proxy/embeddings contract test (#2664
// step 1): the route was a thin wrapper over this service, so these cases now
// call generateEmbeddingDetailed directly. This is the only unmocked test of
// the service; memory-embedding-write-path.test.ts mocks it.

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.GOOGLE_GEMINI_API_KEY;
let upstreamBody: unknown;
let requestUrl = '';
let requestInit: RequestInit | undefined;

beforeEach(() => {
  process.env.GOOGLE_GEMINI_API_KEY = 'test-key';
  upstreamBody = {
    embedding: { values: new Array(EMBEDDING_DIMENSIONS).fill(0.5) },
  };
  requestUrl = '';
  requestInit = undefined;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify(upstreamBody), { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.GOOGLE_GEMINI_API_KEY;
  else process.env.GOOGLE_GEMINI_API_KEY = originalApiKey;
});

describe('generateEmbeddingDetailed', () => {
  it('uses the shared model and width, preserves query retrieval, and normalizes vectors', async () => {
    const result = await generateEmbeddingDetailed('query text', 'RETRIEVAL_QUERY');
    const requestBody = JSON.parse(String(requestInit?.body)) as {
      taskType: string;
      outputDimensionality: number;
    };
    const magnitude = Math.sqrt(result.values.reduce((sum, value) => sum + value * value, 0));

    expect(requestUrl).toContain(`models/${EMBEDDING_MODEL}:embedContent`);
    expect(requestBody.taskType).toBe('RETRIEVAL_QUERY');
    expect(requestBody.outputDimensionality).toBe(EMBEDDING_DIMENSIONS);
    expect(result.values).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(magnitude).toBeCloseTo(1, 10);
    expect(result.inputTokens).toBeGreaterThan(0);
  });

  it('rejects a wrong-width response instead of returning an invalid vector', async () => {
    upstreamBody = {
      embedding: { values: new Array(EMBEDDING_DIMENSIONS - 1).fill(0.5) },
    };

    const error = await generateEmbeddingDetailed('query text', 'RETRIEVAL_QUERY').catch((e) => e);
    expect(error).toBeInstanceOf(EmbeddingError);
    expect((error as EmbeddingError).message).toContain(`expected ${EMBEDDING_DIMENSIONS} values`);
  });

  it('rejects an unexpected upstream shape with a real error', async () => {
    upstreamBody = {};

    const error = await generateEmbeddingDetailed('query text', 'RETRIEVAL_QUERY').catch((e) => e);
    expect(error).toBeInstanceOf(EmbeddingError);
    expect((error as EmbeddingError).message).toContain('Invalid embedding response');
  });

  it('throws 503 when no API key is configured', async () => {
    delete process.env.GOOGLE_GEMINI_API_KEY;

    const error = await generateEmbeddingDetailed('query text', 'RETRIEVAL_QUERY').catch((e) => e);
    expect(error).toBeInstanceOf(EmbeddingError);
    expect((error as EmbeddingError).status).toBe(503);
  });
});

describe('generateEmbedding', () => {
  it('returns the normalized values directly', async () => {
    const values = await generateEmbedding('query text', 'RETRIEVAL_DOCUMENT');
    expect(values).toHaveLength(EMBEDDING_DIMENSIONS);
  });
});
