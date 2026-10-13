/**
 * The one place the server turns text into a vector.
 *
 * This is the generation body that used to live inline in `POST /v1/ai-proxy/embeddings`,
 * lifted out unchanged so the memory write path can embed without an HTTP round trip through
 * its own API (#1822). The route is now a thin wrapper over this function and its behavior,
 * including every status code it returns, is identical.
 *
 * Model and width are not parameters. Vectors from different models — or from the same model
 * truncated to a different width — are not comparable, and `memories.embedding` has to stay
 * comparable with `campaign_chunks.embedding` for memories and lore to ever be ranked
 * together. Both constants live in shared/embedding-limits.ts precisely so no caller can pick
 * its own; #1816 is what a caller picking its own model looks like in production.
 */
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MAX_INPUT_CHARS,
  EMBEDDING_MODEL,
  normalizeEmbedding,
} from '../../../shared/embedding-limits.js';

/**
 * Gemini distinguishes the text being stored from the text being asked about, and returns
 * different vectors for each. Documents written to `memories` are RETRIEVAL_DOCUMENT; a
 * player's question searched against them is RETRIEVAL_QUERY.
 */
export type EmbeddingTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

const EMBEDDING_TIMEOUT_MS = 60_000;

/**
 * Every failure the HTTP route used to answer inline, with the status it answered with, so
 * the route stays a translation layer rather than a second implementation of the contract.
 */
export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

/**
 * Embed `text` at the corpus standard: gemini-embedding-001, 768 dimensions, unit-normalized.
 *
 * Throws `EmbeddingError` rather than returning null. A null embedding that nobody notices is
 * the exact failure mode of #1822 — 4530 rows written, 0 ever embedded — so callers are made
 * to decide what to do about a failure instead of inheriting one silently.
 */
export type EmbeddingResult = {
  values: number[];
  /** Prompt tokens reported by Gemini, or a character estimate when the body omits them. */
  inputTokens: number;
};

/**
 * Same model and width as `generateEmbedding`. Also returns the token count so
 * a recall can write `ai_usage`. `signal` lets the caller abort inside the
 * recall budget; insert keeps the 60s ceiling.
 */
export async function generateEmbeddingDetailed(
  text: string,
  taskType: EmbeddingTaskType,
  signal?: AbortSignal,
): Promise<EmbeddingResult> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new EmbeddingError('Embedding service unavailable', 503);
  }

  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: signal ?? AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
        body: JSON.stringify({
          content: { parts: [{ text: text.slice(0, EMBEDDING_MAX_INPUT_CHARS) }] },
          taskType,
          outputDimensionality: EMBEDDING_DIMENSIONS,
        }),
      },
    );
  } catch (error) {
    throw new EmbeddingError(
      error instanceof Error ? error.message : 'Embedding request failed',
      503,
    );
  }

  if (!response.ok) {
    throw new EmbeddingError('Embedding request failed', response.status >= 500 ? 503 : 502);
  }

  const data = (await response.json()) as {
    embedding?: { values?: number[] };
    usageMetadata?: { promptTokenCount?: number };
  };
  const values = data.embedding?.values;
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
    throw new EmbeddingError(
      `Invalid embedding response: expected ${EMBEDDING_DIMENSIONS} values`,
      502,
    );
  }

  const reported = data.usageMetadata?.promptTokenCount;
  const inputTokens =
    typeof reported === 'number' && reported > 0
      ? reported
      : Math.max(1, Math.ceil(text.length / 4));
  return { values: normalizeEmbedding(values), inputTokens };
}

export async function generateEmbedding(
  text: string,
  taskType: EmbeddingTaskType,
): Promise<number[]> {
  const result = await generateEmbeddingDetailed(text, taskType);
  return result.values;
}
