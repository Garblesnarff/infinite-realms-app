import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MAX_INPUT_CHARS,
  EMBEDDING_MODEL,
  normalizeEmbedding,
} from '../../../shared/embedding-limits';

/**
 * Embedding generation using Google's gemini-embedding-001, pinned to 768 dimensions to match
 * the `vector(768)` column and its ivfflat cosine index.
 *
 * Vectors from different models are not comparable, so a campaign whose rows were embedded with
 * the retired text-embedding-004 must be re-embedded wholesale rather than topped up. See #1816.
 */

let googleApiKey: string | null = null;

/**
 * Initialize the Google AI client
 */
export function initGemini(apiKey: string): void {
  googleApiKey = apiKey;
}

// Legacy alias for backwards compatibility
export const initOpenAI = initGemini;

/**
 * Generate embeddings for a batch of texts.
 * Uses Gemini gemini-embedding-001 at EMBEDDING_DIMENSIONS, unit-normalized.
 */
export async function generateEmbeddings(
  texts: string[],
  batchSize: number = 100,
): Promise<number[][]> {
  if (!googleApiKey) {
    throw new Error('Google AI client not initialized. Call initGemini first.');
  }

  const embeddings: number[][] = [];

  // Process in batches to avoid rate limits
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    // Apply the same conservative ceiling as browser and edge callers.
    const truncatedBatch = batch.map((text) =>
      text.length > EMBEDDING_MAX_INPUT_CHARS ? text.substring(0, EMBEDDING_MAX_INPUT_CHARS) : text,
    );

    try {
      // Gemini's batchEmbedContents endpoint
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents?key=${googleApiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requests: truncatedBatch.map((text) => ({
              model: `models/${EMBEDDING_MODEL}`,
              content: {
                parts: [{ text }],
              },
              taskType: 'RETRIEVAL_DOCUMENT',
              // Must be explicit: the model defaults to 3072, the column is vector(768).
              outputDimensionality: EMBEDDING_DIMENSIONS,
            })),
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini batch embedding failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      for (const item of data.embeddings) {
        const values: number[] = item.values;
        // Fail loudly rather than letting a wrong width reach a vector(768) insert, where it
        // would surface as an opaque database error partway through a write.
        if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(
            `Embedding width mismatch: expected ${EMBEDDING_DIMENSIONS}, got ${
              Array.isArray(values) ? values.length : typeof values
            }`,
          );
        }
        embeddings.push(normalizeEmbedding(values));
      }

      // Add a small delay between batches to avoid rate limits
      if (i + batchSize < texts.length) {
        await sleep(100);
      }
    } catch (error) {
      console.error(`Error generating embeddings for batch ${i}:`, error);
      throw error;
    }
  }

  return embeddings;
}

/**
 * Generate embedding for a single text
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const [embedding] = await generateEmbeddings([text], 1);
  return embedding;
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Estimate token count (rough approximation)
 */
export function estimateTokens(text: string): number {
  // Rough estimate: ~4 characters per token
  return Math.ceil(text.length / 4);
}

/**
 * Calculate estimated cost for embedding generation
 * Note: Gemini embeddings are currently free!
 */
export function estimateCost(texts: string[]): { tokens: number; cost: number } {
  const totalTokens = texts.reduce((sum, text) => sum + estimateTokens(text), 0);
  // Gemini embeddings are currently free.
  const cost = 0;

  return { tokens: totalTokens, cost };
}
