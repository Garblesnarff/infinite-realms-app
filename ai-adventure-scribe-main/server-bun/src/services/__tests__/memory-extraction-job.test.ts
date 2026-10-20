import { beforeEach, describe, expect, it, mock } from 'bun:test';

// #2148: the server finishes a memory extraction on its own. No test here has a client
// waiting on anything — runMemoryExtractionJob is called directly, the way the route's
// fire-and-forget start calls it.

type ExtractResult = {
  text?: string;
  error?: string;
  provider?: string;
  model?: string;
  usage?: { inputTokens: number; outputTokens: number };
};

let extractResult: ExtractResult = {};
let insertError: Error | null = null;
const insertCalls: Array<{ rows: Array<Record<string, unknown>>; userId: string }> = [];
const alerts: string[] = [];
const usageCalls: unknown[] = [];
const warnings: Array<Record<string, unknown>> = [];
// When set, the model call waits for it, so a test can hold jobs in flight.
let extractGate: Promise<void> | null = null;

// #846: in-memory stand-in for memory_extraction_jobs, with the same guarded
// claim semantics as the real store (a claim only wins on the expected status,
// and a running claim only wins when the heartbeat is stale).
const STALE_MS = 15 * 60 * 1000;
const jobRows = new Map<string, Record<string, any>>();
// Fault injection for the settle-phase tests: when true, the next
// completeMemoryExtractionJob call throws (a transient DB error).
let completeThrowsOnce = false;
const row = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  userId: 'user-1',
  plan: 'free',
  sessionId: SESSION,
  campaignId: CAMPAIGN,
  characterId: 'char-1',
  kind: 'memories',
  prompt: 'extract: Sergeant Vance guards the gate. The bridge is out. memory',
  payloadHash: 'a'.repeat(64),
  maxTokens: 1000,
  turn: null,
  status: 'pending',
  attempts: 0,
  charged: false,
  error: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  completedAt: null,
  ...overrides,
});
mock.module('../memory-extraction-job-store.js', () => ({
  STALE_RUNNING_JOB_MS: STALE_MS,
  persistMemoryExtractionJob: async (r: Record<string, unknown>) => {
    const stored = { ...row(r.id as string), ...r };
    jobRows.set(stored.id, stored);
    return { ...stored };
  },
  claimMemoryExtractionJob: async (id: string, expected: 'pending' | 'running') => {
    const r = jobRows.get(id);
    if (!r || r.status !== expected) return null;
    if (expected === 'running' && Date.now() - new Date(r.updatedAt).getTime() < STALE_MS)
      return null;
    const claimed = { ...r, status: 'running', attempts: r.attempts + 1, updatedAt: new Date() };
    jobRows.set(id, claimed);
    return { ...claimed };
  },
  listRunnableMemoryExtractionJobs: async (limit: number) =>
    [...jobRows.values()]
      .filter(
        (r) =>
          r.status === 'pending' ||
          (r.status === 'running' && Date.now() - new Date(r.updatedAt).getTime() >= STALE_MS),
      )
      .sort((a, b) => +a.createdAt - +b.createdAt)
      .slice(0, limit)
      .map((r) => ({ ...r })),
  completeMemoryExtractionJob: async (id: string, charged: boolean) => {
    if (completeThrowsOnce) {
      completeThrowsOnce = false;
      throw new Error('connection reset during settle');
    }
    const r = jobRows.get(id);
    if (!r || r.status !== 'running') return false;
    jobRows.set(id, {
      ...r,
      status: 'completed',
      charged,
      error: null,
      completedAt: new Date(),
      updatedAt: new Date(),
    });
    return true;
  },
  markMemoryExtractionJobCharged: async (id: string) => {
    const r = jobRows.get(id);
    if (!r || r.status !== 'completed' || r.charged) return false;
    jobRows.set(id, { ...r, charged: true, updatedAt: new Date() });
    return true;
  },
  releaseMemoryExtractionJob: async (id: string, error: string) => {
    const r = jobRows.get(id);
    if (!r || r.status !== 'running') return false;
    jobRows.set(id, { ...r, status: 'pending', error, updatedAt: new Date() });
    return true;
  },
  failMemoryExtractionJob: async (id: string, error: string) => {
    const r = jobRows.get(id);
    if (!r || r.status !== 'running') return false;
    jobRows.set(id, { ...r, status: 'failed', error, updatedAt: new Date() });
    return true;
  },
}));

const errorLogs: Array<Record<string, unknown>> = [];
const testLogger = {
  debug: () => {},
  info: () => {},
  warn: (entry: Record<string, unknown>) => {
    warnings.push(entry);
  },
  error: (entry: Record<string, unknown>) => {
    errorLogs.push(entry);
  },
  child: () => testLogger,
};
mock.module('../../lib/logger.js', () => ({ logger: testLogger, default: testLogger }));
mock.module('../../lib/alerting.js', () => ({
  alert: (kind: string) => {
    alerts.push(kind);
  },
}));
mock.module('../llm-provider-service.js', () => ({
  LLMProviderService: {
    extract: async () => {
      if (extractGate) await extractGate;
      return extractResult;
    },
  },
}));
let quotaRemaining = 10;
// When set, the completion-time charge throws (the usage store failing closed).
let quotaConsumeError: Error | null = null;
const quotaConsumeCalls: unknown[] = [];
mock.module('../ai-usage-service.js', () => ({
  AIUsageService: {
    recordProviderUsage: async (opts: unknown) => {
      usageCalls.push(opts);
    },
    getQuotaStatus: async () => ({
      plan: 'free',
      limits: { daily: { llm: 15, llm_system: 500, image: 1, voice: 0 } },
      usage: 500 - quotaRemaining,
      remaining: quotaRemaining,
      resetAt: '2026-10-20T00:00:00.000Z',
    }),
    checkQuotaAndConsume: async (opts: unknown) => {
      quotaConsumeCalls.push(opts);
      if (quotaConsumeError) throw quotaConsumeError;
      return {
        allowed: quotaRemaining > 0,
        remaining: Math.max(0, quotaRemaining - 1),
        resetAt: '2026-10-20T00:00:00.000Z',
        usageId: 1,
      };
    },
    assertUsageStoreAvailable: async () => {},
  },
}));
// Job ids whose memory rows already exist — the dedup source for
// MemoryService.existsByExtractionJobId, fed by the insert mock below.
const writtenJobIds = new Set<string>();
mock.module('../memory-service.js', () => ({
  MemoryService: {
    insert: async (rows: Array<Record<string, unknown>>, userId: string) => {
      if (insertError) throw insertError;
      insertCalls.push({ rows, userId });
      for (const r of rows) {
        const jid = (r.metadata as Record<string, unknown> | undefined)?.jobId;
        if (typeof jid === 'string') writtenJobIds.add(jid);
      }
      return rows;
    },
    existsByExtractionJobId: async (jobId: string) => writtenJobIds.has(jobId),
  },
}));

const {
  runMemoryExtractionJob,
  parseExtractionText,
  startMemoryExtractionJob,
  inFlightMemoryExtractionJobs,
  releaseInFlightMemoryExtractionJobs,
  resumePendingMemoryExtractionJobs,
} = await import('../memory-extraction-job.js');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Polls the fake store until the row matches, so fire-and-forget executions
// (resume, retries) can be awaited without knowing their internals.
const waitForRow = async (
  id: string,
  predicate: (r: Record<string, any>) => boolean,
  label: string,
) => {
  const deadline = Date.now() + 5000;
  for (;;) {
    const r = jobRows.get(id);
    if (r && predicate(r)) return r;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label} on ${id}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const SESSION = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN = '22222222-2222-4222-8222-222222222222';

const job = (overrides: Partial<Parameters<typeof runMemoryExtractionJob>[1]> = {}) => ({
  userId: 'user-1',
  plan: 'free',
  sessionId: SESSION,
  campaignId: CAMPAIGN,
  characterId: 'char-1',
  kind: 'memories' as const,
  // #353: a quote must be verbatim from the prompt, so the test prompt contains
  // every phrase the fixtures quote (production prompts contain the exchange).
  prompt: 'extract: Sergeant Vance guards the gate. The bridge is out. memory',
  maxTokens: 1000,
  ...overrides,
});

describe('runMemoryExtractionJob (#2148)', () => {
  beforeEach(() => {
    insertCalls.length = 0;
    alerts.length = 0;
    usageCalls.length = 0;
    warnings.length = 0;
    errorLogs.length = 0;
    quotaConsumeCalls.length = 0;
    quotaRemaining = 10;
    quotaConsumeError = null;
    completeThrowsOnce = false;
    jobRows.clear();
    writtenJobIds.clear();
    extractGate = null;
    insertError = null;
    extractResult = {
      provider: 'openrouter',
      model: 'extract/model',
      usage: { inputTokens: 100, outputTokens: 50 },
      text: `Here you go:
{"memories":[
  {"session_id":"someone-elses-session","type":"npc|location","category":"people","content":"Sergeant Vance guards the gate [ASSET:npc-vance]","importance":9,"emotional_tone":"foreboding","quote":"Sergeant Vance guards the gate"},
  {"type":"not-a-type","content":"The bridge is out","importance":"high","quote":"The bridge is out"},
  {"type":"event","content":"   "}
]}`,
    };
  });

  it('persists the parsed memories itself, scoped to the job session', async () => {
    const outcome = await runMemoryExtractionJob('job-1', job());

    expect(outcome).toEqual({ inserted: 2, status: 'completed' });
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].userId).toBe('user-1');
    const [first, second] = insertCalls[0].rows;
    expect(first).toMatchObject({
      sessionId: SESSION,
      campaignId: CAMPAIGN,
      type: 'npc',
      content: 'Sergeant Vance guards the gate',
      importance: 9,
      emotionalTone: 'foreboding',
      metadata: {
        category: 'people',
        source: 'llm_extraction',
        jobId: 'job-1',
        characterId: 'char-1',
      },
    });
    expect(second).toMatchObject({ sessionId: SESSION, type: 'general', importance: 3 });
    expect(usageCalls).toHaveLength(1);
  });

  it('a failed LLM call writes no rows', async () => {
    extractResult = { error: 'All extraction models failed', text: '' };

    const outcome = await runMemoryExtractionJob('job-2', job());

    // #846: the failure reason rides the outcome so the job row can record it.
    expect(outcome).toEqual({
      inserted: 0,
      status: 'failed',
      error: 'All extraction models failed',
    });
    expect(insertCalls).toHaveLength(0);
    expect(alerts).toEqual(['llm_extraction_degraded']);
  });

  it('writes every row in one insert, so a failed write leaves no partial rows and does not throw', async () => {
    insertError = new Error('connection reset');

    const outcome = await runMemoryExtractionJob('job-3', job());

    expect(outcome).toEqual({ inserted: 0, status: 'failed', error: 'connection reset' });
    expect(insertCalls).toHaveLength(0);
  });

  it('unparseable model text completes with nothing written', async () => {
    extractResult = { ...extractResult, text: 'no json here' };

    const outcome = await runMemoryExtractionJob('job-4', job());

    expect(outcome).toEqual({ inserted: 0, status: 'completed' });
    expect(insertCalls).toHaveLength(0);
  });

  it('stores a periodic summary as one campaign_summary row', async () => {
    extractResult = { ...extractResult, text: '  The party crossed the river.  ' };

    await runMemoryExtractionJob('job-5', job({ kind: 'summary', turn: 20 }));

    expect(insertCalls[0].rows).toEqual([
      {
        sessionId: SESSION,
        campaignId: CAMPAIGN,
        content: 'The party crossed the river.',
        type: 'story_beat',
        memoryType: 'campaign_summary',
        importance: 9,
        metadata: { source: 'periodic_summary', turn: 20, jobId: 'job-5' },
      },
    ]);
  });

  it('caps a rambling model at ten memories', () => {
    const many = {
      memories: Array.from({ length: 30 }, (_, i) => ({ type: 'event', content: `m${i}`, quote: 'memory' })),
    };
    expect(parseExtractionText(JSON.stringify(many), job(), 'job-6')).toHaveLength(10);
  });

  it('clamps model importance into the 1–10 scale the prompt asks for (#2283)', () => {
    const text = JSON.stringify({
      memories: [14, 0, -3, 7.6, 10, 1].map((importance, i) => ({
        content: `memory ${i}`,
        importance,
        quote: 'memory',
      })),
    });
    const rows = parseExtractionText(text, job(), 'job-7');
    expect(rows.map((row) => row.importance)).toEqual([10, 1, 1, 8, 10, 1]);
  });

  it('releases in-flight jobs back to pending on shutdown, so the next startup resumes them (#846)', async () => {
    let release!: () => void;
    extractGate = new Promise((resolve) => {
      release = resolve;
    });

    const a = await startMemoryExtractionJob(job());
    const b = await startMemoryExtractionJob(job({ kind: 'summary' }));
    // startMemoryExtractionJob is async now; the claim lands a few microtasks later.
    await flush();
    await flush();
    expect(inFlightMemoryExtractionJobs()).toBe(2);

    await releaseInFlightMemoryExtractionJobs('SIGTERM');
    expect(warnings).toContainEqual(
      expect.objectContaining({
        msg: 'memory_extraction.shutdown_release',
        count: 2,
        signal: 'SIGTERM',
      }),
    );
    // Both rows are pending again: a restart resumes them instead of waiting out
    // the stale-running window. Nothing is dropped.
    expect(jobRows.size).toBe(2);
    for (const stored of jobRows.values()) {
      expect(stored.status).toBe('pending');
    }

    release();
    await Promise.all([a.done, b.done]);
    expect(inFlightMemoryExtractionJobs()).toBe(0);

    // The released executors finished and wrote their memories, but lost the
    // completion race (their rows are pending again). The next startup's resume
    // settles them from the rows already written — no second model call, no
    // duplicate memories, and the charge lands exactly once per job.
    const insertCallsBefore = insertCalls.length;
    expect(insertCallsBefore).toBe(2);
    await resumePendingMemoryExtractionJobs();
    for (const id of [a.jobId, b.jobId]) {
      const settled = await waitForRow(id, (r) => r.status === 'completed', 'settled completion');
      expect(settled.charged).toBe(true);
    }
    expect(insertCalls).toHaveLength(insertCallsBefore);
    expect(quotaConsumeCalls).toHaveLength(2);

    // Nothing in flight: shutdown stays quiet.
    warnings.length = 0;
    await releaseInFlightMemoryExtractionJobs('SIGTERM');
    expect(warnings).toHaveLength(0);
  });

  it('persists the row synchronously with accept, before the execution finishes (#846)', async () => {
    const pending = startMemoryExtractionJob(job({ turn: 12 }));

    // The row exists before the returned promise settles: a crash after the
    // 202 still leaves a resumable job.
    expect(jobRows.size).toBe(1);

    const { jobId, done } = await pending;
    const stored = jobRows.get(jobId)!;
    expect(stored).toMatchObject({
      sessionId: SESSION,
      campaignId: CAMPAIGN,
      kind: 'memories',
      prompt: expect.stringContaining('Sergeant Vance'),
      turn: 12,
      charged: false,
      error: null,
    });
    expect(stored.payloadHash).toMatch(/^[0-9a-f]{64}$/);

    const outcome = await done;
    expect(outcome.status).toBe('completed');
    expect(jobRows.get(jobId)).toMatchObject({ status: 'completed', charged: true });
  });

  it('charges quota exactly once on completion, and never for a job that fails (#846)', async () => {
    const { done } = await startMemoryExtractionJob(job());
    await done;

    expect(quotaConsumeCalls).toHaveLength(1);
    expect(quotaConsumeCalls[0]).toMatchObject({
      userId: 'user-1',
      plan: 'free',
      type: 'llm_system',
      units: 1,
    });

    extractResult = { error: 'All extraction models failed', text: '' };
    const failed = await startMemoryExtractionJob(job());
    await failed.done;

    // The failure path is never charged; the unit is only consumed on completion.
    // The job is released back to pending for its next attempt, uncharged.
    expect(quotaConsumeCalls).toHaveLength(1);
    const failedRow = jobRows.get(failed.jobId)!;
    expect(failedRow.status).toBe('pending');
    expect(failedRow.attempts).toBe(1);
    expect(failedRow.charged).toBe(false);
    // Remove the row so the scheduled retry timer stands down quietly.
    jobRows.delete(failed.jobId);
  });

  it('a job accepted before a simulated restart runs after it (#846)', async () => {
    // "Process 1": the route accepted the job (the row exists) and died before
    // executing it. "Process 2" boots and resumes.
    const id = 'restart-job-1';
    jobRows.set(id, row(id));

    const { resumed } = await resumePendingMemoryExtractionJobs();
    expect(resumed).toBe(1);

    const completed = await waitForRow(id, (r) => r.status === 'completed', 'completion');
    expect(completed.charged).toBe(true);
    expect(quotaConsumeCalls).toHaveLength(1);
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].rows[0]).toMatchObject({
      sessionId: SESSION,
      metadata: expect.objectContaining({ source: 'llm_extraction', jobId: id }),
    });
  });

  it('resume never double-runs a job that is already executing (#846)', async () => {
    const id = 'inflight-job-1';
    jobRows.set(id, row(id, { status: 'running', attempts: 1, updatedAt: new Date() }));

    const { resumed } = await resumePendingMemoryExtractionJobs();
    // A running row with a fresh heartbeat is not even listed, let alone claimed.
    expect(resumed).toBe(0);
    await flush();
    await flush();

    expect(jobRows.get(id)).toMatchObject({ status: 'running', attempts: 1 });
    expect(insertCalls).toHaveLength(0);
    expect(quotaConsumeCalls).toHaveLength(0);
  });

  it('reclaims a stale running job and charges it exactly once (#846)', async () => {
    const id = 'stale-job-1';
    jobRows.set(
      id,
      row(id, { status: 'running', attempts: 1, updatedAt: new Date(Date.now() - 20 * 60 * 1000) }),
    );

    await resumePendingMemoryExtractionJobs();
    const completed = await waitForRow(id, (r) => r.status === 'completed', 'completion');

    expect(completed.attempts).toBe(2);
    expect(completed.charged).toBe(true);
    expect(quotaConsumeCalls).toHaveLength(1);
    expect(insertCalls).toHaveLength(1);
  });

  it('a store error during settle never rejects done; the row is released for retry (#846)', async () => {
    completeThrowsOnce = true;

    const { jobId, done } = await startMemoryExtractionJob(job());
    const outcome = await done;

    // No unhandled rejection: the settle guard recovered by releasing the row.
    expect(outcome.status).toBe('completed');
    expect(errorLogs).toContainEqual(
      expect.objectContaining({ msg: 'memory_extraction.settle_failed', jobId }),
    );
    const recovered = await waitForRow(jobId, (r) => r.status === 'pending', 'settle recovery');
    expect(recovered.error).toBe('settle failed');

    // A subsequent resume completes it normally: memories written once, charged once.
    completeThrowsOnce = false;
    await resumePendingMemoryExtractionJobs();
    const settled = await waitForRow(jobId, (r) => r.status === 'completed', 'resume completion');
    expect(settled.charged).toBe(true);
    expect(insertCalls).toHaveLength(1);
    expect(quotaConsumeCalls).toHaveLength(1);
  });

  it('a charge that throws at completion is retried, not silently dropped (#846)', async () => {
    // Cap timer delays so the module's charge-retry backoff (30 s) fires at once.
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void) =>
      realSetTimeout(fn, 1)) as typeof setTimeout;
    try {
      quotaConsumeError = new Error('QuotaUnavailableError: store down');

      const { jobId, done } = await startMemoryExtractionJob(job());
      const outcome = await done;

      expect(outcome.status).toBe('completed');
      const row = jobRows.get(jobId)!;
      expect(row.status).toBe('completed');
      // The unit was not consumed — but the row is honest about it, and the
      // charge is scheduled for retry instead of leaking silently.
      expect(row.charged).toBe(false);
      expect(quotaConsumeCalls).toHaveLength(1);
      expect(insertCalls).toHaveLength(1);

      // The store comes back; the scheduled retry lands the unit exactly once.
      quotaConsumeError = null;
      const chargedRow = await waitForRow(jobId, (r) => r.charged === true, 'charge retry');
      expect(chargedRow.status).toBe('completed');
      expect(quotaConsumeCalls).toHaveLength(2);
      expect(insertCalls).toHaveLength(1);
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  it('a job that keeps failing is retried, then terminally failed and never charged (#846)', async () => {
    extractResult = { error: 'persistent outage', text: '' };
    const id = 'flaky-job-1';
    jobRows.set(id, row(id));

    for (const expectedAttempts of [1, 2]) {
      await resumePendingMemoryExtractionJobs();
      await waitForRow(
        id,
        (r) => r.status === 'pending' && r.attempts === expectedAttempts,
        `release after attempt ${expectedAttempts}`,
      );
      // Clear the in-process retry timer's target so it stands down quietly.
      jobRows.delete(id);
      jobRows.set(id, row(id, { status: 'pending', attempts: expectedAttempts }));
    }

    await resumePendingMemoryExtractionJobs();
    const failed = await waitForRow(id, (r) => r.status === 'failed', 'terminal failure');

    expect(failed.attempts).toBe(3);
    expect(failed.error).toBe('persistent outage');
    expect(failed.charged).toBe(false);
    expect(quotaConsumeCalls).toHaveLength(0);
    expect(insertCalls).toHaveLength(0);
  });
});
