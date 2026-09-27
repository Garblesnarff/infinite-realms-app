import type { MemoryCandidate } from './fixtures';

/**
 * Cosine similarity, matching `match_memories`: `1 - (embedding <=> query)`.
 * `<=>` is pgvector cosine distance. Higher similarity is the raw order.
 * No 0.7 floor — that floor drops rows; this ranks every candidate.
 * Vectors in prod are gemini-embedding-001, 768 dims, already normalized.
 */
export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) {
    throw new Error(`embedding length ${left.length} does not match query length ${right.length}`);
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

/**
 * Highest cosine first. Original order breaks ties.
 * Null when the query or any candidate has no stored embedding — do not invent one.
 */
export function rankBySimilarity(
  queryEmbedding: number[] | null,
  candidates: MemoryCandidate[],
): string[] | null {
  if (!queryEmbedding || queryEmbedding.length === 0) {
    return null;
  }
  const width = queryEmbedding.length;
  for (const candidate of candidates) {
    if (!candidate.embedding || candidate.embedding.length !== width) {
      return null;
    }
  }
  return candidates
    .map((candidate, index) => ({
      id: candidate.id,
      index,
      score: cosineSimilarity(candidate.embedding ?? [], queryEmbedding),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.id);
}
