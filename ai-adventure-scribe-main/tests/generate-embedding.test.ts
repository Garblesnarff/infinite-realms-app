import { describe, expect, it } from 'vitest';

import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from '../shared/embedding-limits';
import { generateEmbedding } from '../supabase/functions/generate-embedding/embedding';

describe('generate-embedding edge caller', () => {
  it('uses the shared model and width, preserves document retrieval, and normalizes vectors', async () => {
    let requestUrl = '';
    let requestInit: RequestInit | undefined;
    const fetchMock = (async (input: string | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(
        JSON.stringify({ embedding: { values: new Array(EMBEDDING_DIMENSIONS).fill(0.5) } }),
        { status: 200 },
      );
    }) as typeof fetch;

    const embedding = await generateEmbedding('document text', 'test-key', fetchMock);
    const body = JSON.parse(String(requestInit?.body)) as {
      taskType: string;
      outputDimensionality: number;
    };
    const magnitude = Math.sqrt(embedding.reduce((sum, value) => sum + value * value, 0));

    expect(requestUrl).toContain(`models/${EMBEDDING_MODEL}:embedContent`);
    expect(body.taskType).toBe('RETRIEVAL_DOCUMENT');
    expect(body.outputDimensionality).toBe(EMBEDDING_DIMENSIONS);
    expect(embedding).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(magnitude).toBeCloseTo(1, 10);
  });

  it('rejects a response with the wrong width before returning it', async () => {
    const fetchMock = (async () =>
      new Response(
        JSON.stringify({ embedding: { values: new Array(EMBEDDING_DIMENSIONS - 1).fill(0.5) } }),
        { status: 200 },
      )) as typeof fetch;

    await expect(generateEmbedding('wrong width', 'test-key', fetchMock)).rejects.toThrow(
      `Embedding width mismatch: expected ${EMBEDDING_DIMENSIONS}`,
    );
  });

  it('logs the upstream status and body instead of swallowing them', async () => {
    const upstreamBody = '{"error":"retired model"}';
    const errors: unknown[][] = [];
    const fetchMock = (async () => new Response(upstreamBody, { status: 404 })) as typeof fetch;

    await expect(
      generateEmbedding('upstream failure', 'test-key', fetchMock, {
        error: (...args: unknown[]) => errors.push(args),
      }),
    ).rejects.toThrow('Gemini embedding request failed: 404');

    expect(errors).toEqual([['Gemini API error:', { status: 404, body: upstreamBody }]]);
  });
});
