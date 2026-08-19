/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

/**
 * The write half of #1822: every memory row must get a vector, the player's turn must not
 * wait for it, and a failure must be loud rather than silent. Prod had 4530 memory rows and
 * 0 embeddings for nine months because nothing here was ever told a write produced no vector.
 *
 * Named `*.test.ts` rather than `*.vitest.ts` deliberately: server-bun runs `bun test`, whose
 * discovery does not match `*.vitest.ts`, and the root Vitest config globs `src/**` only. A
 * `*.vitest.ts` file next to this one is executed by nothing.
 */

type AlertCall = { kind: string; detail: { sessionId?: string; error?: string } };

const VECTOR = new Array(768).fill(0).map((_, index) => (index === 0 ? 1 : 0));

let generate: (text: string, taskType: string) => Promise<number[]>;
let writeEmbedding: (values: Record<string, unknown>) => void;
let insertedRows: Array<Record<string, unknown>> = [];
const generateCalls: Array<{ text: string; taskType: string }> = [];
const embeddingWrites: Array<Record<string, unknown>> = [];
const alerts: AlertCall[] = [];

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
  generateEmbedding: (text: string, taskType: string) => {
    generateCalls.push({ text, taskType });
    return generate(text, taskType);
  },
}));

mock.module('../../lib/alerting.js', () => ({
  alert: (kind: string, detail: AlertCall['detail'] = {}) => {
    alerts.push({ kind, detail });
  },
}));

const { MemoryService, attachEmbedding } = await import('../memory-service.js');

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
      { text: 'Balthazar warned the party about the well.', taskType: 'RETRIEVAL_DOCUMENT' },
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
      throw new Error('embedContent 503');
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

describe('attachEmbedding', () => {
  test('alerts with the memory and session instead of throwing', async () => {
    generate = async () => {
      throw new Error('embedContent 503');
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
});
