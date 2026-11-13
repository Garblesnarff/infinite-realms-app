/* eslint-disable max-lines -- one test per branch of the retry: claim, write, failure and list. */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

// #1502: the session-load sweep also re-publishes a `ready` reply whose transcript write failed.
// These cover each branch with an injected store, claim, list and write, so no database is touched.

let warnings: Record<string, unknown>[] = [];
const testLogger = {
  debug: () => {},
  info: () => {},
  warn: (line: unknown) => warnings.push(line as Record<string, unknown>),
  error: () => {},
  child: () => testLogger,
};
mock.module('../../../lib/logger.js', () => ({
  logger: testLogger,
  combatLogger: testLogger,
  spellLogger: testLogger,
  progressionLogger: testLogger,
  errorLogSerializers: {},
  default: testLogger,
}));

const {
  canTransitionDmReply,
  DM_REPLY_PUBLISH_RETRY_GRACE_MS,
  DM_REPLY_RECORD_EXPIRY_MS,
  expireStaleHeldReplies,
} = await import('../dm-reply-persistence.js');

type DmReplyRecordState = 'held' | 'ready' | 'persisted' | 'cancelled';
type DmReplyRecord = {
  id: string;
  sessionId: string;
  userId: string;
  state: DmReplyRecordState;
  text: string;
  envelope: Record<string, unknown> | null;
  createdAt: Date;
};
type DmReplyTransitionResult =
  | { ok: true; state: DmReplyRecordState }
  | { ok: false; reason: 'no_record' | 'illegal_from'; state?: DmReplyRecordState };
interface DmReplyRecordStore {
  read(id: string): Promise<DmReplyRecord | null>;
  insertHeld(record: Omit<DmReplyRecord, 'state' | 'createdAt'>): Promise<void>;
  transition(id: string, to: DmReplyRecordState): Promise<DmReplyTransitionResult>;
}

function memoryStore(
  seed: DmReplyRecord[] = [],
): DmReplyRecordStore & { rows: Map<string, DmReplyRecord> } {
  const rows = new Map(seed.map((record) => [record.id, { ...record }]));
  const store: DmReplyRecordStore & { rows: Map<string, DmReplyRecord> } = {
    rows,
    async read(id) {
      const row = rows.get(id);
      return row ? { ...row } : null;
    },
    async insertHeld(record) {
      if (!rows.has(record.id))
        rows.set(record.id, { ...record, state: 'held', createdAt: new Date() });
    },
    async transition(id, to): Promise<DmReplyTransitionResult> {
      const row = rows.get(id);
      if (!row) return { ok: false, reason: 'no_record' };
      if (!canTransitionDmReply(row.state, to)) {
        return { ok: false, reason: 'illegal_from', state: row.state };
      }
      rows.set(id, { ...row, state: to });
      return { ok: true, state: to };
    },
  };
  return store;
}

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '33333333-3333-4333-8333-333333333333';
const SESSION = '22222222-2222-4222-8222-222222222222';
const USER = 'user_test';
const TEXT = 'The goblins leap from the rocks.\n\nA. Fight\nB. Flee';
const NOW = new Date('2026-11-13T12:00:00Z');

function readyRecord(id: string): DmReplyRecord {
  return {
    id,
    sessionId: SESSION,
    userId: USER,
    state: 'ready',
    text: TEXT,
    envelope: null,
    createdAt: new Date(NOW.getTime() - 10 * 60_000),
  };
}

function sweepWarnings(msg: string): Record<string, unknown>[] {
  return warnings.filter((line) => line.msg === msg);
}

beforeEach(() => {
  warnings = [];
});

describe('#1502 session-load sweep: stale ready records', () => {
  test('a stale ready record is claimed, written once, and ends persisted', async () => {
    const store = memoryStore([readyRecord(ID_A)]);
    const writes: string[] = [];
    await expireStaleHeldReplies(
      { sessionId: SESSION, userId: USER, now: NOW },
      {
        store,
        listStale: async () => [readyRecord(ID_A)],
        claimReady: async () => true,
        writeRow: async (record) => {
          writes.push(record.id);
        },
      },
    );
    expect(writes).toEqual([ID_A]);
    expect(store.rows.get(ID_A)?.state).toBe('persisted');
    expect(sweepWarnings('DM_REPLY_PUBLISH_RETRY_FAILED')).toEqual([]);
  });

  test('the sweep reads one scope: owner and session, held cutoff, and the 2-minute ready grace', async () => {
    const scopes: Array<{ sessionId: string; userId: string; before: Date }> = [];
    const readyCutoffs: Date[] = [];
    await expireStaleHeldReplies(
      { sessionId: SESSION, userId: USER, now: NOW },
      {
        store: memoryStore(),
        listStale: async (scope, readyBefore) => {
          scopes.push(scope);
          readyCutoffs.push(readyBefore);
          return [];
        },
      },
    );
    expect(DM_REPLY_PUBLISH_RETRY_GRACE_MS).toBe(2 * 60_000);
    expect(scopes).toEqual([
      {
        sessionId: SESSION,
        userId: USER,
        before: new Date(NOW.getTime() - DM_REPLY_RECORD_EXPIRY_MS),
      },
    ]);
    expect(readyCutoffs).toEqual([new Date(NOW.getTime() - DM_REPLY_PUBLISH_RETRY_GRACE_MS)]);
  });

  test('a record whose claim another load won is not written', async () => {
    const store = memoryStore([readyRecord(ID_A)]);
    let writes = 0;
    await expireStaleHeldReplies(
      { sessionId: SESSION, userId: USER, now: NOW },
      {
        store,
        listStale: async () => [readyRecord(ID_A)],
        claimReady: async () => false,
        writeRow: async () => {
          writes += 1;
        },
      },
    );
    expect(writes).toBe(0);
    expect(store.rows.get(ID_A)?.state).toBe('ready');
  });

  test('two concurrent loads publish the record once', async () => {
    const store = memoryStore([readyRecord(ID_A)]);
    const claimed = new Set<string>();
    const writes: string[] = [];
    const deps = {
      store,
      listStale: async () => [readyRecord(ID_A)],
      claimReady: async (id: string) => {
        if (claimed.has(id)) return false;
        claimed.add(id);
        return true;
      },
      writeRow: async (record: DmReplyRecord) => {
        writes.push(record.id);
      },
    };
    await Promise.all([
      expireStaleHeldReplies({ sessionId: SESSION, userId: USER, now: NOW }, deps),
      expireStaleHeldReplies({ sessionId: SESSION, userId: USER, now: NOW }, deps),
    ]);
    expect(writes).toEqual([ID_A]);
    expect(store.rows.get(ID_A)?.state).toBe('persisted');
  });

  test('a failed write leaves the record ready and logs once with the record id only', async () => {
    const store = memoryStore([readyRecord(ID_A)]);
    await expireStaleHeldReplies(
      { sessionId: SESSION, userId: USER, now: NOW },
      {
        store,
        listStale: async () => [readyRecord(ID_A)],
        claimReady: async () => true,
        writeRow: async () => {
          throw new Error('transcript write refused');
        },
      },
    );
    expect(store.rows.get(ID_A)?.state).toBe('ready');
    const failed = sweepWarnings('DM_REPLY_PUBLISH_RETRY_FAILED');
    expect(failed).toHaveLength(1);
    const [line] = failed;
    expect(Object.keys(line ?? {}).sort()).toEqual(['msg', 'recordId']);
    expect(line?.recordId).toBe(ID_A);
    expect(JSON.stringify(line)).not.toContain(TEXT);
  });

  test('a throw for one record is logged and the next record still publishes', async () => {
    const store = memoryStore([readyRecord(ID_A), readyRecord(ID_B)]);
    await expireStaleHeldReplies(
      { sessionId: SESSION, userId: USER, now: NOW },
      {
        store,
        listStale: async () => [readyRecord(ID_A), readyRecord(ID_B)],
        claimReady: async (id) => {
          if (id === ID_A) throw new Error('claim query failed');
          return true;
        },
        writeRow: async () => {},
      },
    );
    expect(store.rows.get(ID_B)?.state).toBe('persisted');
    expect(store.rows.get(ID_A)?.state).toBe('ready');
    expect(sweepWarnings('DM_REPLY_PUBLISH_RETRY_FAILED').map((line) => line.recordId)).toEqual([
      ID_A,
    ]);
  });

  test('ready records do not count as moved held records', async () => {
    const store = memoryStore([readyRecord(ID_A)]);
    const moved = await expireStaleHeldReplies(
      { sessionId: SESSION, userId: USER, now: NOW },
      {
        store,
        listStale: async () => [readyRecord(ID_A)],
        claimReady: async () => true,
        writeRow: async () => {},
      },
    );
    expect(moved).toBe(0);
    expect(store.rows.get(ID_A)?.state).toBe('persisted');
  });

  test('a failed sweep never throws; the existing sweep failure log names it', async () => {
    const moved = await expireStaleHeldReplies(
      { sessionId: SESSION, userId: USER, now: NOW },
      {
        store: memoryStore(),
        listStale: async () => {
          throw new Error('connection reset');
        },
      },
    );
    expect(moved).toBe(0);
    expect(sweepWarnings('DM_REPLY_EXPIRY_FAILED')).toHaveLength(1);
  });
});
