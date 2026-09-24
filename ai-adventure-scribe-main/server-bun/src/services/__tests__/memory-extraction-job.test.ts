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

const testLogger = {
  debug: () => {},
  info: () => {},
  warn: (entry: Record<string, unknown>) => {
    warnings.push(entry);
  },
  error: () => {},
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
mock.module('../ai-usage-service.js', () => ({
  AIUsageService: {
    recordProviderUsage: async (opts: unknown) => {
      usageCalls.push(opts);
    },
  },
}));
mock.module('../memory-service.js', () => ({
  MemoryService: {
    insert: async (rows: Array<Record<string, unknown>>, userId: string) => {
      if (insertError) throw insertError;
      insertCalls.push({ rows, userId });
      return rows;
    },
  },
}));

const {
  runMemoryExtractionJob,
  parseExtractionText,
  startMemoryExtractionJob,
  inFlightMemoryExtractionJobs,
  logAbandonedMemoryExtractionJobs,
} = await import('../memory-extraction-job.js');

const SESSION = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN = '22222222-2222-4222-8222-222222222222';

const job = (overrides: Partial<Parameters<typeof runMemoryExtractionJob>[1]> = {}) => ({
  userId: 'user-1',
  plan: 'free',
  sessionId: SESSION,
  campaignId: CAMPAIGN,
  characterId: 'char-1',
  kind: 'memories' as const,
  prompt: 'extract',
  maxTokens: 1000,
  ...overrides,
});

describe('runMemoryExtractionJob (#2148)', () => {
  beforeEach(() => {
    insertCalls.length = 0;
    alerts.length = 0;
    usageCalls.length = 0;
    warnings.length = 0;
    extractGate = null;
    insertError = null;
    extractResult = {
      provider: 'openrouter',
      model: 'extract/model',
      usage: { inputTokens: 100, outputTokens: 50 },
      text: `Here you go:
{"memories":[
  {"session_id":"someone-elses-session","type":"npc|location","category":"people","content":"Sergeant Vance guards the gate [ASSET:npc-vance]","importance":9,"emotional_tone":"foreboding"},
  {"type":"not-a-type","content":"The bridge is out","importance":"high"},
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
      importance: 5,
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

    expect(outcome).toEqual({ inserted: 0, status: 'failed' });
    expect(insertCalls).toHaveLength(0);
    expect(alerts).toEqual(['llm_extraction_degraded']);
  });

  it('writes every row in one insert, so a failed write leaves no partial rows and does not throw', async () => {
    insertError = new Error('connection reset');

    const outcome = await runMemoryExtractionJob('job-3', job());

    expect(outcome).toEqual({ inserted: 0, status: 'failed' });
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
        importance: 5,
        metadata: { source: 'periodic_summary', turn: 20, jobId: 'job-5' },
      },
    ]);
  });

  it('caps a rambling model at ten memories', () => {
    const many = {
      memories: Array.from({ length: 30 }, (_, i) => ({ type: 'event', content: `m${i}` })),
    };
    expect(parseExtractionText(JSON.stringify(many), job(), 'job-6')).toHaveLength(10);
  });

  it('counts jobs in flight and logs them as abandoned on shutdown (#2186)', async () => {
    let release!: () => void;
    extractGate = new Promise((resolve) => {
      release = resolve;
    });

    const a = startMemoryExtractionJob(job());
    const b = startMemoryExtractionJob(job({ kind: 'summary' }));
    expect(inFlightMemoryExtractionJobs()).toBe(2);

    logAbandonedMemoryExtractionJobs('SIGTERM');
    expect(warnings).toContainEqual(
      expect.objectContaining({ msg: 'memory_extraction.abandoned', count: 2, signal: 'SIGTERM' }),
    );

    release();
    await Promise.all([a.done, b.done]);
    expect(inFlightMemoryExtractionJobs()).toBe(0);

    // Nothing in flight: shutdown stays quiet.
    warnings.length = 0;
    logAbandonedMemoryExtractionJobs('SIGTERM');
    expect(warnings).toHaveLength(0);
  });
});
