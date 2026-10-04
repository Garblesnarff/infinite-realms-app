import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

// #2022: the envelope shape must be recoverable from the log, and the log must
// never carry model or player prose.

let generatedResult: Record<string, unknown> = { text: '', provider: 'openrouter', model: 't/m' };
let loggedObjects: Record<string, unknown>[] = [];

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'env-user', email: 'env@example.test', plan: 'free' },
    error: null,
  }),
}));
const testLogger = {
  debug: () => {},
  info: (msg: unknown) => {
    if (msg && typeof msg === 'object') loggedObjects.push(msg as Record<string, unknown>);
  },
  warn: () => {},
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
mock.module('../../../middleware/admin.js', () => ({ isAdmin: () => false }));
mock.module('../../../middleware/rate-limit.js', () => ({
  planRateLimit: () => new Elysia({ name: 'test-plan-rate-limit' }),
}));
mock.module('../../../services/ai-usage-service.js', () => ({
  AIUsageService: {
    checkQuotaAndConsume: async () => ({
      allowed: true,
      remaining: 9,
      resetAt: new Date(Date.now() + 60_000),
    }),
    recordProviderUsage: async () => {},
  },
}));
mock.module('../../../services/llm-provider-service.js', () => ({
  LLMProviderService: { generate: async () => generatedResult },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { llmRoutes } = await import('../llm.js');
const app = createRequestPipelineApp().use(llmRoutes);

const NARRATION = 'The professor turns, eyes wide and bloodshot, and whispers your name.';
const PLAYER_INPUT = 'i take a swing and attempt to punch the professor';

async function generate(text: string) {
  loggedObjects = [];
  generatedResult = { text, provider: 'openrouter', model: 't/m' };
  await app.handle(
    new Request('http://localhost/v1/llm/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: 'p',
        sessionId: 'session-under-test',
        player_input: PLAYER_INPUT,
        requestType: 'user',
      }),
    }),
  );
  return loggedObjects.find((l) => l.msg === 'LLM_GENERATE_ENVELOPE_SHAPE');
}

describe('LLM_GENERATE_ENVELOPE_SHAPE', () => {
  it('records the keys and the two array lengths #2022 needed', async () => {
    const line = await generate(
      JSON.stringify({
        text: NARRATION,
        options: ['a', 'b'],
        combat_actions: [{ type: 'attack' }, { type: 'attack' }],
        roll_requests: [{ type: 'attack' }],
        combat_transition: 'start',
      }),
    );
    expect(line).toBeDefined();
    expect(line?.parsed).toBe(true);
    expect(line?.keys).toEqual([
      'combat_actions',
      'combat_transition',
      'options',
      'roll_requests',
      'text',
    ]);
    expect(line?.combatActions).toBe(2);
    expect(line?.rollRequests).toBe(1);
  });

  it('records roll request types and DCs so a hidden roll is identifiable (#2525)', async () => {
    // roll_requests entries in the shape the real producer emits: entries of the
    // DMResponse envelope (dm-response-schema.ts) carry `type` from its enum and
    // `dc: number | null`. The last two entries are adversarial: an unknown type
    // and a non-numeric dc must be reduced to enum/number-only log values.
    const line = await generate(
      JSON.stringify({
        text: NARRATION,
        roll_requests: [
          { type: 'attack', formula: '1d20+5', purpose: 'attack roll', dc: 15, ac: null },
          { type: 'save', formula: '1d20+2', purpose: 'dexterity save', dc: null, ac: null },
          { type: 'damage', formula: '2d6', purpose: 'damage', dc: 12, ac: null },
          { type: 'made_up_type', formula: '1d20', purpose: '???', dc: null, ac: null },
          { type: 'check', formula: '1d20', purpose: 'check', dc: 'very high', ac: null },
        ],
      }),
    );
    expect(line?.rollRequests).toBe(5);
    expect(line?.rollRequestTypes).toEqual(['attack', 'save', 'damage', 'other', 'check']);
    expect(line?.rollRequestDcs).toEqual([15, null, 12, null, null]);
  });

  it('records empty roll request type/dc lists when there are no roll requests', async () => {
    const line = await generate(JSON.stringify({ text: NARRATION, combat_actions: [] }));
    expect(line?.rollRequestTypes).toEqual([]);
    expect(line?.rollRequestDcs).toEqual([]);
  });

  it('distinguishes an absent array from an empty one', async () => {
    const line = await generate(JSON.stringify({ text: NARRATION, combat_actions: [] }));
    expect(line?.combatActions).toBe(0);
    expect(line?.rollRequests).toBeNull();
  });

  it('records a text-only (non-JSON) response rather than throwing', async () => {
    const line = await generate(NARRATION);
    expect(line).toBeDefined();
    expect(line?.parsed).toBe(false);
  });

  it('never puts narration, options or player input in the log', async () => {
    const line = await generate(
      JSON.stringify({
        text: NARRATION,
        options: ['Draw your blade', 'Apologise'],
        combat_actions: [{ type: 'attack', target: 'Professor Emil Darkwater' }],
      }),
    );
    const serialized = JSON.stringify(line);
    expect(serialized).not.toContain(NARRATION);
    expect(serialized).not.toContain('Draw your blade');
    expect(serialized).not.toContain('Professor Emil Darkwater');
    expect(serialized).not.toContain(PLAYER_INPUT);
    // the whole info stream, not just this line
    const all = JSON.stringify(loggedObjects);
    expect(all).not.toContain(NARRATION);
    expect(all).not.toContain('Draw your blade');
  });
  it('records textLength so an empty completion is distinguishable from prose (#2050 B)', async () => {
    const prose = 'The lantern gutters and the corridor exhales.';
    const proseLine = await generate(prose);
    expect(proseLine?.parsed).toBe(false);
    expect(proseLine?.textLength).toBe(prose.length);

    const emptyLine = await generate('');
    expect(emptyLine?.parsed).toBe(false);
    expect(emptyLine?.textLength).toBe(0);
  });

  it('carries sessionId from the request body, with no combatEntry present (#2050 C)', async () => {
    const line = await generate(JSON.stringify({ text: NARRATION, combat_actions: [] }));
    expect(line?.sessionId).toBe('session-under-test');
  });

  it('returns x-request-id and logs the same id on start and end (#2050 D)', async () => {
    loggedObjects = [];
    generatedResult = {
      text: JSON.stringify({ text: NARRATION }),
      provider: 'openrouter',
      model: 't/m',
    };
    const res = await app.handle(
      new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'p', sessionId: 'session-under-test', requestType: 'user' }),
      }),
    );
    const header = res.headers.get('x-request-id');
    expect(header).toBeTruthy();
    const ids = loggedObjects
      .filter((l) => l.msg === 'request.start' || l.msg === 'request.end')
      .map((l) => l.requestId);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    // one id for the whole request, and it is the one handed back
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe(header);
    expect(ids).not.toContain('unknown');
  });
});
