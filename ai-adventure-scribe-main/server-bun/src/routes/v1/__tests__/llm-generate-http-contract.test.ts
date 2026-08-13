/* eslint-disable max-lines -- this contract file keeps the request matrix together. */
import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

let generatedInput: Record<string, unknown> | undefined;
let generatedInputs: Record<string, unknown>[] = [];
let generatedQueue: Record<string, unknown>[] = [];
let generatedResult: Record<string, unknown> = {
  text: 'The frozen guests smell faintly of winter roses. What do you do?',
  provider: 'openrouter',
  model: 'test/model',
};

// Captures for the #1688 prompt-metrics log lines. Unlike the other logger
// methods (still no-ops -- their content isn't under test elsewhere in this
// file), info/warn push the raw message so tests can assert on it.
let loggedInfoLines: string[] = [];
let loggedWarnLines: string[] = [];

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'smoke-user', email: 'smoke@example.test', plan: 'free' },
    error: null,
  }),
}));
const testLogger = {
  debug: () => {},
  info: (msg: unknown) => {
    if (typeof msg === 'string') loggedInfoLines.push(msg);
  },
  warn: (msg: unknown) => {
    if (typeof msg === 'string') loggedWarnLines.push(msg);
  },
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
      remaining: 99,
      resetAt: new Date(Date.now() + 60_000),
    }),
    recordProviderUsage: async () => {},
  },
}));
mock.module('../../../services/llm-provider-service.js', () => ({
  LLMProviderService: {
    generate: async (input: Record<string, unknown>) => {
      generatedInput = input;
      generatedInputs.push(input);
      return generatedQueue.shift() || generatedResult;
    },
  },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { llmRoutes } = await import('../llm.js');
const app = createRequestPipelineApp().use(llmRoutes);

describe('POST /v1/llm/generate HTTP contract', () => {
  it('accepts a realistic gameplay payload through the production serializer', async () => {
    const prompt =
      'You are the dungeon master for a D&D 5e game. The party enters a candlelit banquet hall where every guest is frozen. Describe one sensory detail and ask what the player does.';
    const response = await app.handle(
      new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: { authorization: 'Bearer smoke-token', 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt,
          maxTokens: 120,
          temperature: 0.4,
          provider: 'openrouter',
          requestType: 'user',
        }),
      }),
    );
    const raw = await response.text();
    const body = JSON.parse(raw) as { text?: unknown; provider?: unknown; model?: unknown };

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(typeof body.text).toBe('string');
    expect(body.provider).toBe('openrouter');
    expect(body.model).toBe('test/model');
    expect(String(body.text).trim().length).toBeGreaterThan(0);
    expect(generatedInput?.prompt).toBe(prompt);
  });

  it('returns a retryable Gemini failure as a structured 502 with a retry hint', async () => {
    generatedResult = {
      text: '',
      error: 'LLM request failed',
      provider: 'gemini',
      model: 'gemini-2.5-flash-lite',
      upstreamStatus: 429,
      retryable: true,
      retryAfter: 3,
    };
    try {
      const response = await app.handle(
        new Request('http://localhost/v1/llm/generate', {
          method: 'POST',
          headers: { authorization: 'Bearer smoke-token', 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: 'hello' }),
        }),
      );
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(502);
      expect(response.headers.get('retry-after')).toBe('3');
      expect(body).toMatchObject({
        error: 'upstream_model_error',
        provider: 'gemini',
        model: 'gemini-2.5-flash-lite',
        retryable: true,
        retry_after: 3,
      });
    } finally {
      generatedResult = {
        text: 'The frozen guests smell faintly of winter roses. What do you do?',
        provider: 'openrouter',
        model: 'test/model',
      };
    }
  });

  it('issues exactly one corrective re-prompt for an inactive combat-signaling roll', async () => {
    generatedInputs = [];
    const base = {
      text: 'The goblin attacks. Roll initiative.',
      narration_segments: [],
      roll_requests: [
        {
          type: 'initiative',
          formula: '1d20+dex',
          purpose: 'Initiative',
          dc: null,
          ac: null,
          advantage: false,
          disadvantage: false,
        },
      ],
      scene_spec: null,
      map_actions: [],
      handout_actions: [],
      combatants: [],
      combat_actions: [],
    };
    generatedQueue = [
      {
        text: JSON.stringify({ ...base, combat_transition: 'none' }),
        provider: 'openrouter',
        model: 'test/model',
      },
      {
        text: JSON.stringify({
          ...base,
          combat_transition: 'start',
          scene_spec: { environment: 'road' },
          combatants: [{ monster_id: 'srd:goblin', name: 'Goblin', count: 1 }],
        }),
        provider: 'openrouter',
        model: 'test/model',
      },
    ];
    const response = await app.handle(
      new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: { authorization: 'Bearer smoke-token', 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: '<immutable_game_state>{"isInCombat":false}</immutable_game_state>',
          responseSchema: {
            type: 'object',
            properties: { combat_transition: {}, roll_requests: {} },
          },
        }),
      }),
    );
    const body = (await response.json()) as { text: string };

    expect(response.status).toBe(200);
    expect(generatedInputs).toHaveLength(2);
    expect(generatedInputs[1]?.prompt).toContain('Combat contract violation');
    expect(JSON.parse(body.text).combat_transition).toBe('start');
  });

  it('passes through a second violation after one correction without looping', async () => {
    generatedInputs = [];
    const violatingText = JSON.stringify({
      text: 'The goblin attacks. Roll initiative.',
      narration_segments: [],
      roll_requests: [
        {
          type: 'initiative',
          formula: '1d20+dex',
          purpose: 'Initiative',
          dc: null,
          ac: null,
          advantage: false,
          disadvantage: false,
        },
      ],
      combat_transition: 'none',
      scene_spec: null,
      map_actions: [],
      handout_actions: [],
      combatants: [],
      combat_actions: [],
    });
    generatedQueue = [
      { text: violatingText, provider: 'openrouter', model: 'test/model' },
      { text: violatingText, provider: 'openrouter', model: 'test/model' },
    ];

    const response = await app.handle(
      new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: { authorization: 'Bearer smoke-token', 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: '<immutable_game_state>{"isInCombat":false}</immutable_game_state>',
          responseSchema: {
            type: 'object',
            properties: { combat_transition: {}, roll_requests: {} },
          },
        }),
      }),
    );
    const body = (await response.json()) as { text: string };

    expect(response.status).toBe(200);
    expect(generatedInputs).toHaveLength(2);
    expect(JSON.parse(body.text).combat_transition).toBe('none');
  });

  describe('#1688 per-section prompt token telemetry (log-only)', () => {
    it('accepts an optional metrics field and logs a single [PromptMetrics] line at INFO', async () => {
      loggedInfoLines = [];
      loggedWarnLines = [];
      const response = await app.handle(
        new Request('http://localhost/v1/llm/generate', {
          method: 'POST',
          headers: { authorization: 'Bearer smoke-token', 'content-type': 'application/json' },
          body: JSON.stringify({
            prompt: 'hello with metrics',
            metrics: {
              campaign_and_canon: 500,
              scene_state: 50,
              system: 120,
              history: 300,
              player_input: 20,
              total: 990,
            },
          }),
        }),
      );

      expect(response.status).toBe(200);
      const line = loggedInfoLines.find((entry) => entry.startsWith('[PromptMetrics] '));
      expect(line).toBeDefined();
      const parsed = JSON.parse(line!.slice('[PromptMetrics] '.length));
      expect(parsed.total).toBe(990);
      expect(parsed.campaign_and_canon).toBe(500);
      expect(loggedWarnLines.find((entry) => entry.startsWith('[PromptMetrics] '))).toBeUndefined();
    });

    it('logs the [PromptMetrics] line at WARN when total exceeds 30000', async () => {
      loggedInfoLines = [];
      loggedWarnLines = [];
      const response = await app.handle(
        new Request('http://localhost/v1/llm/generate', {
          method: 'POST',
          headers: { authorization: 'Bearer smoke-token', 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: 'hello with a huge prompt', metrics: { total: 45_000 } }),
        }),
      );

      expect(response.status).toBe(200);
      const line = loggedWarnLines.find((entry) => entry.startsWith('[PromptMetrics] '));
      expect(line).toBeDefined();
      expect(loggedInfoLines.find((entry) => entry.startsWith('[PromptMetrics] '))).toBeUndefined();
    });

    it('still works for requests without a metrics field (old clients, backward compatible)', async () => {
      loggedInfoLines = [];
      loggedWarnLines = [];
      const response = await app.handle(
        new Request('http://localhost/v1/llm/generate', {
          method: 'POST',
          headers: { authorization: 'Bearer smoke-token', 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: 'hello, no metrics field here' }),
        }),
      );

      expect(response.status).toBe(200);
      expect(loggedInfoLines.some((entry) => entry.startsWith('[PromptMetrics]'))).toBe(false);
      expect(loggedWarnLines.some((entry) => entry.startsWith('[PromptMetrics]'))).toBe(false);
    });
  });
});
