import { EMBEDDING_MAX_INPUT_CHARS } from '../../../shared/embedding-limits';

/**
 * Embedding generation using Google's text-embedding-004
 * Produces 768-dimensional vectors (vs OpenAI's 1536)
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
 * Generate embeddings for a batch of texts
 * Uses Gemini text-embedding-004 (768 dimensions)
 */
export async function generateEmbeddings(
  texts: string[],
  batchSize: number = 100
): Promise<number[][]> {
  if (!googleApiKey) {
    throw new Error('Google AI client not initialized. Call initGemini first.');
  }

  const embeddings: number[][] = [];

  // Process in batches to avoid rate limits
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    // Apply the same conservative ceiling as browser and edge callers.
    const truncatedBatch = batch.map(text =>
      text.length > EMBEDDING_MAX_INPUT_CHARS
        ? text.substring(0, EMBEDDING_MAX_INPUT_CHARS)
        : text
    );

    try {
      // Gemini's batchEmbedContents endpoint
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=${googleApiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requests: truncatedBatch.map(text => ({
              model: 'models/text-embedding-004',
              content: {
                parts: [{ text }],
              },
              taskType: 'RETRIEVAL_DOCUMENT',
            })),
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini batch embedding failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      for (const item of data.embeddings) {
        embeddings.push(item.values);
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
  return new Promise(resolve => setTimeout(resolve, ms));
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
  // Gemini text-embedding-004 is currently free (as of 2024)
  const cost = 0;

  return { tokens: totalTokens, cost };
}
