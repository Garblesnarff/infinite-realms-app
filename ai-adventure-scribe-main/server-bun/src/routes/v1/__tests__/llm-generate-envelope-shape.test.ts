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
      body: JSON.stringify({ prompt: 'p', player_input: PLAYER_INPUT, requestType: 'user' }),
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
});
