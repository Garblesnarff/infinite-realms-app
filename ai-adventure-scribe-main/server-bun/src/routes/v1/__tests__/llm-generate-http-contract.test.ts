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
let quotaAllowed = true;

// Captures for the #1688 prompt-metrics log lines. Unlike the other logger
// methods (still no-ops -- their content isn't under test elsewhere in this
// file), info/warn push the raw message so tests can assert on it.
let loggedInfoLines: string[] = [];
let loggedWarnLines: string[] = [];
let loggedInfoEntries: Record<string, unknown>[] = [];
let loggedWarnEntries: Record<string, unknown>[] = [];

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
    if (msg && typeof msg === 'object' && !Array.isArray(msg)) {
      loggedInfoEntries.push(msg as Record<string, unknown>);
    }
  },
  warn: (msg: unknown) => {
    if (typeof msg === 'string') loggedWarnLines.push(msg);
    if (msg && typeof msg === 'object' && !Array.isArray(msg)) {
      loggedWarnEntries.push(msg as Record<string, unknown>);
    }
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
      allowed: quotaAllowed,
      remaining: quotaAllowed ? 99 : 0,
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
const { getConfiguredGeminiModels, getConfiguredOpenRouterModels } =
  await import('../../../services/llm-model-config.js');
const app = createRequestPipelineApp().use(llmRoutes);

// Body shape of LlmApiClient.generateText (src/infrastructure/api/rest-client.ts) for a DM turn
// (src/services/ai-service.ts: temperature 0.9, maxTokens 8192, requestType 'user'), with the two
// fields #2158 guards overridden. JSON.stringify drops undefined fields, as in production.
const clientBody = (overrides: Record<string, unknown>): string =>
  JSON.stringify({
    prompt: 'The party enters the banquet hall. What do they see?',
    player_input: 'I look around',
    model: undefined,
    maxTokens: 8192,
    temperature: 0.9,
    history: undefined,
    provider: 'openrouter',
    requestType: 'user',
    ...overrides,
  });

const postLlm = (path: string, body: string): Promise<Response> =>
  app.handle(
    new Request(`http://localhost/v1/llm/${path}`, {
      method: 'POST',
      headers: { authorization: 'Bearer smoke-token', 'content-type': 'application/json' },
      body,
    }),
  );

describe('#2158 client model and maxTokens guard', () => {
  it('keeps the maxTokens the DM turn really sends (8192) and drops an unlisted model', async () => {
    generatedInputs = [];
    const response = await postLlm('generate', clientBody({ model: 'anthropic/claude-opus-4' }));

    expect(response.status).toBe(200);
    expect(generatedInput?.model).toBeUndefined();
    expect(generatedInput?.maxTokens).toBe(8192);
  });

  it('clamps an oversized or invalid maxTokens on generate', async () => {
    await postLlm('generate', clientBody({ maxTokens: 1_000_000 }));
    expect(generatedInput?.maxTokens).toBe(8192);

    await postLlm('generate', clientBody({ maxTokens: -5 }));
    expect(generatedInput?.maxTokens).toBe(1);

    await postLlm('generate', clientBody({ maxTokens: undefined }));
    expect(generatedInput?.maxTokens).toBe(1000);
  });

  it('passes a model the server already configures', async () => {
    const [configured] = getConfiguredOpenRouterModels();
    await postLlm('generate', clientBody({ model: configured }));
    expect(generatedInput?.model).toBe(configured);
  });

  it('passes a configured Gemini model and logs nothing', async () => {
    loggedWarnEntries = [];
    const [configured] = getConfiguredGeminiModels();
    await postLlm('generate', clientBody({ model: configured, provider: 'gemini' }));
    expect(generatedInput?.model).toBe(configured);
    expect(loggedWarnEntries.filter((e) => e.msg === 'LLM_CLIENT_INPUT_REPLACED')).toEqual([]);
  });

  it('logs route, user and flags only when a model is dropped or maxTokens is clamped', async () => {
    loggedWarnEntries = [];
    await postLlm(
      'generate',
      clientBody({ model: 'anthropic/claude-opus-4', maxTokens: 1_000_000 }),
    );
    await postLlm('generate', clientBody({ maxTokens: 8192 }));
    const replaced = loggedWarnEntries.filter((e) => e.msg === 'LLM_CLIENT_INPUT_REPLACED');
    expect(replaced).toEqual([
      {
        msg: 'LLM_CLIENT_INPUT_REPLACED',
        route: 'generate',
        userId: 'smoke-user',
        modelDropped: true,
        clamped: true,
      },
    ]);
  });

  it('the deleted stream route now 404s through the real pipeline app (#2664 step 1)', async () => {
    const response = await postLlm(
      'generate/stream',
      clientBody({ model: 'anthropic/claude-opus-4', maxTokens: 1_000_000 }),
    );
    expect(response.status).toBe(404);
  });
});

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

  it('returns a degraded 200 envelope when all generation models fail', async () => {
    loggedInfoEntries = [];
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
          body: JSON.stringify({ prompt: 'hello', sessionId: 'session-123' }),
        }),
      );
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(response.headers.get('retry-after')).toBeNull();
      expect(body).toEqual({
        parsed: false,
        degraded: true,
        reason: 'llm_generate_unavailable',
        text: 'The Dungeon Master pauses. The storyteller service did not answer; try your action again.',
      });
      expect(
        loggedInfoEntries.find((entry) => entry.msg === 'LLM_GENERATE_ENVELOPE_SHAPE'),
      ).toMatchObject({
        msg: 'LLM_GENERATE_ENVELOPE_SHAPE',
        sessionId: 'session-123',
        parsed: false,
        degraded: true,
        textLength: (body.text as string).length,
      });
    } finally {
      generatedResult = {
        text: 'The frozen guests smell faintly of winter roses. What do you do?',
        provider: 'openrouter',
        model: 'test/model',
      };
    }
  });

  it('emits the envelope shape log with the fallback session and prose length', async () => {
    loggedInfoEntries = [];
    generatedResult = {
      text: '',
      error: 'LLM request failed',
      provider: 'openrouter',
      model: 'test/model',
      upstreamStatus: 503,
    };
    try {
      const response = await app.handle(
        new Request('http://localhost/v1/llm/generate', {
          method: 'POST',
          headers: { authorization: 'Bearer smoke-token', 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: 'hello', sessionId: 'session-log-test' }),
        }),
      );
      const body = (await response.json()) as { text: string };
      const shapeLog = loggedInfoEntries.find(
        (entry) => entry.msg === 'LLM_GENERATE_ENVELOPE_SHAPE',
      );

      expect(response.status).toBe(200);
      expect(shapeLog).toMatchObject({
        msg: 'LLM_GENERATE_ENVELOPE_SHAPE',
        sessionId: 'session-log-test',
        parsed: false,
        degraded: true,
        textLength: body.text.length,
      });
    } finally {
      generatedResult = {
        text: 'The frozen guests smell faintly of winter roses. What do you do?',
        provider: 'openrouter',
        model: 'test/model',
      };
    }
  });

  it('the deleted stream route 404s instead of returning the degraded envelope (#2664 step 1)', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/llm/generate/stream', {
        method: 'POST',
        headers: { authorization: 'Bearer smoke-token', 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'hello' }),
      }),
    );

    expect(response.status).toBe(404);
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
      combatants: [{ monster_id: 'srd:goblin', name: 'Goblin', count: 1 }],
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
      combatants: [{ monster_id: 'srd:goblin', name: 'Goblin', count: 1 }],
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

    it('logs only the sections measurePromptSections produces, never other client keys (#2427)', async () => {
      loggedInfoLines = [];
      const response = await app.handle(
        new Request('http://localhost/v1/llm/generate', {
          method: 'POST',
          headers: { authorization: 'Bearer smoke-token', 'content-type': 'application/json' },
          body: JSON.stringify({
            prompt: 'hello with metrics',
            metrics: {
              campaign_and_canon: 500,
              tactical: 40,
              scene_state: 50,
              system: 120,
              history: 300,
              player_input: 20,
              total: 1030,
              'Vance the Sheriff': 7,
            },
          }),
        }),
      );

      expect(response.status).toBe(200);
      const line = loggedInfoLines.find((entry) => entry.startsWith('[PromptMetrics] '));
      expect(JSON.parse(line!.slice('[PromptMetrics] '.length))).toEqual({
        campaign_and_canon: 500,
        tactical: 40,
        scene_state: 50,
        system: 120,
        history: 300,
        player_input: 20,
        total: 1030,
      });
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

    it('#2450: warns with session id and counts (never prompt text) when canon was cut', async () => {
      loggedInfoLines = [];
      loggedWarnLines = [];
      const response = await app.handle(
        new Request('http://localhost/v1/llm/generate', {
          method: 'POST',
          headers: { authorization: 'Bearer <redacted>', 'content-type': 'application/json' },
          // No `total`: the fallback sum must exclude the 0/1 guard flags.
          body: JSON.stringify({
            prompt: 'hello with a cut canon',
            sessionId: 'cut-session-1',
            metrics: {
              campaign_and_canon: 13_000,
              scene: 60,
              scene_state: 33,
              system: 263,
              history: 4_100,
              player_input: 37,
              canon_cut: 1,
              history_below_floor: 0,
            },
          }),
        }),
      );

      expect(response.status).toBe(200);
      const line = loggedWarnLines.find((entry) =>
        entry.startsWith('[PromptMetrics] canon cut to fit prompt budget '),
      );
      expect(line).toBeDefined();
      const parsed = JSON.parse(
        line!.slice('[PromptMetrics] canon cut to fit prompt budget '.length),
      );
      expect(parsed.sessionId).toBe('cut-session-1');
      // #2427: only allowlisted keys go into the log; the WARN carries session id + flag.
      expect(parsed.canon_cut).toBe(1);
      // The guard flags are counts, not section estimates: they must not inflate the total.
      const infoLine = loggedInfoLines.find((entry) => entry.startsWith('[PromptMetrics] '));
      expect(infoLine).toBeDefined();
      const infoParsed = JSON.parse(infoLine!.slice('[PromptMetrics] '.length));
      expect(infoParsed.total).toBe(17_493);
      // The filtered log includes the allowlisted #2450 keys.
      expect(infoParsed.canon_cut).toBe(1);
      expect(infoParsed.scene).toBe(60);
    });

    it('#2450: warns when history fell below its floor', async () => {
      loggedInfoLines = [];
      loggedWarnLines = [];
      const response = await app.handle(
        new Request('http://localhost/v1/llm/generate', {
          method: 'POST',
          headers: { authorization: 'Bearer <redacted>', 'content-type': 'application/json' },
          body: JSON.stringify({
            prompt: 'hello with starved history',
            sessionId: 'floor-session-1',
            metrics: {
              campaign_and_canon: 20_000,
              history: 500,
              total: 20_500,
              canon_cut: 0,
              history_below_floor: 1,
            },
          }),
        }),
      );

      expect(response.status).toBe(200);
      const line = loggedWarnLines.find((entry) =>
        entry.startsWith('[PromptMetrics] history below floor '),
      );
      expect(line).toBeDefined();
      const parsed = JSON.parse(line!.slice('[PromptMetrics] history below floor '.length));
      expect(parsed.sessionId).toBe('floor-session-1');
      // #2427: the WARN carries session id + flag (counts only).
      expect(parsed.history_below_floor).toBe(1);
      // No canon-cut alarm when canon_cut is 0.
      expect(
        loggedWarnLines.some((entry) =>
          entry.startsWith('[PromptMetrics] canon cut to fit prompt budget '),
        ),
      ).toBe(false);
    });
  });

  describe('#2533 server-counted prompt sections (log-only)', () => {
    // Prompt shape follows the real producer: the fullPrompt assembly in
    // src/services/ai-service.ts (ContextBuilder contextPrompt, then
    // <current_scene>, <tactical_context>, the system block,
    // <conversation_history>, <scene_state>, <player_input>). Sentinel
    // words in every section prove none of the text reaches the log line.
    const sectionedPrompt = [
      '<persona>SENTINEL_PERSONA</persona>',
      '<game_context><campaign_details>SENTINEL_CAMPAIGN</campaign_details>',
      '<starter_campaign_lore><canonical_setting>SENTINEL_LORE</canonical_setting></starter_campaign_lore>',
      '<story_memories><memory index="1" type="EVENT">SENTINEL_MEMORY</memory></story_memories></game_context>',
      '<rules_of_play>SENTINEL_RULES</rules_of_play>',
      '<current_scene>SENTINEL_SCENE</current_scene>',
      '<tactical_context>SENTINEL_ENGINE</tactical_context>',
      '<immutable_game_state>{}</immutable_game_state><security_rules>SENTINEL_SYSTEM</security_rules>',
      '<conversation_history>SENTINEL_HISTORY</conversation_history>',
      '<scene_state>SENTINEL_LEDGER</scene_state>',
      '<player_input>SENTINEL_INPUT</player_input>',
    ].join('\n');

    it('logs exactly one [PromptSections] line per generate, numbers only', async () => {
      loggedInfoLines = [];
      loggedWarnLines = [];
      const response = await app.handle(
        new Request('http://localhost/v1/llm/generate', {
          method: 'POST',
          headers: { authorization: 'Bearer smoke-token', 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: sectionedPrompt, sessionId: 'sections-session-1' }),
        }),
      );

      expect(response.status).toBe(200);
      const lines = loggedInfoLines.filter((entry) => entry.startsWith('[PromptSections] '));
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0].slice('[PromptSections] '.length));
      expect(parsed.sessionId).toBe('sections-session-1');
      // No dmReply on this request, so the line labels it a non-DM generate.
      expect(parsed.dm).toBe(false);
      for (const key of [
        'system_rules',
        'campaign_and_canon',
        'scene_state',
        'memory_recall',
        'history',
        'engine_lines',
        'player_input',
        'total',
      ]) {
        expect(typeof parsed[key]).toBe('number');
        expect(parsed[key]).toBeGreaterThan(0);
      }
      expect(parsed.total).toBe(
        parsed.system_rules +
          parsed.campaign_and_canon +
          parsed.scene_state +
          parsed.memory_recall +
          parsed.history +
          parsed.engine_lines +
          parsed.player_input,
      );
      expect(lines[0]).not.toContain('SENTINEL');
    });

    it('labels the /generate line dm:true when the request carries dmReply', async () => {
      loggedInfoLines = [];
      const response = await postLlm(
        'generate',
        clientBody({
          prompt: sectionedPrompt,
          dmReply: { messageId: '123e4567-e89b-12d3-a456-426614174001', inCombat: false },
        }),
      );

      expect(response.status).toBe(200);
      const lines = loggedInfoLines.filter((entry) => entry.startsWith('[PromptSections] '));
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0].slice('[PromptSections] '.length));
      expect(parsed.dm).toBe(true);
    });

    it('still logs [PromptSections] when the client sent no metrics field', async () => {
      loggedInfoLines = [];
      const response = await postLlm('generate', clientBody({}));

      expect(response.status).toBe(200);
      const lines = loggedInfoLines.filter((entry) => entry.startsWith('[PromptSections] '));
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0].slice('[PromptSections] '.length));
      // clientBody's prompt is untagged prose, so it lands in system_rules.
      expect(parsed.system_rules).toBeGreaterThan(0);
      expect(parsed.campaign_and_canon).toBe(0);
    });

    it('logs no [PromptSections] line when quota rejects the generate', async () => {
      loggedInfoLines = [];
      quotaAllowed = false;
      try {
        const response = await postLlm('generate', clientBody({}));
        expect(response.status).toBe(402);
        expect(loggedInfoLines.some((entry) => entry.startsWith('[PromptSections] '))).toBe(false);
      } finally {
        quotaAllowed = true;
      }
    });

    it('the deleted stream route logs no [PromptSections] line and 404s (#2664 step 1)', async () => {
      loggedInfoLines = [];
      const response = await postLlm(
        'generate/stream',
        clientBody({
          prompt: sectionedPrompt,
          sessionId: 'stream-session-1',
          dmReply: { messageId: '123e4567-e89b-12d3-a456-426614174000', inCombat: false },
        }),
      );

      expect(response.status).toBe(404);
      expect(loggedInfoLines.filter((entry) => entry.startsWith('[PromptSections] '))).toEqual([]);
    });
  });
});
