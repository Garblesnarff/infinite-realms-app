import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  normalizeEmbedding,
} from '../../../shared/embedding-limits.ts';

type GeminiEmbeddingResponse = {
  embedding?: {
    values?: number[];
  };
};

type EmbeddingLogger = Pick<Console, 'error'>;

/**
 * Request one document embedding from Gemini at the width used by the vector column.
 * Kept separate from the Deno serve bootstrap so the request contract can be unit-tested.
 */
export async function generateEmbedding(
  text: string,
  googleApiKey: string,
  fetchImpl: typeof fetch = fetch,
  logger: EmbeddingLogger = console,
): Promise<number[]> {
  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${googleApiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: {
          parts: [{ text }],
        },
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: EMBEDDING_DIMENSIONS,
      }),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error('Gemini API error:', {
      status: response.status,
      body: errorBody,
    });
    throw new Error(`Gemini embedding request failed: ${response.status}`);
  }

  const data = (await response.json()) as GeminiEmbeddingResponse;
  const values = data.embedding?.values;

  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding width mismatch: expected ${EMBEDDING_DIMENSIONS}, got ${
        Array.isArray(values) ? values.length : typeof values
      }`,
    );
  }

  return normalizeEmbedding(values);
}
