/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

/**
 * The write half of #1822: every memory row must get a vector, the player's turn must not
 * wait for it, and a failure must be loud rather than silent. Prod had 4530 memory rows and
 * 0 embeddings for nine months because nothing here was ever told a write produced no vector.
 *
 * Extended for #22: bounded 429 retries on background memory embedding attachment off the
 * critical path, preserving public HTTP statuses and recall behavior.
 *
 * Named `*.test.ts` rather than `*.vitest.ts` deliberately: server-bun runs `bun test`, whose
 * discovery does not match `*.vitest.ts`, and the root Vitest config globs `src/**` only. A
 * `*.vitest.ts` file next to this one is executed by nothing.
 */

type AlertCall = { kind: string; detail: { sessionId?: string; error?: string } };

const VECTOR = new Array(768).fill(0).map((_, index) => (index === 0 ? 1 : 0));

let generate: (text: string, taskType: string, signal?: AbortSignal) => Promise<number[]>;
let writeEmbedding: (values: Record<string, unknown>) => void;
let insertedRows: Array<Record<string, unknown>> = [];
const generateCalls: Array<{ text: string; taskType: string; signal?: AbortSignal }> = [];
const embeddingWrites: Array<Record<string, unknown>> = [];
const alerts: AlertCall[] = [];

class TestEmbeddingError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly providerStatus?: number,
    readonly retryDelayMs?: number | null,
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

mock.module('../../../../db/client', () => ({
  db: {
    insert: () => ({
      values: () => ({ returning: async () => insertedRows }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => writeEmbedding(values),
      }),
    }),
  },
}));

mock.module('../session-service.js', () => ({
  SessionService: { getSessionById: async () => ({ id: 'session-1' }) },
}));

mock.module('../campaign-service.js', () => ({
  CampaignService: { getById: async () => ({ id: 'campaign-1' }) },
}));

mock.module('../embedding-service.js', () => ({
  EmbeddingError: TestEmbeddingError,
  generateEmbedding: (text: string, taskType: string, signal?: AbortSignal) => {
    generateCalls.push({ text, taskType, signal });
    return generate(text, taskType, signal);
  },
  generateEmbeddingDetailed: async (text: string, taskType: string, signal?: AbortSignal) => {
    generateCalls.push({ text, taskType, signal });
    const values = await generate(text, taskType, signal);
    return { values, inputTokens: 1 };
  },
}));

mock.module('../../lib/alerting.js', () => ({
  alert: (kind: string, detail: AlertCall['detail'] = {}) => {
    alerts.push({ kind, detail });
  },
}));

const {
  MemoryService,
  attachEmbedding,
  ATTACH_EMBEDDING_MAX_ATTEMPTS,
  DEFAULT_ATTACH_RETRY_DELAY_MS,
  MAX_ATTACH_RETRY_DELAY_MS,
} = await import('../memory-service.js');

/** Drain the microtask queue so a fire-and-forget continuation gets to run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  generate = async () => VECTOR;
  writeEmbedding = (values) => {
    embeddingWrites.push(values);
  };
  generateCalls.length = 0;
  embeddingWrites.length = 0;
  alerts.length = 0;
  insertedRows = [
    { id: 'mem-1', sessionId: 'session-1', content: 'Balthazar warned the party about the well.' },
  ];
});

describe('MemoryService.insert embedding write path', () => {
  test('returns as soon as the row is written, then attaches the vector', async () => {
    let release!: (values: number[]) => void;
    generate = () => new Promise<number[]>((resolve) => (release = resolve));

    const rows = await MemoryService.insert(
      [{ sessionId: 'session-1', content: 'Balthazar warned the party about the well.' }] as any,
      'user-1',
    );

    // The caller has its rows back while the embedding call is still in flight: nothing about
    // the turn is blocked on Google.
    expect(rows).toHaveLength(1);
    expect(embeddingWrites).toHaveLength(0);
    expect(generateCalls).toEqual([
      {
        text: 'Balthazar warned the party about the well.',
        taskType: 'RETRIEVAL_DOCUMENT',
        signal: undefined,
      },
    ]);

    release(VECTOR);
    await settle();

    expect(embeddingWrites).toEqual([{ embedding: VECTOR }]);
    expect(alerts).toHaveLength(0);
  });

  test('embeds every row of a batch, one at a time', async () => {
    insertedRows = [
      { id: 'mem-1', sessionId: 'session-1', content: 'first' },
      { id: 'mem-2', sessionId: 'session-1', content: 'second' },
    ];

    await MemoryService.insert(
      [
        { sessionId: 'session-1', content: 'first' },
        { sessionId: 'session-1', content: 'second' },
      ] as any,
      'user-1',
    );
    await settle();

    expect(generateCalls.map((call) => call.text)).toEqual(['first', 'second']);
    expect(embeddingWrites).toHaveLength(2);
  });

  test('a failing embedding never fails the insert', async () => {
    generate = async () => {
      throw new TestEmbeddingError('embedContent 503', 503, 503);
    };

    const rows = await MemoryService.insert(
      [{ sessionId: 'session-1', content: 'Balthazar warned the party about the well.' }] as any,
      'user-1',
    );
    await settle();

    expect(rows).toHaveLength(1);
    expect(embeddingWrites).toHaveLength(0);
    expect(alerts.map((entry) => entry.kind)).toEqual(['memory_embedding_failed']);
  });
});

describe('attachEmbedding bounded 429 retries (#22)', () => {
  test('alerts with the memory and session instead of throwing on immediate failure', async () => {
    generate = async () => {
      throw new TestEmbeddingError('embedContent 503', 503, 503);
    };

    await expect(attachEmbedding('mem-9', 'some memory', 'session-1')).resolves.toBeUndefined();

    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.kind).toBe('memory_embedding_failed');
    expect(alerts[0]!.detail.sessionId).toBe('session-1');
    expect(alerts[0]!.detail.error).toContain('mem-9');
    expect(alerts[0]!.detail.error).toContain('embedContent 503');
    expect(embeddingWrites).toHaveLength(0);
  });

  test('alerts when the row update itself fails, and still does not throw', async () => {
    writeEmbedding = () => {
      throw new Error('connection terminated');
    };

    await expect(attachEmbedding('mem-9', 'some memory', 'session-1')).resolves.toBeUndefined();

    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.kind).toBe('memory_embedding_failed');
    expect(alerts[0]!.detail.error).toContain('connection terminated');
  });

  test('succeeds after a 429 retry without alerting and updates DB once', async () => {
    let callCount = 0;
    const sleptMs: number[] = [];
    generate = async () => {
      callCount++;
      if (callCount === 1) {
        throw new TestEmbeddingError('Embedding request failed', 502, 429, 1500);
      }
      return VECTOR;
    };

    await attachEmbedding('mem-1', 'content text', 'session-1', {
      sleep: async (ms) => {
        sleptMs.push(ms);
      },
    });

    expect(callCount).toBe(2);
    expect(sleptMs).toEqual([1500]);
    expect(embeddingWrites).toEqual([{ embedding: VECTOR }]);
    expect(alerts).toHaveLength(0);
  });

  test('alerts once and leaves row null after max attempts (3) are exhausted on 429', async () => {
    let callCount = 0;
    const sleptMs: number[] = [];
    generate = async () => {
      callCount++;
      throw new TestEmbeddingError('Embedding request failed', 502, 429, 1200);
    };

    await attachEmbedding('mem-1', 'content text', 'session-1', {
      sleep: async (ms) => {
        sleptMs.push(ms);
      },
    });

    expect(callCount).toBe(ATTACH_EMBEDDING_MAX_ATTEMPTS);
    expect(sleptMs).toEqual([1200, 1200]);
    expect(embeddingWrites).toHaveLength(0);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.kind).toBe('memory_embedding_failed');
    expect(alerts[0]!.detail.sessionId).toBe('session-1');
  });

  test('uses DEFAULT_ATTACH_RETRY_DELAY_MS fallback when 429 has no parsed delay, capped at MAX_ATTACH_RETRY_DELAY_MS', async () => {
    let callCount = 0;
    const sleptMs: number[] = [];
    generate = async () => {
      callCount++;
      if (callCount === 1) {
        // No parsed delay -> fallback to DEFAULT_ATTACH_RETRY_DELAY_MS
        throw new TestEmbeddingError('Embedding request failed', 502, 429, null);
      }
      if (callCount === 2) {
        // Parsed delay exceeds cap (15_000 > MAX_ATTACH_RETRY_DELAY_MS)
        throw new TestEmbeddingError('Embedding request failed', 502, 429, 15_000);
      }
      return VECTOR;
    };

    await attachEmbedding('mem-1', 'content text', 'session-1', {
      sleep: async (ms) => {
        sleptMs.push(ms);
      },
    });

    expect(callCount).toBe(3);
    expect(sleptMs).toEqual([DEFAULT_ATTACH_RETRY_DELAY_MS, MAX_ATTACH_RETRY_DELAY_MS]);
    expect(embeddingWrites).toEqual([{ embedding: VECTOR }]);
    expect(alerts).toHaveLength(0);
  });

  test('non-429 errors fail on attempt 1 without retry or sleep', async () => {
    let callCount = 0;
    const sleptMs: number[] = [];
    generate = async () => {
      callCount++;
      throw new TestEmbeddingError('Server error', 503, 500);
    };

    await attachEmbedding('mem-1', 'content text', 'session-1', {
      sleep: async (ms) => {
        sleptMs.push(ms);
      },
    });

    expect(callCount).toBe(1);
    expect(sleptMs).toHaveLength(0);
    expect(embeddingWrites).toHaveLength(0);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.detail.error).toContain('Server error');
  });

  test('abort signal terminates retries immediately', async () => {
    const controller = new AbortController();
    controller.abort();
    const sleptMs: number[] = [];

    await attachEmbedding('mem-1', 'content text', 'session-1', {
      signal: controller.signal,
      sleep: async (ms) => {
        sleptMs.push(ms);
      },
    });

    expect(generateCalls).toHaveLength(0);
    expect(sleptMs).toHaveLength(0);
    expect(embeddingWrites).toHaveLength(0);
    expect(alerts).toHaveLength(0);
  });

  test('abort landing during the 429 retry delay prevents the next attempt', async () => {
    const controller = new AbortController();
    let callCount = 0;
    const sleptMs: number[] = [];
    generate = async () => {
      callCount++;
      throw new TestEmbeddingError('Embedding request failed', 502, 429, 5000);
    };

    await attachEmbedding('mem-1', 'content text', 'session-1', {
      signal: controller.signal,
      sleep: async (ms) => {
        sleptMs.push(ms);
        controller.abort();
      },
    });

    // One 429 seen, the retry delay started, then the abort landed: no second
    // embedding call, and an abort is a shutdown — not a failure worth alerting.
    expect(callCount).toBe(1);
    expect(sleptMs).toEqual([5000]);
    expect(embeddingWrites).toHaveLength(0);
    expect(alerts).toHaveLength(0);
  });

  // The retry budget must never become unbounded: non-finite, non-positive, and
  // extreme maxAttempts inputs resolve to at most ATTACH_EMBEDDING_MAX_ATTEMPTS.
  const clampCases: Array<{ label: string; maxAttempts: number; expectedAttempts: number }> = [
    { label: 'Infinity', maxAttempts: Infinity, expectedAttempts: 3 },
    { label: '-Infinity', maxAttempts: -Infinity, expectedAttempts: 3 },
    { label: 'NaN', maxAttempts: NaN, expectedAttempts: 3 },
    { label: 'zero', maxAttempts: 0, expectedAttempts: 3 },
    { label: 'negative', maxAttempts: -5, expectedAttempts: 3 },
    { label: 'extreme', maxAttempts: 1_000_000, expectedAttempts: 3 },
    { label: 'max-safe-integer', maxAttempts: Number.MAX_SAFE_INTEGER, expectedAttempts: 3 },
    { label: 'fractional', maxAttempts: 2.7, expectedAttempts: 2 },
    { label: 'two', maxAttempts: 2, expectedAttempts: 2 },
    { label: 'one', maxAttempts: 1, expectedAttempts: 1 },
  ];

  for (const { label, maxAttempts, expectedAttempts } of clampCases) {
    test(`clamps maxAttempts=${label} to ${expectedAttempts} total attempt(s)`, async () => {
      let callCount = 0;
      const sleptMs: number[] = [];
      generate = async () => {
        callCount++;
        throw new TestEmbeddingError('Embedding request failed', 502, 429, 10);
      };

      await attachEmbedding('mem-1', 'content text', 'session-1', {
        maxAttempts,
        sleep: async (ms) => {
          sleptMs.push(ms);
        },
      });

      expect(callCount).toBe(expectedAttempts);
      expect(sleptMs).toHaveLength(Math.max(0, expectedAttempts - 1));
      expect(embeddingWrites).toHaveLength(0);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.kind).toBe('memory_embedding_failed');
    });
  }
});
