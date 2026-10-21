import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

// #864 reopened (Hark D2-004): the FIRST DM message of a session showed each
// offered choice twice while later turns were fine. The opening producer's
// envelope can carry the lettered choices inside the narration `text` as well
// as in the `options` field; the greeting hook saves the message as narration
// plus the field appended (shared/test-fixtures/initial-greeting-save.ts), so
// the copy inside the text is a second showing. These tests drive the real
// generate route with the opening-shaped request (empty player_input, no
// dmReply, no systemPrompt — src/hooks/use-initial-greeting.ts via
// AIService.generateOpeningMessage) and assert the delivered envelope yields
// each choice exactly once under that assembly.

let generatedResult: Record<string, unknown> = { text: '', provider: 'openrouter', model: 't/m' };

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'opening-user', email: 'opening@example.test', plan: 'free' },
    error: null,
  }),
}));
const testLogger = {
  debug: () => {},
  info: () => {},
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
// Stub the session-message service module the route imports: its withRollTurn
// runs the turn inline, so the route executes without a database.
mock.module('../../../services/session/session-message-service.js', () => ({
  SessionMessageService: {
    withRollTurn: async (
      _sessionId: string,
      _userId: string,
      _playerInput: string | undefined,
      _rollId: string | undefined,
      _replyId: string | undefined,
      generate: () => Promise<unknown>,
    ) => generate(),
  },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { llmRoutes } = await import('../llm.js');
const app = createRequestPipelineApp().use(llmRoutes);

// The Gilded Lantern opening from the real greeting producer's fixture
// (shared/test-fixtures/initial-greeting-save.ts), in the complete envelope
// shape the server-built schema requires (#782 item 3).
const NARRATION =
  'Rain hammers the shutters of the Gilded Lantern as the last of the evening crowd drifts out into the mud. Behind the bar, a hooded stranger slides a folded map toward you and says nothing.';
const OPTIONS = [
  'A. **Take the map**, and read it by the fire.',
  'B. **Ask the stranger** who sent them.',
  'C. **Pocket the map** and leave by the side door.',
  'D. **Order a drink** and watch the room a while.',
];

const envelope = (text: string, options: string[]): string =>
  JSON.stringify({
    text,
    options,
    narration_segments: [],
    roll_requests: [],
    combat_transition: 'none',
    scene_spec: null,
    map_actions: [],
    handout_actions: [],
    combatants: [],
    combat_actions: [],
  });

async function generateOpening(text: string): Promise<{ text?: string; parsed?: boolean }> {
  generatedResult = { text, provider: 'openrouter', model: 't/m' };
  const res = await app.handle(
    new Request('http://localhost/v1/llm/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt:
          'campaign context\n\n<player_input>\nBegin the adventure. Generate the opening scene for this campaign.\n</player_input>',
        sessionId: 'session-opening-options',
        player_input: '',
        requestType: 'user',
      }),
    }),
  );
  return (await res.json()) as { text?: string; parsed?: boolean };
}

const occurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

describe('POST /v1/llm/generate — opening options (#864 reopened)', () => {
  it('delivers each opening choice once when the model wrote them into the text too', async () => {
    const data = await generateOpening(
      envelope(`${NARRATION}\n\n${OPTIONS.join('\n')}`, [...OPTIONS, ...OPTIONS]),
    );

    expect(data.parsed).toBe(true);
    const delivered = JSON.parse(data.text ?? '{}') as { text: string; options: string[] };
    expect(delivered.options).toEqual(OPTIONS);
    expect(delivered.text).toBe(NARRATION);
    // The greeting assembly: narration with the options field appended once.
    const greeting = `${delivered.text}\n\n${delivered.options.join('\n')}`;
    for (const option of OPTIONS) expect(occurrences(greeting, option)).toBe(1);
  });

  it('passes a clean opening envelope through untouched (control)', async () => {
    const input = envelope(NARRATION, OPTIONS);
    const data = await generateOpening(input);

    expect(data.parsed).toBe(true);
    // The route re-serializes the envelope, so compare the delivered fields
    // against the input envelope rather than the raw string. narration_segments
    // is excluded: the route derives it from the text when it is empty.
    const delivered = JSON.parse(data.text ?? '{}') as Record<string, unknown>;
    const expected = JSON.parse(input) as Record<string, unknown>;
    for (const field of [
      'text',
      'options',
      'roll_requests',
      'combat_transition',
      'scene_spec',
      'map_actions',
      'handout_actions',
      'combatants',
      'combat_actions',
    ]) {
      expect(delivered[field]).toEqual(expected[field]);
    }
  });
});
