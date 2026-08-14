/** Conservative input ceiling shared by browser, ingestion, and edge embedding callers. */
export const EMBEDDING_MAX_INPUT_CHARS = 8_000;

/**
 * The embedding model every caller must use. `text-embedding-004` was retired by Google and
 * now 404s on `embedContent`/`batchEmbedContents`, which silently left rows with null
 * embeddings. See #1816.
 */
export const EMBEDDING_MODEL = 'gemini-embedding-001';

/**
 * Pinned output width. `gemini-embedding-001` defaults to 3072 dimensions, but the
 * `campaign_chunks.embedding` column is `vector(768)` with an ivfflat cosine index, so the
 * dimensionality MUST be requested explicitly — the default would fail to insert.
 */
export const EMBEDDING_DIMENSIONS = 768;

/**
 * Scale a vector to unit length.
 *
 * Google only normalizes the full 3072-dimension output; truncated widths come back
 * unnormalized (observed L2 ≈ 0.59 at 768). Existing stored vectors are unit-norm, so
 * normalizing keeps one convention across the corpus and keeps dot-product and L2 callers
 * agreeing with cosine.
 */
export function normalizeEmbedding(values: number[]): number[] {
  let sumOfSquares = 0;
  for (const value of values) sumOfSquares += value * value;

  const magnitude = Math.sqrt(sumOfSquares);
  if (!magnitude || !Number.isFinite(magnitude)) return values;

  return values.map((value) => value / magnitude);
}
