import assert from 'node:assert/strict';

import { afterEach, test } from 'bun:test';

import { generateEmbeddings, initGemini } from './embeddings.js';
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  normalizeEmbedding,
} from '../../../shared/embedding-limits.js';

import { GEMINI_KEY_NAMES, resolveGeminiApiKey } from './index.js';

/**
 * The retired text-embedding-004 left rows with null embeddings for months before anyone
 * noticed, so these lock down the two things that silently went wrong: which model is called,
 * and how wide the vector is. See #1816.
 */

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function mockBatchResponse(values: number[][]) {
  return async (url: string | URL | Request, init?: RequestInit) => {
    mockBatchResponse.lastUrl = String(url);
    mockBatchResponse.lastBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ embeddings: values.map((v) => ({ values: v })) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}
mockBatchResponse.lastUrl = '';
mockBatchResponse.lastBody = undefined as unknown;

test('requests gemini-embedding-001 with the dimensionality pinned', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockBatchResponse([new Array(EMBEDDING_DIMENSIONS).fill(0.5)]) as never;
  initGemini('test-key');

  try {
    await generateEmbeddings(['a location description']);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(
    mockBatchResponse.lastUrl.includes(`models/${EMBEDDING_MODEL}:batchEmbedContents`),
    `expected the ${EMBEDDING_MODEL} endpoint, got ${mockBatchResponse.lastUrl}`,
  );
  const body = mockBatchResponse.lastBody as { requests: Array<Record<string, unknown>> };
  assert.equal(body.requests[0].model, `models/${EMBEDDING_MODEL}`);
  // Without this the model returns 3072 and the vector(768) insert fails.
  assert.equal(body.requests[0].outputDimensionality, EMBEDDING_DIMENSIONS);
});

test('rejects a vector whose width would not fit the column', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockBatchResponse([new Array(3072).fill(0.5)]) as never;
  initGemini('test-key');

  try {
    await assert.rejects(() => generateEmbeddings(['too wide']), /Embedding width mismatch/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('normalizes returned vectors to unit length', async () => {
  const originalFetch = globalThis.fetch;
  // Google only normalizes the full-width output; truncated widths arrive unnormalized.
  globalThis.fetch = mockBatchResponse([new Array(EMBEDDING_DIMENSIONS).fill(0.25)]) as never;
  initGemini('test-key');

  let result: number[][];
  try {
    result = await generateEmbeddings(['unnormalized']);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const magnitude = Math.sqrt(result[0].reduce((sum, value) => sum + value * value, 0));
  assert.ok(Math.abs(magnitude - 1) < 1e-9, `expected unit norm, got ${magnitude}`);
});

test('normalizeEmbedding leaves a zero vector alone rather than dividing by zero', () => {
  assert.deepEqual(normalizeEmbedding([0, 0, 0]), [0, 0, 0]);
});

test('resolves the credential from the name server-bun/.env actually uses', () => {
  for (const name of GEMINI_KEY_NAMES) delete process.env[name];
  delete process.env.VITE_GEMINI_API_KEYS;

  process.env.GOOGLE_GEMINI_API_KEY = 'from-server-bun';
  assert.equal(resolveGeminiApiKey(), 'from-server-bun');
});

test('prefers GOOGLE_AI_API_KEY when several names are set', () => {
  process.env.GOOGLE_AI_API_KEY = 'preferred';
  process.env.GOOGLE_GEMINI_API_KEY = 'fallback';
  assert.equal(resolveGeminiApiKey(), 'preferred');
});

test('returns undefined when no credential is present', () => {
  for (const name of GEMINI_KEY_NAMES) delete process.env[name];
  delete process.env.VITE_GEMINI_API_KEYS;
  assert.equal(resolveGeminiApiKey(), undefined);
});
