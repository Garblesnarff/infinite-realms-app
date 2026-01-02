/**
 * Embedding generation using OpenAI's text-embedding-3-small
 */

import OpenAI from 'openai';

let openaiClient: OpenAI | null = null;

/**
 * Initialize the OpenAI client
 */
export function initOpenAI(apiKey: string): void {
  openaiClient = new OpenAI({ apiKey });
}

/**
 * Generate embeddings for a batch of texts
 * Uses text-embedding-3-small (1536 dimensions)
 */
export async function generateEmbeddings(
  texts: string[],
  batchSize: number = 100
): Promise<number[][]> {
  if (!openaiClient) {
    throw new Error('OpenAI client not initialized. Call initOpenAI first.');
  }

  const embeddings: number[][] = [];

  // Process in batches to avoid rate limits
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    // Truncate texts to max 8000 tokens (~32000 chars) for safety
    const truncatedBatch = batch.map(text =>
      text.length > 32000 ? text.substring(0, 32000) : text
    );

    try {
      const response = await openaiClient.embeddings.create({
        model: 'text-embedding-3-small',
        input: truncatedBatch,
      });

      for (const item of response.data) {
        embeddings.push(item.embedding);
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
 */
export function estimateCost(texts: string[]): { tokens: number; cost: number } {
  const totalTokens = texts.reduce((sum, text) => sum + estimateTokens(text), 0);
  // text-embedding-3-small: $0.00002 per 1K tokens
  const cost = (totalTokens / 1000) * 0.00002;

  return { tokens: totalTokens, cost };
}
