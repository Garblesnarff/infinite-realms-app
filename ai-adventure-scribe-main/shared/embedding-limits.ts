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
 * Provenance stamped into `campaign_chunks.metadata` alongside every embedding we write.
 *
 * Vectors from different models (or different truncation widths) are not comparable, so a
 * model change means the corpus must be re-embedded wholesale rather than topped up. Without a
 * stamp there is no way to tell from the database which rows carry which model — after the
 * #1815 migration the only available evidence was "every vector changed", which is a diff
 * against a hand-made backup table rather than something queryable. See #1816.
 *
 * Only set this on a row whose embedding is being written in the same statement: a row that
 * keeps its existing vector (e.g. `reingest --skip-embeddings`) must keep its existing stamp.
 */
export function embeddingProvenance(): {
  embeddingModel: string;
  embeddingDimensions: number;
} {
  return { embeddingModel: EMBEDDING_MODEL, embeddingDimensions: EMBEDDING_DIMENSIONS };
}

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

/**
 * Free-tier ceiling for embedding calls, in ITEMS per minute — not HTTP requests.
 *
 * Google counts each item of a `batchEmbedContents` call separately, against the quota metric
 * `generativelanguage.googleapis.com/embed_content_free_tier_requests`
 * (`EmbedContentRequestsPerMinutePerUserPerProjectPerModel-FreeTier`). A single 100-item batch
 * therefore spends a whole minute's allowance in one request, and the next request 429s.
 *
 * Any caller that embeds more than this many items in a minute must pace itself. Raising the
 * project to a paid tier lifts the ceiling; update this constant if that happens.
 */
export const EMBEDDING_FREE_TIER_ITEMS_PER_MIN = 100;
