import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_FREE_TIER_ITEMS_PER_MIN,
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
 * Google counts EACH ITEM of a batchEmbedContents call against the per-minute embed quota
 * (see EMBEDDING_FREE_TIER_ITEMS_PER_MIN), not the HTTP call. A 100-item batch therefore
 * spends the entire minute's allowance in one request, and the next batch 429s. We pace by
 * items-per-minute and honour the server's RetryInfo on 429.
 */
const EMBED_BATCH_SIZE = 50;
const RATE_WINDOW_MS = 60_000;
// Leave headroom so a concurrent caller sharing this key does not push us over.
const SAFETY_FACTOR = 0.9;
const MAX_429_RETRIES = 6;
/** Used when a 429 body carries no parsable retry hint. */
export const DEFAULT_RETRY_DELAY_MS = 30_000;

export interface ItemRateLimiter {
  /** Block until `count` more items fit inside the trailing window. */
  acquire(count: number): Promise<void>;
  /** Record `count` items as actually consumed. */
  record(count: number): void;
  /** Items currently inside the trailing window (evicts stale entries first). */
  size(): number;
}

/**
 * Sliding-window limiter over ITEMS, not requests.
 *
 * `acquire` and `record` are deliberately separate: a request that is rejected with 429 never
 * reaches Google's counters, so reserving budget for it would inflate the local window and
 * cause self-inflicted waits. Callers must record only what was actually served.
 *
 * The clock and sleep are injectable so the pacing logic is testable without real time.
 */
export function createItemRateLimiter(options: {
  limit: number;
  windowMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onWait?: (ms: number) => void;
}): ItemRateLimiter {
  const { limit } = options;
  const windowMs = options.windowMs ?? RATE_WINDOW_MS;
  const now = options.now ?? (() => Date.now());
  const sleepFn = options.sleep ?? sleep;
  const onWait = options.onWait;

  /** Timestamps (ms) of items consumed, trimmed to the trailing rate window. */
  const consumed: number[] = [];

  const evict = (): void => {
    const cutoff = now() - windowMs;
    while (consumed.length > 0 && consumed[0] <= cutoff) consumed.shift();
  };

  return {
    async acquire(count: number): Promise<void> {
      for (;;) {
        evict();
        if (consumed.length + count <= limit) return;
        // Wait until the oldest item ages out of the window.
        const waitMs = consumed[0] + windowMs - now() + 250;
        onWait?.(waitMs);
        await sleepFn(Math.max(waitMs, 1000));
      }
    },
    record(count: number): void {
      const stamp = now();
      for (let i = 0; i < count; i++) consumed.push(stamp);
    },
    size(): number {
      evict();
      return consumed.length;
    },
  };
}

const defaultLimiter = createItemRateLimiter({
  limit: Math.floor(EMBEDDING_FREE_TIER_ITEMS_PER_MIN * SAFETY_FACTOR),
  onWait: (ms) => console.warn(`  ...rate limit: waiting ${Math.ceil(ms / 1000)}s`),
});

/**
 * Pull a retry delay out of a 429 body.
 *
 * Google returns the machine-readable `RetryInfo` field, which is what we key on. The prose
 * "Please retry in 16.6s." in the same payload is a human-facing restatement of the same value
 * and is matched as a fallback, so a response carrying only the prose still paces correctly.
 */
export function parseRetryDelayMs(body: string): number | null {
  const structured = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  if (structured) return Math.ceil(parseFloat(structured[1]) * 1000);
  const prose = /retry in\s+(\d+(?:\.\d+)?)\s*s/i.exec(body);
  if (prose) return Math.ceil(parseFloat(prose[1]) * 1000);
  return null;
}

export interface PostBatchDeps {
  limiter?: ItemRateLimiter;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  onRetry?: (ms: number) => void;
}

/**
 * POST a batch, retrying on 429 using the server-supplied delay.
 *
 * Budget is recorded ONCE per call — on the attempt that is actually served — because a 429ed
 * request consumes none of Google's quota.
 */
export async function postBatchWithRetry(
  url: string,
  body: string,
  itemCount: number,
  deps: PostBatchDeps = {},
): Promise<Response> {
  const limiter = deps.limiter ?? defaultLimiter;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleepFn = deps.sleep ?? sleep;
  const maxRetries = deps.maxRetries ?? MAX_429_RETRIES;
  const onRetry =
    deps.onRetry ??
    ((ms: number) => console.warn(`  ...429 received, retrying in ${Math.ceil(ms / 1000)}s`));

  for (let attempt = 0; ; attempt++) {
    await limiter.acquire(itemCount);

    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (response.status !== 429) {
      // Only a served request consumed quota, so this is the only place budget is recorded.
      limiter.record(itemCount);
      return response;
    }

    const errorText = await response.text();
    if (attempt >= maxRetries) {
      throw new Error(`Gemini batch embedding failed: 429 after ${attempt} retries - ${errorText}`);
    }
    const delay = parseRetryDelayMs(errorText) ?? DEFAULT_RETRY_DELAY_MS;
    onRetry(delay);
    await sleepFn(delay + 1000);
  }
}

/**
 * Generate embeddings for a batch of texts.
 * Uses Gemini gemini-embedding-001 at EMBEDDING_DIMENSIONS, unit-normalized.
 */
export async function generateEmbeddings(
  texts: string[],
  batchSize: number = EMBED_BATCH_SIZE,
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
      const response = await postBatchWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents?key=${googleApiKey}`,
        JSON.stringify({
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
        truncatedBatch.length,
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

      // Inter-batch pacing is handled by throttleForItems() before each request.
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
